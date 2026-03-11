'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale,
    Filler,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import 'chartjs-adapter-date-fns';
import { Line } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale,
    Filler,
    annotationPlugin
);

// Custom crosshair plugin
const crosshairPlugin = {
    id: 'crosshair',
    afterDraw: (chart: any) => {
        if (chart.crosshair && chart.crosshair.x !== undefined && chart.crosshair.y !== undefined) {
            const { ctx, chartArea: { top, bottom, left, right } } = chart;
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.moveTo(chart.crosshair.x, top);
            ctx.lineTo(chart.crosshair.x, bottom);
            ctx.moveTo(left, chart.crosshair.y);
            ctx.lineTo(right, chart.crosshair.y);
            ctx.stroke();
            ctx.restore();
        }
    }
};

interface DataPoint {
    time: string;
    vix: number | null;
    esf: number | null;
}

interface ReferenceLines {
    r1Down: string;
    r2Down: string;
    r2Up: string;
    r1Up: string;
    r1DownOb: string;
    r2DownOb: string;
    r2UpOb: string;
    r1UpOb: string;
}

interface RefLineVisibility {
    r1Down: boolean;
    r2Down: boolean;
    r2Up: boolean;
    r1Up: boolean;
    r1DownOb: boolean;
    r2DownOb: boolean;
    r2UpOb: boolean;
    r1UpOb: boolean;
}

// --- Helpers ---
function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function isInTradingHours() {
    const now = new Date();
    const hour = now.getHours();
    const minutes = now.getMinutes();
    // Active from 00:05 to 23:00 Italian time
    if (hour === 0) return minutes >= 5;
    return hour >= 1 && hour < 23;
}

function isTradingJustStarted() {
    // Returns true if current time is exactly 00:05:xx (within first minute of trading)
    const now = new Date();
    return now.getHours() === 0 && now.getMinutes() === 5;
}

export default function MarketPage() {
    const router = useRouter();
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
    const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
    const [status, setStatus] = useState<'live' | 'paused' | 'connecting' | 'error'>('connecting');
    const [lastUpdate, setLastUpdate] = useState<string>('');
    const [firstEsfValue, setFirstEsfValue] = useState<number | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [pluginsReady, setPluginsReady] = useState(false);
    const isZoomedRef = useRef(false);


    const [refLines, setRefLines] = useState<ReferenceLines>({
        r1Down: '',
        r2Down: '',
        r2Up: '',
        r1Up: '',
        r1DownOb: '',
        r2DownOb: '',
        r2UpOb: '',
        r1UpOb: '',
    });
    const [refLineVisibility, setRefLineVisibility] = useState<RefLineVisibility>({
        r1Down: true,
        r2Down: true,
        r2Up: true,
        r1Up: true,
        r1DownOb: true,
        r2DownOb: true,
        r2UpOb: true,
        r1UpOb: true,
    });

    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const sessionWatchRef = useRef<NodeJS.Timeout | null>(null);
    const chartRef = useRef<any>(null);
    const vertZoomRef = useRef<{ active: boolean; startY: number; startRangeLeft: [number, number]; startRangeRight: [number, number] } | null>(null);

    // ---- Auth check ----
    useEffect(() => {
        const auth = localStorage.getItem('market_auth');
        if (auth !== 'true') {
            router.replace('/login');
        } else {
            setIsAuthorized(true);
        }
    }, [router]);

    // ---- Zoom ----
    const updateZoomState = useCallback(() => {
        if (chartRef.current) {
            isZoomedRef.current = chartRef.current.isZoomedOrPanned();
        }
    }, []);

    // ---- Imperative chart update (preserves zoom) ----
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || dataPoints.length === 0) return;

        chart.data.labels = dataPoints.map((d) => d.time);
        chart.data.datasets[0].data = dataPoints.map((d) => d.esf);
        chart.data.datasets[1].data = dataPoints.map((d) => d.vix);

        const newAnnotations: any = {};
        const baseConfigs = [
            { key: 'r1Down', color: '#ef4444', dash: [] },
            { key: 'r2Down', color: '#f97316', dash: [] },
            { key: 'r2Up', color: '#06b6d4', dash: [] },
            { key: 'r1Up', color: '#3b82f6', dash: [] },
            { key: 'r1DownOb', color: '#ef4444', dash: [5, 5] },
            { key: 'r2DownOb', color: '#f97316', dash: [5, 5] },
            { key: 'r2UpOb', color: '#06b6d4', dash: [5, 5] },
            { key: 'r1UpOb', color: '#3b82f6', dash: [5, 5] },
        ];

        baseConfigs.forEach(({ key, color, dash }) => {
            const val = refLines[key as keyof ReferenceLines];
            if (val && !isNaN(parseFloat(val)) && refLineVisibility[key as keyof RefLineVisibility]) {
                newAnnotations[key] = {
                    type: 'line', yMin: parseFloat(val), yMax: parseFloat(val),
                    yScaleID: 'y-right', borderColor: color, borderWidth: 2, borderDash: dash,
                };
            }
        });
        chart.options.plugins.annotation.annotations = newAnnotations;

        if (!isZoomedRef.current) {
            if (firstEsfValue !== null) {
                const baseRange = 50;
                let esfMinVal = firstEsfValue - baseRange;
                let esfMaxVal = firstEsfValue + baseRange;

                const visibleRefValues: number[] = [];
                Object.keys(refLines).forEach(k => {
                    const key = k as keyof ReferenceLines;
                    if (refLines[key] && !isNaN(parseFloat(refLines[key])) && refLineVisibility[key as keyof RefLineVisibility]) {
                        visibleRefValues.push(parseFloat(refLines[key]));
                    }
                });

                // Include actual ES=F data points in scale calculation
                const esfValues = dataPoints.map(d => d.esf).filter(v => v !== null) as number[];
                if (esfValues.length > 0) {
                    const dataMin = Math.min(...esfValues);
                    const dataMax = Math.max(...esfValues);
                    esfMinVal = Math.min(esfMinVal, dataMin - 10);
                    esfMaxVal = Math.max(esfMaxVal, dataMax + 10);
                }

                if (visibleRefValues.length > 0) {
                    const minRef = Math.min(...visibleRefValues);
                    const maxRef = Math.max(...visibleRefValues);
                    esfMinVal = Math.min(esfMinVal, minRef - 5);
                    esfMaxVal = Math.max(esfMaxVal, maxRef + 5);
                }

                chart.options.scales['y-right'].min = esfMinVal;
                chart.options.scales['y-right'].max = esfMaxVal;

                const vixValues = dataPoints.map(d => d.vix).filter(v => v !== null) as number[];
                if (vixValues.length > 0) {
                    const vixMin = Math.min(...vixValues);
                    const vixMax = Math.max(...vixValues);
                    const vixCenter = (vixMin + vixMax) / 2;
                    const vixDataRange = vixMax - vixMin;
                    const baseEsfRange = baseRange * 2;
                    const actualEsfRange = esfMaxVal - esfMinVal;
                    const expansionFactor = actualEsfRange / baseEsfRange;
                    const baseVixRange = Math.max(vixDataRange * 1.2, 2);
                    const expandedVixRange = baseVixRange * expansionFactor;
                    chart.options.scales['y-left'].min = vixCenter - (expandedVixRange / 2);
                    chart.options.scales['y-left'].max = vixCenter + (expandedVixRange / 2);
                }
            }
        }

        chart.update('none');
    }, [dataPoints, firstEsfValue, refLines, refLineVisibility]);

    // ---- Plugins (zoom) ----
    useEffect(() => {
        const initPlugins = async () => {
            try {
                const zoomPlugin = (await import('chartjs-plugin-zoom')).default;
                ChartJS.register(zoomPlugin);
                setPluginsReady(true);
            } catch (err) {
                console.error('Error loading zoom plugin:', err);
                setPluginsReady(true);
            }
        };
        initPlugins();
    }, []);

    // ---- Reference lines persistence ----
    useEffect(() => {
        const saved = localStorage.getItem('marketRefLines');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setRefLines(prev => ({ ...prev, ...parsed }));
            } catch { }
        }
        const savedVis = localStorage.getItem('marketRefLineVisibility');
        if (savedVis) {
            try {
                const parsed = JSON.parse(savedVis);
                setRefLineVisibility(prev => ({ ...prev, ...parsed }));
            } catch { }
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('marketRefLines', JSON.stringify(refLines));
    }, [refLines]);

    useEffect(() => {
        localStorage.setItem('marketRefLineVisibility', JSON.stringify(refLineVisibility));
    }, [refLineVisibility]);

    // ---- Persist intraday data to localStorage by date ----
    const persistDataPoints = useCallback((points: DataPoint[]) => {
        const key = `marketData_${getTodayKey()}`;
        try {
            localStorage.setItem(key, JSON.stringify(points));
        } catch { }
    }, []);


    // ---- Live data fetch ----
    const fetchData = useCallback(async () => {
        try {
            const res = await fetch('/api/market', { cache: 'no-store' });
            if (!res.ok) throw new Error('API error');
            const data = await res.json();
            if (data.error) {
                setStatus('error');
                return;
            }

            const now = new Date();
            const timeStr = now.toLocaleTimeString('it-IT', {
                timeZone: 'Europe/Rome',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            });

            setDataPoints((prev) => {
                const newPoint: DataPoint = {
                    time: timeStr,
                    vix: data.vix,
                    esf: data.esf,
                };
                if (prev.length === 0 && data.esf !== null) {
                    setFirstEsfValue(data.esf);
                }
                const updated = [...prev, newPoint].slice(-2000); // ~2h45m at 5s
                persistDataPoints(updated);
                return updated;
            });

            setLastUpdate(timeStr);
            setStatus('live');
        } catch {
            setStatus('error');
        }
    }, [persistDataPoints]);

    // ---- Main mount logic ----
    useEffect(() => {
        if (!isAuthorized) return;

        const startup = async () => {
            const todayKey = getTodayKey();
            const localKey = `marketData_${todayKey}`;

            // If it's 00:00 start, clear old data
            if (isTradingJustStarted()) {
                localStorage.removeItem(localKey);
            }

            // Try to load from localStorage first
            const cached = localStorage.getItem(localKey);
            if (cached) {
                try {
                    const parsed = JSON.parse(cached) as DataPoint[];
                    if (parsed.length > 0) {
                        setDataPoints(parsed);
                        const firstValid = parsed.find(p => p.esf !== null);
                        if (firstValid) setFirstEsfValue(firstValid.esf);
                        setLastUpdate(parsed[parsed.length - 1].time);
                        setStatus(isInTradingHours() ? 'live' : 'paused');
                    }
                } catch { }
            }

            // Also fetch yfinance history to fill in any gaps (even if we have cache)
            try {
                const res = await fetch('/api/market?history=true', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    if (data.history && data.history.length > 0) {
                        const history = data.history as DataPoint[];
                        setDataPoints(history);
                        const firstValid = history.find(p => p.esf !== null);
                        if (firstValid) setFirstEsfValue(firstValid.esf);
                        setLastUpdate(history[history.length - 1].time);
                        persistDataPoints(history);
                        setStatus(isInTradingHours() ? 'live' : 'paused');
                    }
                }
            } catch { }

            // Start polling only within trading hours
            if (isInTradingHours()) {
                fetchData();
                intervalRef.current = setInterval(fetchData, 5000);
            } else {
                setStatus(dataPoints.length > 0 ? 'paused' : 'paused');
            }

            // Watch for session boundary changes every minute
            sessionWatchRef.current = setInterval(() => {
                const hour = new Date().getHours();
                const minutes = new Date().getMinutes();

                if (hour === 0 && minutes === 5) {
                    // New session start at 00:05: clear data and start fresh
                    localStorage.removeItem(`marketData_${getTodayKey()}`);
                    setDataPoints([]);
                    setFirstEsfValue(null);
                    setLastUpdate('');

                    // Start polling
                    if (intervalRef.current) clearInterval(intervalRef.current);
                    fetchData();
                    intervalRef.current = setInterval(fetchData, 5000);
                    setStatus('live');
                } else if (hour === 23 && minutes === 0) {
                    // End of session: stop polling
                    if (intervalRef.current) {
                        clearInterval(intervalRef.current);
                        intervalRef.current = null;
                    }
                    setStatus('paused');
                }
            }, 30000); // check every 30s

        };

        startup();

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (sessionWatchRef.current) clearInterval(sessionWatchRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthorized]);

    // ---- Reference line handlers ----
    const handleRefLineChange = (key: keyof ReferenceLines, value: string) => {
        setRefLines((prev) => ({ ...prev, [key]: value }));
    };
    const toggleRefLineVisibility = (key: keyof RefLineVisibility) => {
        setRefLineVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    // ---- Crosshair ----
    const handleMouseMove = (e: React.MouseEvent) => {
        const chart = chartRef.current;
        if (!chart) return;
        const rect = chart.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (x >= chart.chartArea.left && x <= chart.chartArea.right &&
            y >= chart.chartArea.top && y <= chart.chartArea.bottom) {
            chart.crosshair = { x, y };
        } else {
            chart.crosshair = null;
        }
        chart.draw();
    };
    const handleMouseOut = () => {
        if (chartRef.current) {
            chartRef.current.crosshair = null;
            chartRef.current.draw();
        }
    };

    // ---- Vertical Zoom (Left Click on Scale) ----
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // Left click only
        const chart = chartRef.current;
        if (!chart) return;

        const rect = chart.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check if mouse is over the right scale area
        const scale = chart.scales['y-right'];
        if (x >= scale.left && x <= scale.right) {
            vertZoomRef.current = {
                active: true,
                startY: y,
                startRangeLeft: [chart.scales['y-left'].min, chart.scales['y-left'].max],
                startRangeRight: [chart.scales['y-right'].min, chart.scales['y-right'].max],
            };
            isZoomedRef.current = true;
        }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
        if (!vertZoomRef.current || !vertZoomRef.current.active || !chartRef.current) return;
        const chart = chartRef.current;
        const rect = chart.canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const deltaY = y - vertZoomRef.current.startY;

        // Sensibility factor
        const factor = 1 + (deltaY / 200);

        const zoomScale = (range: [number, number], f: number) => {
            const center = (range[0] + range[1]) / 2;
            const halfSize = ((range[1] - range[0]) / 2) * f;
            return [center - halfSize, center + halfSize];
        };

        const newRangeLeft = zoomScale(vertZoomRef.current.startRangeLeft, factor);
        const newRangeRight = zoomScale(vertZoomRef.current.startRangeRight, factor);

        chart.options.scales['y-left'].min = newRangeLeft[0];
        chart.options.scales['y-left'].max = newRangeLeft[1];
        chart.options.scales['y-right'].min = newRangeRight[0];
        chart.options.scales['y-right'].max = newRangeRight[1];

        isZoomedRef.current = true;
        chart.update('none');
    };

    const handleGlobalMouseUp = () => {
        if (vertZoomRef.current) {
            vertZoomRef.current.active = false;
            updateZoomState();
        }
    };

    useEffect(() => {
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, []);

    // ---- Zoom controls ----
    const handleZoomIn = (axis: 'x' | 'y') => {
        if (chartRef.current) {
            chartRef.current.zoom(axis === 'x' ? { x: 1.2 } : { y: 1.2 });
            updateZoomState();
        }
    };
    const handleZoomOut = (axis: 'x' | 'y') => {
        if (chartRef.current) {
            chartRef.current.zoom(axis === 'x' ? { x: 0.8 } : { y: 0.8 });
            updateZoomState();
        }
    };
    const handleResetZoom = () => {
        if (chartRef.current) {
            chartRef.current.resetZoom();
            isZoomedRef.current = false;
        }
    };

    // ---- Chart config ----
    const chartData = useMemo(() => ({
        labels: [] as string[],
        datasets: [
            {
                label: 'ES=F (S&P 500 Futures)',
                data: [] as (number | null)[],
                borderColor: '#22c55e',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.3,
                yAxisID: 'y-right',
                fill: false,
            },
            {
                label: 'VIX (Volatility Index)',
                data: [] as (number | null)[],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.3,
                yAxisID: 'y-left',
                fill: false,
            },
        ],
    }), []);

    const chartOptions = useMemo(() => ({
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: { mode: 'index' as const, intersect: false },
        plugins: {
            annotation: { annotations: {} },
            zoom: {
                zoom: {
                    wheel: { enabled: true, speed: 0.1 },
                    pinch: { enabled: true },
                    mode: 'x' as const,
                    onZoomComplete: updateZoomState,
                },
                pan: {
                    enabled: true,
                    mode: 'x' as const,
                    modifierKey: null as any,
                    onPanComplete: updateZoomState,
                },
                limits: {
                    x: { min: 'original' as const, max: 'original' as const },
                    y: { min: 'original' as const, max: 'original' as const },
                },
            },
            title: {
                display: true,
                text: 'VIX & ES=F — Daily Monitor',
                color: '#e2e8f0',
                font: { size: 18, weight: 'bold' as const },
                padding: { bottom: 20 },
            },
            legend: {
                display: true,
                position: 'top' as const,
                labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'line', font: { size: 13 } },
            },
            tooltip: { enabled: false },
        },
        scales: {
            x: {
                display: true,
                offset: true,
                title: { display: true, text: 'Time', color: '#64748b', font: { size: 12 } },
                ticks: { color: '#64748b', maxRotation: 45, autoSkip: true, maxTicksLimit: 30, font: { size: 10 } },
                grid: { color: 'rgba(51, 65, 85, 0.3)' },
            },
            'y-left': {
                type: 'linear' as const,
                position: 'left' as const,
                display: true,
                title: { display: true, text: 'VIX', color: '#3b82f6', font: { size: 13, weight: 'bold' as const } },
                ticks: { color: '#cbd5e1', font: { size: 12 }, padding: 8 },
                grid: { color: 'rgba(59, 130, 246, 0.08)' },
            },
            'y-right': {
                type: 'linear' as const,
                position: 'right' as const,
                display: true,
                title: { display: true, text: 'ES=F ($)', color: '#22c55e', font: { size: 13, weight: 'bold' as const } },
                ticks: {
                    color: '#cbd5e1',
                    font: { size: 12 },
                    padding: 8,
                    callback: function (value: string | number) {
                        return `$${Number(value).toLocaleString()}`;
                    },
                },
                grid: { drawOnChartArea: false },
            },
        },
    }), [updateZoomState]);

    const latestVix = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].vix : null;
    const latestEsf = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].esf : null;

    if (isAuthorized === null) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
            </div>
        );
    }

    const statusConfig = {
        live: { label: 'LIVE', color: 'bg-green-500/20 text-green-400 border-green-500/30', dot: 'bg-green-400 animate-pulse' },
        paused: { label: 'Outside Trading Hours', color: 'bg-slate-500/20 text-slate-400 border-slate-500/30', dot: 'bg-slate-400' },
        connecting: { label: 'Connecting...', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400 animate-pulse' },
        error: { label: 'Error', color: 'bg-red-500/20 text-red-400 border-red-500/30', dot: 'bg-red-400' },
    };
    const sc = statusConfig[status];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4 md:p-8">
            <div className="w-full max-w-[1920px] mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-4">
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-green-400 bg-clip-text text-transparent">
                                Market Monitor
                            </h1>
                            <div className="flex items-center gap-2 ml-2">
                                <div className="flex items-center gap-2 px-2 py-1 bg-blue-500/10 border border-blue-500/20 rounded-md">
                                    <span className="text-[10px] font-bold text-blue-400/80 tracking-tight">VIX</span>
                                    <span className="text-lg font-bold text-blue-400 leading-none">
                                        {latestVix !== null ? latestVix.toFixed(2) : '—'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 px-2 py-1 bg-green-500/10 border border-green-500/20 rounded-md">
                                    <div className="flex flex-col items-end">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-green-400/80 tracking-tight">ES</span>
                                            <span className="text-lg font-bold text-green-400 leading-none">
                                                {latestEsf !== null ? latestEsf.toLocaleString('en-US') : '—'}
                                            </span>
                                        </div>
                                        {firstEsfValue !== null && (
                                            <span className="text-[10px] text-slate-500 font-medium leading-none mt-0.5">
                                                Ø {firstEsfValue.toFixed(0)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <p className="text-slate-400 text-sm mt-0.5">
                            VIX & S&P 500 Futures — Daily History & Real-Time
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-3 md:mt-0">
                        {/* Settings button */}
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-lg text-xs font-medium transition-colors"
                        >
                            ⚙️ Ref Lines
                        </button>


                        {/* Status badge */}
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${sc.color}`}>
                            <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
                            {sc.label}
                        </span>

                        {lastUpdate && (
                            <span className="text-slate-500 text-xs">Last: {lastUpdate}</span>
                        )}
                    </div>
                </div>

                {/* Outside hours banner */}
                {status === 'paused' && (
                    <div className="mb-5 bg-slate-800/60 border border-slate-700/50 rounded-xl px-5 py-3 flex items-center gap-3">
                        <span className="text-xl">⏸️</span>
                        <div>
                            <p className="text-sm font-medium text-slate-200">Polling inactive — outside trading window</p>
                            <p className="text-xs text-slate-400 mt-0.5">Live data collection runs <span className="text-slate-300 font-medium">00:05 – 23:00</span> (local time). Historical data from today is shown above.</p>
                        </div>
                    </div>
                )}


                {/* Reference Lines Panel */}
                {showSettings && (
                    <div className="bg-slate-800/80 backdrop-blur-sm border border-slate-700/50 rounded-xl p-5 mb-6">
                        <h3 className="text-lg font-semibold mb-4 text-slate-200">Reference Lines (ES=F)</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                            {([
                                { key: 'r1Down', label: 'R1 Down', colorClass: 'text-red-400', ringClass: 'focus:ring-red-500/50' },
                                { key: 'r1DownOb', label: 'R1D OB (Dash)', colorClass: 'text-red-400/70', ringClass: 'focus:ring-red-500/50' },
                                { key: 'r2Down', label: 'R2 Down', colorClass: 'text-orange-400', ringClass: 'focus:ring-orange-500/50' },
                                { key: 'r2DownOb', label: 'R2D OB (Dash)', colorClass: 'text-orange-400/70', ringClass: 'focus:ring-orange-500/50' },
                                { key: 'r2Up', label: 'R2 Up', colorClass: 'text-cyan-400', ringClass: 'focus:ring-cyan-500/50' },
                                { key: 'r2UpOb', label: 'R2U OB (Dash)', colorClass: 'text-cyan-400/70', ringClass: 'focus:ring-cyan-500/50' },
                                { key: 'r1Up', label: 'R1 Up', colorClass: 'text-blue-400', ringClass: 'focus:ring-blue-500/50' },
                                { key: 'r1UpOb', label: 'R1U OB (Dash)', colorClass: 'text-blue-400/70', ringClass: 'focus:ring-blue-500/50' },
                            ] as const).map(({ key, label, colorClass, ringClass }) => (
                                <div key={key} className="bg-slate-900/30 p-2 rounded-lg border border-slate-700/30">
                                    <div className="flex items-center justify-between mb-1">
                                        <label className={`block text-xs font-medium ${colorClass}`}>{label}</label>
                                        <button
                                            onClick={() => toggleRefLineVisibility(key)}
                                            className={`text-slate-400 hover:${colorClass} transition-colors`}
                                            title={refLineVisibility[key] ? 'Hide line' : 'Show line'}
                                        >
                                            {refLineVisibility[key] ? (
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                            ) : (
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={refLines[key] || ''}
                                        onChange={(e) => handleRefLineChange(key, e.target.value)}
                                        placeholder="e.g. 6850"
                                        className={`w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${ringClass}`}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}


                {/* Chart */}
                <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 md:p-6">
                    {/* Zoom Controls */}
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 font-medium">Zoom X:</span>
                            <button onClick={() => handleZoomOut('x')} className="w-8 h-8 flex items-center justify-center bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded text-slate-300 hover:text-white transition-colors" title="Zoom Out X">−</button>
                            <button onClick={() => handleZoomIn('x')} className="w-8 h-8 flex items-center justify-center bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded text-slate-300 hover:text-white transition-colors" title="Zoom In X">+</button>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 font-medium">Zoom Y:</span>
                            <button onClick={() => handleZoomOut('y')} className="w-8 h-8 flex items-center justify-center bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded text-slate-300 hover:text-white transition-colors" title="Zoom Out Y">−</button>
                            <button onClick={() => handleZoomIn('y')} className="w-8 h-8 flex items-center justify-center bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded text-slate-300 hover:text-white transition-colors" title="Zoom In Y">+</button>
                        </div>
                        <button
                            onClick={handleResetZoom}
                            className="px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-lg text-xs font-medium text-slate-300 hover:text-white transition-colors"
                            title="Reset Zoom"
                        >
                            🔄 Reset
                        </button>
                    </div>

                    <div
                        className="h-[calc(100vh-240px)] min-h-[400px] cursor-crosshair"
                        onMouseMove={handleMouseMove}
                        onMouseOut={handleMouseOut}
                        onMouseDown={handleMouseDown}
                        onContextMenu={(e) => e.preventDefault()}
                    >
                        {dataPoints.length > 0 ? (
                            <Line
                                ref={chartRef}
                                data={chartData}
                                options={chartOptions}
                                plugins={[crosshairPlugin]}
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <div className="text-center">
                                    <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto mb-4"></div>
                                    <p className="text-slate-400 text-sm">
                                        {status === 'paused'
                                            ? 'No data yet — polling starts at 00:00'
                                            : 'Loading session data...'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-4 text-center text-slate-600 text-xs">
                    Data refreshed every 5 seconds • Active window: 00:00–23:00 CET • Source: IBKR TWS
                    <br />
                    <span className="text-slate-500">💡 Tip: Use mouse wheel to zoom, drag to pan</span>
                </div>
            </div>
        </div>
    );
}
