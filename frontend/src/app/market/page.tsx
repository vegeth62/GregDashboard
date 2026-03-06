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
}

interface RefLineVisibility {
    r1Down: boolean;
    r2Down: boolean;
    r2Up: boolean;
    r1Up: boolean;
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
    const [status, setStatus] = useState<'live' | 'paused' | 'historical' | 'connecting' | 'error'>('connecting');
    const [lastUpdate, setLastUpdate] = useState<string>('');
    const [firstEsfValue, setFirstEsfValue] = useState<number | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [pluginsReady, setPluginsReady] = useState(false);
    const isZoomedRef = useRef(false);

    // Past sessions
    const [showSessionPicker, setShowSessionPicker] = useState(false);
    const [sessions, setSessions] = useState<string[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null); // null = live/today

    const [refLines, setRefLines] = useState<ReferenceLines>({
        r1Down: '',
        r2Down: '',
        r2Up: '',
        r1Up: '',
    });
    const [refLineVisibility, setRefLineVisibility] = useState<RefLineVisibility>({
        r1Down: true,
        r2Down: true,
        r2Up: true,
        r1Up: true,
    });

    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const sessionWatchRef = useRef<NodeJS.Timeout | null>(null);
    const chartRef = useRef<any>(null);

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
        if (refLines.r1Down && !isNaN(parseFloat(refLines.r1Down)) && refLineVisibility.r1Down) {
            newAnnotations.r1Down = {
                type: 'line', yMin: parseFloat(refLines.r1Down), yMax: parseFloat(refLines.r1Down),
                yScaleID: 'y-right', borderColor: '#ef4444', borderWidth: 2, borderDash: [5, 5],
            };
        }
        if (refLines.r2Down && !isNaN(parseFloat(refLines.r2Down)) && refLineVisibility.r2Down) {
            newAnnotations.r2Down = {
                type: 'line', yMin: parseFloat(refLines.r2Down), yMax: parseFloat(refLines.r2Down),
                yScaleID: 'y-right', borderColor: '#f97316', borderWidth: 2, borderDash: [5, 5],
            };
        }
        if (refLines.r2Up && !isNaN(parseFloat(refLines.r2Up)) && refLineVisibility.r2Up) {
            newAnnotations.r2Up = {
                type: 'line', yMin: parseFloat(refLines.r2Up), yMax: parseFloat(refLines.r2Up),
                yScaleID: 'y-right', borderColor: '#06b6d4', borderWidth: 2, borderDash: [5, 5],
            };
        }
        if (refLines.r1Up && !isNaN(parseFloat(refLines.r1Up)) && refLineVisibility.r1Up) {
            newAnnotations.r1Up = {
                type: 'line', yMin: parseFloat(refLines.r1Up), yMax: parseFloat(refLines.r1Up),
                yScaleID: 'y-right', borderColor: '#3b82f6', borderWidth: 2, borderDash: [5, 5],
            };
        }
        chart.options.plugins.annotation.annotations = newAnnotations;

        if (!isZoomedRef.current) {
            if (firstEsfValue !== null) {
                const baseRange = 50;
                let esfMinVal = firstEsfValue - baseRange;
                let esfMaxVal = firstEsfValue + baseRange;

                const visibleRefValues: number[] = [];
                if (refLines.r1Down && !isNaN(parseFloat(refLines.r1Down)) && refLineVisibility.r1Down)
                    visibleRefValues.push(parseFloat(refLines.r1Down));
                if (refLines.r2Down && !isNaN(parseFloat(refLines.r2Down)) && refLineVisibility.r2Down)
                    visibleRefValues.push(parseFloat(refLines.r2Down));
                if (refLines.r2Up && !isNaN(parseFloat(refLines.r2Up)) && refLineVisibility.r2Up)
                    visibleRefValues.push(parseFloat(refLines.r2Up));
                if (refLines.r1Up && !isNaN(parseFloat(refLines.r1Up)) && refLineVisibility.r1Up)
                    visibleRefValues.push(parseFloat(refLines.r1Up));

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
            try { setRefLines(JSON.parse(saved)); } catch { }
        }
        const savedVis = localStorage.getItem('marketRefLineVisibility');
        if (savedVis) {
            try { setRefLineVisibility(JSON.parse(savedVis)); } catch { }
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

    // ---- Load sessions list ----
    const loadSessions = useCallback(async () => {
        try {
            const res = await fetch('/api/market/sessions', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            if (data.sessions) setSessions(data.sessions);
        } catch { }
    }, []);

    // ---- Load a specific past session ----
    const loadHistoricalSession = useCallback(async (date: string) => {
        // Stop live polling first
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (sessionWatchRef.current) clearInterval(sessionWatchRef.current);

        setStatus('connecting');
        setSelectedDate(date);
        setShowSessionPicker(false);

        try {
            const res = await fetch(`/api/market?date=${date}`, { cache: 'no-store' });
            if (!res.ok) throw new Error('API error');
            const data = await res.json();

            if (data.history && data.history.length > 0) {
                setDataPoints(data.history);
                const firstValid = data.history.find((p: DataPoint) => p.esf !== null);
                if (firstValid) setFirstEsfValue(firstValid.esf);
                setLastUpdate(data.history[data.history.length - 1].time);
            }
            setStatus('historical');
        } catch {
            setStatus('error');
        }
    }, []);

    // ---- Back to live mode ----
    const backToLive = useCallback(() => {
        setSelectedDate(null);
        setDataPoints([]);
        setFirstEsfValue(null);
        setLastUpdate('');
        setStatus('connecting');
        // re-run the mount effect by triggering a state change; we handle this via a restart flag
        // Instead, trigger the startup logic
        window.location.reload();
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
        if (selectedDate !== null) return; // Historical mode; don't start live

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

            // Load sessions list for the past sessions picker
            loadSessions();
        };

        startup();

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (sessionWatchRef.current) clearInterval(sessionWatchRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthorized, selectedDate]);

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
                    mode: 'xy' as const,
                    onZoomComplete: updateZoomState,
                },
                pan: {
                    enabled: true,
                    mode: 'xy' as const,
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
                text: selectedDate ? `VIX & ES=F — Session ${selectedDate}` : 'VIX & ES=F — Daily Monitor',
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
    }), [updateZoomState, selectedDate]);

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
        historical: { label: `Historical: ${selectedDate}`, color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', dot: 'bg-purple-400' },
        connecting: { label: 'Connecting...', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400 animate-pulse' },
        error: { label: 'Error', color: 'bg-red-500/20 text-red-400 border-red-500/30', dot: 'bg-red-400' },
    };
    const sc = statusConfig[status];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4 md:p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6">
                    <div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-green-400 bg-clip-text text-transparent">
                            Market Monitor
                        </h1>
                        <p className="text-slate-400 text-sm mt-1">
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

                        {/* Past Sessions button */}
                        <div className="relative">
                            <button
                                onClick={() => {
                                    loadSessions();
                                    setShowSessionPicker(!showSessionPicker);
                                }}
                                className="px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 rounded-lg text-xs font-medium transition-colors"
                            >
                                📅 Past Sessions
                            </button>

                            {showSessionPicker && (
                                <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-slate-600 rounded-xl shadow-xl z-50 overflow-hidden">
                                    <div className="px-3 py-2 border-b border-slate-700">
                                        <p className="text-xs font-semibold text-slate-300">Archived Sessions</p>
                                    </div>
                                    <div className="max-h-60 overflow-y-auto">
                                        {/* Live/Today option */}
                                        <button
                                            onClick={() => {
                                                setShowSessionPicker(false);
                                                if (selectedDate !== null) backToLive();
                                            }}
                                            className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-700 transition-colors flex items-center gap-2 ${selectedDate === null ? 'text-green-400 font-semibold' : 'text-slate-300'}`}
                                        >
                                            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block"></span>
                                            Today (Live)
                                        </button>
                                        {/* Past dates */}
                                        {sessions.length === 0 ? (
                                            <div className="px-3 py-3 text-xs text-slate-500 text-center">No archived sessions yet</div>
                                        ) : (
                                            sessions.map((date) => (
                                                <button
                                                    key={date}
                                                    onClick={() => loadHistoricalSession(date)}
                                                    className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-700 transition-colors ${selectedDate === date ? 'text-purple-400 font-semibold bg-purple-500/10' : 'text-slate-300'}`}
                                                >
                                                    {date}
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Back to Live button (only in historical mode) */}
                        {selectedDate !== null && (
                            <button
                                onClick={backToLive}
                                className="px-3 py-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 rounded-lg text-xs font-medium text-green-400 transition-colors"
                            >
                                ▶ Back to Live
                            </button>
                        )}

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

                {/* Historical view banner */}
                {status === 'historical' && (
                    <div className="mb-5 bg-purple-900/20 border border-purple-500/30 rounded-xl px-5 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-xl">📁</span>
                            <div>
                                <p className="text-sm font-medium text-purple-300">Viewing archived session: <span className="font-bold">{selectedDate}</span></p>
                                <p className="text-xs text-purple-400/70 mt-0.5">Live polling is paused. Click "Back to Live" to return.</p>
                            </div>
                        </div>
                        <button
                            onClick={backToLive}
                            className="px-4 py-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/40 rounded-lg text-xs font-medium text-green-400 transition-colors whitespace-nowrap ml-4"
                        >
                            ▶ Back to Live
                        </button>
                    </div>
                )}

                {/* Reference Lines Panel */}
                {showSettings && (
                    <div className="bg-slate-800/80 backdrop-blur-sm border border-slate-700/50 rounded-xl p-5 mb-6">
                        <h3 className="text-lg font-semibold mb-4 text-slate-200">Reference Lines (ES=F)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {([
                                { key: 'r1Down', label: 'R1 Down (Red)', colorClass: 'text-red-400', ringClass: 'focus:ring-red-500/50' },
                                { key: 'r2Down', label: 'R2 Down (Orange)', colorClass: 'text-orange-400', ringClass: 'focus:ring-orange-500/50' },
                                { key: 'r2Up', label: 'R2 Up (Cyan)', colorClass: 'text-cyan-400', ringClass: 'focus:ring-cyan-500/50' },
                                { key: 'r1Up', label: 'R1 Up (Blue)', colorClass: 'text-blue-400', ringClass: 'focus:ring-blue-500/50' },
                            ] as const).map(({ key, label, colorClass, ringClass }) => (
                                <div key={key}>
                                    <div className="flex items-center justify-between mb-1.5">
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
                                        value={refLines[key]}
                                        onChange={(e) => handleRefLineChange(key, e.target.value)}
                                        placeholder="e.g. 6850"
                                        className={`w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 ${ringClass}`}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 rounded-xl p-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-400 text-sm font-medium">VIX — Volatility Index</p>
                                <p className="text-3xl font-bold text-blue-400 mt-1">
                                    {latestVix !== null ? latestVix.toFixed(2) : '—'}
                                </p>
                            </div>
                            <div className="w-12 h-12 rounded-lg bg-blue-500/15 flex items-center justify-center">
                                <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 rounded-xl p-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-400 text-sm font-medium">ES=F — S&P 500 Futures</p>
                                <p className="text-3xl font-bold text-green-400 mt-1">
                                    {latestEsf !== null ? `$${latestEsf.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                                </p>
                                {firstEsfValue !== null && (
                                    <p className="text-xs text-slate-500 mt-1">Center: ${firstEsfValue.toFixed(2)}</p>
                                )}
                            </div>
                            <div className="w-12 h-12 rounded-lg bg-green-500/15 flex items-center justify-center">
                                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>

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
                        className="h-[500px] cursor-crosshair"
                        onMouseMove={handleMouseMove}
                        onMouseOut={handleMouseOut}
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
                    Data refreshed every 5 seconds • Active window: 00:00–23:00 CET • Source: Yahoo Finance
                    <br />
                    <span className="text-slate-500">💡 Tip: Use mouse wheel to zoom, drag to pan • 📅 Use Past Sessions to review historical days</span>
                </div>
            </div>
        </div>
    );
}
