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

// Custom scale background plugin — draws a lighter bg behind each axis area
// Scale area background - subtle dark shade
const scaleBackgroundPlugin = {
    id: 'scaleBackground',
    beforeDraw: (chart: any) => {
        const { ctx, chartArea, scales, width, height } = chart;
        if (!chartArea) return;
        const bgColor = 'rgba(12, 13, 16, 0.4)'; 
        ctx.save();
        ctx.fillStyle = bgColor;
        if (scales['y-left']) {
            const s = scales['y-left'];
            ctx.fillRect(0, 0, s.right, height);
        }
        if (scales['y-right']) {
            const s = scales['y-right'];
            ctx.fillRect(s.left, 0, width - s.left, height);
        }
        if (scales.x) {
            const s = scales.x;
            ctx.fillRect(chartArea.left, s.top, chartArea.right - chartArea.left, height - s.top);
        }
        ctx.restore();
    }
};

// Current Price Tags Plugin - Draws the yellow/blue tags on Y axes
const priceTagPlugin = {
    id: 'priceTag',
    afterDraw: (chart: any) => {
        const { ctx, scales, data } = chart;
        if (!data.datasets[0].data.length) return;

        const drawTag = (axisId: string, value: number, color: string, textColor: string = '#000') => {
            const scale = scales[axisId];
            if (!scale) return;
            const y = scale.getPixelForValue(value);
            const text = axisId === 'y-right' ? value.toLocaleString() : value.toFixed(2);
            
            ctx.save();
            ctx.font = 'bold 12px Arial';
            const textWidth = ctx.measureText(text).width;
            const tagWidth = textWidth + 12;
            const tagHeight = 20;
            const x = axisId === 'y-right' ? scale.left : scale.right - tagWidth;

            // Draw box
            ctx.fillStyle = color;
            ctx.fillRect(x, y - tagHeight / 2, tagWidth, tagHeight);

            // Draw text
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x + tagWidth / 2, y);
            
            // Draw horizontal dotted line to the tag
            ctx.beginPath();
            ctx.setLineDash([2, 4]);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.moveTo(axisId === 'y-right' ? chart.chartArea.right : chart.chartArea.left, y);
            ctx.lineTo(axisId === 'y-right' ? scale.left : scale.right, y);
            ctx.stroke();
            
            ctx.restore();
        };

        const lastIdx = data.datasets[0].data.length - 1;
        const esfVal = data.datasets[0].data[lastIdx];
        const vixVal = data.datasets[1].data[lastIdx];

        if (esfVal !== null) drawTag('y-right', esfVal, '#facc15'); // Yellow for ES
        if (vixVal !== null) drawTag('y-left', vixVal, '#3b82f6', '#fff'); // Blue for VIX
    }
};

// Custom crosshair plugin
const crosshairPlugin = {
    id: 'crosshair',
    afterDraw: (chart: any) => {
        if (chart.crosshair && chart.crosshair.x !== undefined && chart.crosshair.y !== undefined) {
            const { ctx, chartArea: { top, bottom, left, right }, scales } = chart;
            ctx.save();
            
            // Draw lines
            ctx.beginPath();
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.moveTo(chart.crosshair.x, top);
            ctx.lineTo(chart.crosshair.x, bottom);
            ctx.moveTo(left, chart.crosshair.y);
            ctx.lineTo(right, chart.crosshair.y);
            ctx.stroke();

            // Draw axis labels
            ctx.setLineDash([]);
            ctx.font = '11px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // X-axis label
            const xValue = scales.x.getValueForPixel(chart.crosshair.x);
            const xLabel = scales.x.getLabelForValue(xValue);
            if (xLabel) {
                const tw = ctx.measureText(xLabel).width + 10;
                ctx.fillStyle = '#2a2e39';
                ctx.fillRect(chart.crosshair.x - tw/2, bottom, tw, 20);
                ctx.fillStyle = '#d1d4dc';
                ctx.fillText(xLabel, chart.crosshair.x, bottom + 10);
            }

            // Y-axis labels (optional, can be noisy with priceTagPlugin)
            
            ctx.restore();
        }
    }
};

interface DataPoint {
    time: string;
    vix: number | null;
    esf: number | null;
    coneUp?: number | null;
    coneDown?: number | null;
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
    const [showDivergences, setShowDivergences] = useState(true);
    const [isLocked, setIsLocked] = useState(false);

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
    const manualZoomRef = useRef(false);
    const manualLimitsRef = useRef<{
        x: [any, any] | null;
        yLeft: [number, number] | null;
        yRight: [number, number] | null;
    }>({ x: null, yLeft: null, yRight: null });
    const manualYLeftZoomingRef = useRef(false);
    const manualYRightZoomingRef = useRef(false);
    const vertZoomRef = useRef<{ active: boolean; axis: 'y-left' | 'y-right'; startY: number; startRange: [number, number] } | null>(null);
    const horizZoomRef = useRef<{ active: boolean; startX: number; startRangeX: [any, any] } | null>(null);

    // ---- Auth check ----
    useEffect(() => {
        const auth = localStorage.getItem('market_auth');
        if (auth !== 'true') {
            router.replace('/login');
        } else {
            setIsAuthorized(true);
            // Load divergence preference
            const savedDiv = localStorage.getItem('marketShowDivergences');
            if (savedDiv !== null) setShowDivergences(savedDiv === 'true');
        }
    }, [router]);

    // Save divergence preference
    useEffect(() => {
        localStorage.setItem('marketShowDivergences', String(showDivergences));
    }, [showDivergences]);



    // ---- Divergence Detection ----
    const detectDivergences = (points: DataPoint[]) => {
        if (points.length < 10) return [];
        const annotations: any = {};

        // Find local maxima and minima in ES=F
        // A peak/trough is relative to 8 points on each side (captures larger moves)
        const window = 8;
        const peaks: { index: number; time: string; esf: number; vix: number }[] = [];
        const troughs: { index: number; time: string; esf: number; vix: number }[] = [];

        for (let i = window; i < points.length - window; i++) {
            const current = points[i];
            if (current.esf === null || current.vix === null) continue;

            let isPeak = true;
            let isTrough = true;
            for (let j = i - window; j <= i + window; j++) {
                if (i === j) continue;
                const other = points[j];
                if (other.esf !== null) {
                    if (other.esf! > current.esf!) isPeak = false;
                    if (other.esf! < current.esf!) isTrough = false;
                }
            }
            if (isPeak) peaks.push({ index: i, time: current.time, esf: current.esf!, vix: current.vix! });
            if (isTrough) troughs.push({ index: i, time: current.time, esf: current.esf!, vix: current.vix! });
        }

        // Helper for time difference (HH:mm:ss)
        const getDiffMinutes = (t1: string, t2: string) => {
            const [h1, m1, s1] = t1.split(':').map(Number);
            const [h2, m2, s2] = t2.split(':').map(Number);
            const d1 = new Date(0, 0, 0, h1, m1, s1);
            const d2 = new Date(0, 0, 0, h2, m2, s2);
            return Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60);
        };

        // Bearish Divergence: Price HH, VIX HH (Anomaly)
        for (let i = 1; i < peaks.length; i++) {
            const p1 = peaks[i - 1];
            const p2 = peaks[i];
            const diff = getDiffMinutes(p1.time, p2.time);

            // Price makes Higher High, but VIX also fails to make Lower Low (Higher High here is anomaly)
            // Duration filter: at least 1 minute to exclude noise
            if (p2.esf > p1.esf && p2.vix > p1.vix && diff >= 1) {
                annotations[`div-bear-${i}`] = {
                    type: 'box',
                    xMin: p1.time,
                    xMax: p2.time,
                    backgroundColor: 'rgba(234, 179, 8, 0.15)',
                    borderColor: 'rgba(234, 179, 8, 0.4)',
                    borderWidth: 1,
                    label: {
                        display: true,
                        content: 'Bear Div',
                        position: 'start',
                        color: 'rgba(234, 179, 8, 0.8)',
                        font: { size: 10 }
                    }
                };
            }
        }

        // Bullish Divergence: Price LL, VIX LL (Anomaly)
        for (let i = 1; i < troughs.length; i++) {
            const t1 = troughs[i - 1];
            const t2 = troughs[i];
            const diff = getDiffMinutes(t1.time, t2.time);

            // Price makes Lower Low, but VIX also fails to make Higher High (Lower Low here is anomaly)
            if (t2.esf < t1.esf && t2.vix < t1.vix && diff >= 1) {
                annotations[`div-bull-${i}`] = {
                    type: 'box',
                    xMin: t1.time,
                    xMax: t2.time,
                    backgroundColor: 'rgba(234, 179, 8, 0.15)',
                    borderColor: 'rgba(234, 179, 8, 0.4)',
                    borderWidth: 1,
                    label: {
                        display: true,
                        content: 'Bull Div',
                        position: 'start',
                        color: 'rgba(234, 179, 8, 0.8)',
                        font: { size: 10 }
                    }
                };
            }
        }

        return annotations;
    };

    // ---- Zoom ----
    const updateZoomState = useCallback(() => {
        if (chartRef.current) {
            const chart = chartRef.current;
            // If zoomed (either by plugin or manually), save ALL current limits
            if (isZoomedRef.current || manualZoomRef.current) {
                const yLeftMin = chart.scales['y-left'].min;
                const yLeftMax = chart.scales['y-left'].max;
                const yRightMin = chart.scales['y-right'].min;
                const yRightMax = chart.scales['y-right'].max;

                // We only lock an axis if its range is significantly different from "auto" or if it was manually touched.
                // However, for simplicity and reliability, we'll store both if either is zoomed, 
                // but the imperative update will decide whether to USE them based on manualZoomRef.
                manualLimitsRef.current = {
                    x: [chart.scales.x.min, chart.scales.x.max],
                    yLeft: [yLeftMin, yLeftMax],
                    yRight: [yRightMin, yRightMax],
                };
                setIsLocked(true);
            }
        }
    }, []);

    // ---- Imperative chart update (preserves zoom) ----
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || dataPoints.length === 0) return;

        chart.data.datasets[0].data = dataPoints.map((d) => d.esf);
        chart.data.datasets[1].data = dataPoints.map((d) => d.vix);
        
        // Ported from logica.zip: Add Cone datasets
        if (chart.data.datasets.length > 3) {
            chart.data.datasets[2].data = dataPoints.map((d) => d.coneUp ?? null);
            chart.data.datasets[3].data = dataPoints.map((d) => d.coneDown ?? null);
        }




        const newAnnotations: any = {};
        const baseConfigs = [
            { key: 'r1Down', color: '#ef4444', dash: [] },
            { key: 'r2Down', color: '#f97316', dash: [] },
            { key: 'r3Down', color: '#facc15', dash: [] },
            { key: 'r1Up', color: '#3b82f6', dash: [] },
            { key: 'r2Up', color: '#06b6d4', dash: [] },
            { key: 'r3Up', color: '#10b981', dash: [] },
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



        // Divergence boxes
        if (showDivergences) {
            const divAnnotations = detectDivergences(dataPoints);
            Object.assign(newAnnotations, divAnnotations);
        }

        chart.options.plugins.annotation.annotations = newAnnotations;

        // Determine independent locks & handle Auto-Scroll
        const prevMax = chart.scales.x.max;
        const prevDataLen = chart.data.labels.length - 1; 
        const isAtEnd = prevMax >= prevDataLen - 1; // Within 1 point of the end

        chart.data.labels = dataPoints.map((d) => d.time);
        const newDataLen = dataPoints.length;

        // Auto-scroll logic: If we were at the end, shift the window forward
        if (isAtEnd && (isZoomedRef.current || manualZoomRef.current) && manualLimitsRef.current?.x) {
            const currentRange = manualLimitsRef.current.x[1] - manualLimitsRef.current.x[0];
            const newMax = newDataLen - 1;
            const newMin = Math.max(0, newMax - currentRange);
            manualLimitsRef.current.x = [newMin, newMax];
        }

        const xLocked = (isZoomedRef.current || manualZoomRef.current) && manualLimitsRef.current?.x;
        const yLeftLocked = manualYLeftZoomingRef.current && manualLimitsRef.current?.yLeft;
        const yRightLocked = manualYRightZoomingRef.current && manualLimitsRef.current?.yRight;

        // Apply X lock
        if (xLocked && manualLimitsRef.current?.x) {
            chart.options.scales.x.min = manualLimitsRef.current.x[0];
            chart.options.scales.x.max = manualLimitsRef.current.x[1];
        } else {
            delete chart.options.scales.x.min;
            delete chart.options.scales.x.max;
        }

        // Determine visible window indices for adaptive scaling
        const xMinIdx = chart.scales.x.min !== undefined ? Math.max(0, Math.floor(chart.scales.x.min)) : 0;
        const xMaxIdx = chart.scales.x.max !== undefined ? Math.min(dataPoints.length - 1, Math.ceil(chart.scales.x.max)) : dataPoints.length - 1;
        const visiblePoints = dataPoints.slice(xMinIdx, xMaxIdx + 1);

        // Handle Y Scales (Auto-scaling vs Lock)
        if (visiblePoints.length > 0) {
            // 1. Calculate ES=F (y-right) range if NOT locked
            if (!yRightLocked) {
                const esfValues = visiblePoints.map(d => d.esf).filter(v => v !== null) as number[];
                if (esfValues.length > 0) {
                    const dataMin = Math.min(...esfValues);
                    const dataMax = Math.max(...esfValues);
                    
                    // Factor in reference lines ONLY if they are globally relevant or visible
                    const visibleRefValues: number[] = [];
                    Object.keys(refLines).forEach(k => {
                        const key = k as keyof ReferenceLines;
                        const val = parseFloat(refLines[key]);
                        if (!isNaN(val) && refLineVisibility[key as keyof RefLineVisibility]) {
                            // Only include ref lines in auto-scale if they are somewhat near the current data
                            // to avoid compressing the chart too much.
                            if (val >= dataMin - 100 && val <= dataMax + 100) {
                                visibleRefValues.push(val);
                            }
                        }
                    });

                    let finalMin = dataMin;
                    let finalMax = dataMax;

                    if (visibleRefValues.length > 0) {
                        finalMin = Math.min(finalMin, Math.min(...visibleRefValues));
                        finalMax = Math.max(finalMax, Math.max(...visibleRefValues));
                    }

                    const padding = (finalMax - finalMin) * 0.1 || 10;
                    chart.options.scales['y-right'].min = finalMin - padding;
                    chart.options.scales['y-right'].max = finalMax + padding;
                }
            } else if (manualLimitsRef.current?.yRight) {
                chart.options.scales['y-right'].min = manualLimitsRef.current.yRight[0];
                chart.options.scales['y-right'].max = manualLimitsRef.current.yRight[1];
            }

            // 2. Calculate VIX (y-left) range
            // We ALWAYS auto-scale VIX based on visible points UNLESS the user 
            // explicitly grabbed the left axis (manualYLeftZoomingRef). 
            // This ensures ES manual changes don't "lose" the VIX line.
            if (!yLeftLocked || !manualYLeftZoomingRef.current) {
                const vixValues = visiblePoints.map(d => d.vix).filter(v => v !== null) as number[];
                if (vixValues.length > 0) {
                    const vixMin = Math.min(...vixValues);
                    const vixMax = Math.max(...vixValues);
                    const padding = (vixMax - vixMin) * 0.1 || 0.5;
                    
                    chart.options.scales['y-left'].min = vixMin - padding;
                    chart.options.scales['y-left'].max = vixMax + padding;
                }
            } else if (manualLimitsRef.current?.yLeft) {
                chart.options.scales['y-left'].min = manualLimitsRef.current.yLeft[0];
                chart.options.scales['y-left'].max = manualLimitsRef.current.yLeft[1];
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
                    coneUp: data.coneUp,
                    coneDown: data.coneDown,
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

    // ---- Wheel Zoom (only when mouse is over the X axis) ----
    const handleWheel = (e: React.WheelEvent) => {
        const chart = chartRef.current;
        if (!chart) return;

        const rect = chart.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Only zoom if mouse is over the X axis area
        const xScale = chart.scales.x;
        if (y < xScale.top || y > xScale.bottom || x < xScale.left || x > xScale.right) return;

        e.preventDefault();

        const factor = e.deltaY < 0 ? 0.85 : 1.18; // scroll up = zoom in, down = zoom out

        const r0Raw = xScale.min;
        const r1Raw = xScale.max;
        // getDecimalForValue for string labels; otherwise use numeric directly
        const r0 = typeof r0Raw === 'string' ? xScale.getDecimalForValue(r0Raw) : r0Raw;
        const r1 = typeof r1Raw === 'string' ? xScale.getDecimalForValue(r1Raw) : r1Raw;

        const span = r1 - r0;
        const center = (r0 + r1) / 2;
        const newSpan = span * factor;

        chart.options.scales.x.min = center - newSpan / 2;
        chart.options.scales.x.max = center + newSpan / 2;

        isZoomedRef.current = true;
        manualZoomRef.current = true;
        updateZoomState();
        chart.update('none');
    };

    // ---- Vertical Zoom (Left Click on Scale) and Pan (Right Click) ----
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0 && e.button !== 2) return; // Allow left and right click
        const chart = chartRef.current;
        if (!chart) return;

        const rect = chart.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check if mouse is over the right scale area (Y-axes)
        // Check if mouse is over the left scale area (VIX)
        const vScale = chart.scales['y-left'];
        let isScaleClick = false;

        if (x >= vScale.left && x <= vScale.right) {
            vertZoomRef.current = {
                active: true,
                axis: 'y-left',
                startY: y,
                startRange: [chart.scales['y-left'].min, chart.scales['y-left'].max],
            };
            isZoomedRef.current = true;
            isScaleClick = true;
        }

        // Check if mouse is over the right scale area (Price)
        const yScale = chart.scales['y-right'];
        if (x >= yScale.left && x <= yScale.right) {
            vertZoomRef.current = {
                active: true,
                axis: 'y-right',
                startY: y,
                startRange: [chart.scales['y-right'].min, chart.scales['y-right'].max],
            };
            isZoomedRef.current = true;
            isScaleClick = true;
        }

        // Check if mouse is over the bottom scale area (X-axis)
        // Only allow Left-click to trigger zoom
        const xScale = chart.scales.x;
        if (e.button === 0 && y >= xScale.top && y <= xScale.bottom) {
            horizZoomRef.current = {
                active: true,
                startX: x,
                startRangeX: [xScale.min, xScale.max],
            };
            isZoomedRef.current = true;
            isScaleClick = true;
        }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
        const chart = chartRef.current;
        if (!chart) return;

        // Vertical Zoom (Y-axes)
        if (vertZoomRef.current && vertZoomRef.current.active) {
            const rect = chart.canvas.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const deltaY = y - vertZoomRef.current.startY;
            const factor = 1 + (deltaY / 200);

            const zoomScale = (range: [number, number], f: number) => {
                const center = (range[0] + range[1]) / 2;
                const halfSize = ((range[1] - range[0]) / 2) * f;
                return [center - halfSize, center + halfSize];
            };

            const newRange = zoomScale(vertZoomRef.current.startRange, factor);
            const axis = vertZoomRef.current.axis;

            chart.options.scales[axis].min = newRange[0];
            chart.options.scales[axis].max = newRange[1];

            manualZoomRef.current = true;
            if (axis === 'y-left') manualYLeftZoomingRef.current = true;
            if (axis === 'y-right') manualYRightZoomingRef.current = true;
            
            updateZoomState();
            chart.update('none');
        }

        // Horizontal Zoom (X-axis)
        if (horizZoomRef.current && horizZoomRef.current.active) {
            const rect = chart.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const deltaX = x - horizZoomRef.current.startX;

            // Regular X Zoom (left click over X axis region)
            const factor = 1 - (deltaX / 200); // Inverse for X drag intuition

            const zoomX = (range: [any, any], f: number) => {
                const r0 = typeof range[0] === 'string' ? chart.scales.x.getDecimalForValue(range[0]) : range[0];
                const r1 = typeof range[1] === 'string' ? chart.scales.x.getDecimalForValue(range[1]) : range[1];

                const span = r1 - r0;
                const center = (r0 + r1) / 2;
                const newSpan = span * f;
                const newR0 = center - newSpan / 2;
                const newR1 = center + newSpan / 2;
                return [newR0, newR1];
            };

            const newRangeX = zoomX(horizZoomRef.current.startRangeX, factor);
            chart.options.scales.x.min = newRangeX[0];
            chart.options.scales.x.max = newRangeX[1];
            manualZoomRef.current = true;

            updateZoomState();
            chart.update('none');
        }
    };

    const handleGlobalMouseUp = () => {
        let updated = false;
        if (vertZoomRef.current && vertZoomRef.current.active) {
            vertZoomRef.current.active = false;
            updated = true;
        }
        if (horizZoomRef.current && horizZoomRef.current.active) {
            horizZoomRef.current.active = false;
            updated = true;
        }
        if (updated) {
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
            if (axis === 'y') {
                manualYLeftZoomingRef.current = true;
                manualYRightZoomingRef.current = true;
                manualZoomRef.current = true;
            }
            updateZoomState();
        }
    };
    const handleZoomOut = (axis: 'x' | 'y') => {
        if (chartRef.current) {
            chartRef.current.zoom(axis === 'x' ? { x: 0.8 } : { y: 0.8 });
            if (axis === 'y') {
                manualYLeftZoomingRef.current = true;
                manualYRightZoomingRef.current = true;
                manualZoomRef.current = true;
            }
            updateZoomState();
        }
    };
    const handleResetZoom = () => {
        if (chartRef.current) {
            const chart = chartRef.current;
            chart.resetZoom();
            isZoomedRef.current = false;
            manualZoomRef.current = false;
            manualYLeftZoomingRef.current = false;
            manualYRightZoomingRef.current = false;
            manualLimitsRef.current = { x: null, yLeft: null, yRight: null };

            // Explicitly clear all scale lockings
            delete chart.options.scales.x.min;
            delete chart.options.scales.x.max;
            delete chart.options.scales['y-left'].min;
            delete chart.options.scales['y-left'].max;
            delete chart.options.scales['y-right'].min;
            delete chart.options.scales['y-right'].max;

            setIsLocked(false);
            chart.update();
        }
    };

    // ---- Chart config ----
    const chartData = useMemo(() => ({
        labels: [] as string[],
        datasets: [
            {
                label: 'ES=F (S&P 500 Futures)',
                data: [] as (number | null)[],
                borderColor: '#facc15',
                backgroundColor: 'rgba(250, 204, 21, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                tension: 0.1,
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
                tension: 0.1,
                yAxisID: 'y-left',
                fill: false,
            },
            {
                label: 'Straddle Up',
                data: [] as (number | null)[],
                borderColor: '#f97316',
                borderWidth: 1,
                borderDash: [2, 4],
                pointRadius: 0,
                tension: 0.1,
                yAxisID: 'y-right',
                fill: false,
            },
            {
                label: 'Straddle Down',
                data: [] as (number | null)[],
                borderColor: '#f97316',
                borderWidth: 1,
                borderDash: [2, 4],
                pointRadius: 0,
                tension: 0.1,
                yAxisID: 'y-right',
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
                    wheel: { enabled: false }, // Wheel zoom handled manually (only on X axis)
                    drag: { enabled: false }, // Disable native drag zoom to ensure custom panning works
                    pinch: { enabled: true },
                    mode: 'x' as const,
                    onZoomComplete: () => {
                        isZoomedRef.current = true;
                        manualZoomRef.current = true;
                        setIsLocked(true);
                        updateZoomState();
                    },
                },
                pan: {
                    enabled: true, // Enable native pan plugin for smooth left-drag panning
                    mode: 'xy' as const,
                    modifierKey: undefined,
                    onPanComplete: () => {
                        isZoomedRef.current = true;
                        manualZoomRef.current = true;
                        // We set manual locking specifically when the user interacts 
                        // but we will keep the "other" axis adapting if not touched.
                        // For global pans, we usually lock what was moved.
                        setIsLocked(true);
                        updateZoomState();
                    },
                },
                // Removed limits to allow free panning in any direction
            },
            title: {
                display: false, // Cleaner TV look
            },
            legend: {
                display: true,
                position: 'top' as const,
                align: 'start' as const,
                labels: { color: '#94a3b8', boxWidth: 12, font: { size: 12 } },
            },
            tooltip: { enabled: false },
        },
        scales: {
            x: {
                display: true,
                offset: true,
                ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 11 } },
                grid: { color: 'rgba(51, 65, 85, 0.1)', drawTicks: true },
            },
            'y-left': {
                type: 'linear' as const,
                position: 'left' as const,
                display: true,
                ticks: { color: '#94a3b8', font: { size: 11 }, padding: 8 },
                grid: { color: 'rgba(51, 65, 85, 0.1)' },
            },
            'y-voltide': {
                type: 'linear' as const,
                position: 'left' as const,
                display: false, // Hidden by default for cleaner look
            },
            'y-right': {
                type: 'linear' as const,
                position: 'right' as const,
                display: true,
                ticks: {
                    color: '#94a3b8',
                    font: { size: 11 },
                    padding: 8,
                },
                grid: { display: false },
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
        <div className="min-h-screen bg-[#0c0d10] text-slate-300 p-4 md:p-8 font-sans">
            <div className="w-full max-w-[1920px] mx-auto">
                {/* Header */}
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-4">
                            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-orange-400 bg-clip-text text-transparent">
                                Market Monitor <span className="text-sm font-light text-slate-500 italic ml-2">ODD LOGIC</span>
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

                        <button
                            onClick={() => router.push('/spx-volumes')}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 border border-blue-400 rounded-lg text-xs font-bold text-white transition-colors"
                        >
                            📊 VOLUMI SPX
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


                {/* Chart Area */}
                <div className="bg-[#0c0d10] border border-slate-800/50 rounded-lg p-2 md:p-4 shadow-2xl">
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
                            onClick={() => setShowDivergences(!showDivergences)}
                            className={`px-3 py-1.5 border rounded-lg text-xs font-medium transition-colors ml-4 ${showDivergences
                                ? 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/30'
                                : 'bg-slate-700/50 text-slate-400 border-slate-600 hover:bg-slate-700'
                                }`}
                            title={showDivergences ? 'Hide Divergences' : 'Show Divergences'}
                        >
                            {showDivergences ? '🔔 Div ON' : '🔕 Div OFF'}
                        </button>



                        <button
                            onClick={handleResetZoom}
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 flex items-center gap-2 ${isLocked
                                ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(59,130,246,0.5)] border-blue-400'
                                : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:bg-slate-700 cursor-default'
                                }`}
                            title={isLocked ? 'Restore Live View' : 'Live Tracking Active'}
                        >
                            {isLocked ? (
                                <><span className="w-2 h-2 bg-white rounded-full animate-pulse"></span> RESTORE LIVE VIEW</>
                            ) : (
                                <><span className="w-2 h-2 bg-green-500 rounded-full"></span> LIVE TRACKING</>
                            )}
                        </button>
                    </div>

                    <div
                        className="h-[calc(100vh-240px)] min-h-[400px] cursor-crosshair"
                        onMouseMove={handleMouseMove}
                        onMouseOut={handleMouseOut}
                        onMouseDown={handleMouseDown}
                        onWheel={handleWheel}
                        onContextMenu={(e) => e.preventDefault()}
                    >
                        {dataPoints.length > 0 ? (
                            <Line
                                ref={chartRef}
                                data={chartData}
                                options={chartOptions}
                                plugins={[scaleBackgroundPlugin, crosshairPlugin, priceTagPlugin]}
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
                    <span className="text-slate-500">💡 Tip: Rotella sull&apos;asse X = zoom orizzontale • Trascina grafico = pan completo • Trascina assi Y = scala verticale</span>
                </div>
            </div>
        </div>
    );
}
