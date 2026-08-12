'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import SyntheticDataBadge from '@/components/SyntheticDataBadge';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const strikes = [7325, 7350, 7375, 7400, 7425, 7450, 7475, 7500];

// In the original image, Pos GEX and Neg GEX are horizontal bars pointing right.
// We'll offset them slightly on the Y-axis so they don't overlap completely.
const posGexOI = [
    [0.5, 7326], [2.1, 7351], [4.5, 7376], [10.2, 7401], 
    [39.5, 7426], [7.2, 7451], [2.8, 7476], [8.5, 7501]
];
const negGexOI = [
    [0.8, 7324], [4.2, 7349], [8.1, 7374], [25.0, 7399], 
    [1.5, 7424], [0.2, 7449], [0.1, 7474], [0.1, 7499]
];

const posGexVol = [
    [0.2, 7326], [1.1, 7351], [2.5, 7376], [4.2, 7401], 
    [15.5, 7426], [3.2, 7451], [1.8, 7476], [3.5, 7501]
];
const negGexVol = [
    [0.4, 7324], [2.2, 7349], [3.1, 7374], [10.0, 7399], 
    [0.5, 7424], [0.1, 7449], [0.0, 7474], [0.0, 7499]
];

// Historical scatter dots
const historicalDots = [
    // 1 min prior
    [38.0, 7426], [26.0, 7399],
    // 5 min prior
    [35.0, 7426], [24.0, 7399],
    // 10 min prior
    [30.0, 7426], [20.0, 7399]
];

// Converts "HH:mm:ss" time string to a Date timestamp for today
function timeStringToDate(timeStr: string): number {
    const [h, m, s] = timeStr.split(':').map(Number);
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, s ?? 0).getTime();
}

// Returns true if time string (HH:mm:ss) is >= 15:30 CET
function isFrom1530(timeStr: string): boolean {
    const [h, m] = timeStr.split(':').map(Number);
    return h > 15 || (h === 15 && m >= 30);
}

export default function SpxGammaPage() {
    const router = useRouter();
    const [chartsReady, setChartsReady] = useState(false);
    const [spotData, setSpotData] = useState<number[][]>([]);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        let mounted = true;
        let currentData: number[][] = [];

        const fetchHistory = async () => {
            try {
                const res = await fetch('/api/market?history=true', { cache: 'no-store' });
                if (!res.ok) return;
                const data = await res.json();
                if (data.history && data.history.length > 0) {
                    const filtered: number[][] = data.history
                        .filter((p: any) => p.esf != null && isFrom1530(p.time))
                        .map((p: any) => [timeStringToDate(p.time), p.esf as number]);
                    if (mounted) {
                        setSpotData(filtered);
                        currentData = filtered;
                    }
                }
            } catch { }
        };

        const fetchLive = async () => {
            try {
                const res = await fetch('/api/market', { cache: 'no-store' });
                if (!res.ok) return;
                const data = await res.json();
                if (data.esf == null) return;
                const point: number[] = [Date.now(), data.esf];
                currentData = [...currentData, point].slice(-2000);
                if (mounted) setSpotData([...currentData]);
            } catch { }
        };

        const init = async () => {
            await fetchHistory();
            if (!mounted) return;
            setChartsReady(true);
            // Poll live every 5s
            intervalRef.current = setInterval(fetchLive, 5000);
        };

        init();
        return () => {
            mounted = false;
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    const option = useMemo(() => {
        if (!chartsReady) return {};

        return {
            backgroundColor: '#0c0d10',
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' }
            },
            legend: {
                data: [
                    'Pos GEX (OI)', 'Neg GEX (OI)', 
                    'Pos GEX (Volume)', 'Neg GEX (Volume)', 
                    'Spot', 'Prior Dots'
                ],
                textStyle: { color: '#94a3b8', fontSize: 10 },
                top: 10,
                right: 10,
                orient: 'vertical',
                backgroundColor: 'rgba(12, 13, 16, 0.8)',
                padding: 10,
                borderRadius: 4,
                borderColor: '#334155',
                borderWidth: 1
            },
            grid: {
                left: 60,
                right: 30,
                top: 50,
                bottom: 50
            },
            xAxis: [
                {
                    // Top X-Axis: Gamma Exposure (Bn)
                    type: 'value',
                    position: 'top',
                    min: 0,
                    max: 40,
                    name: 'SPX Gamma Exposure (Bn)',
                    nameLocation: 'center',
                    nameGap: 25,
                    nameTextStyle: { color: '#e2e8f0', fontSize: 14, fontWeight: 'bold' },
                    axisLabel: { color: '#94a3b8' },
                    splitLine: { show: false },
                    axisLine: { lineStyle: { color: '#334155' } }
                },
                {
                    // Bottom X-Axis: Time (EST)
                    type: 'time',
                    position: 'bottom',
                    name: 'Time (EST)',
                    nameLocation: 'center',
                    nameGap: 30,
                    nameTextStyle: { color: '#e2e8f0', fontSize: 12, fontWeight: 'bold' },
                    axisLabel: { 
                        color: '#94a3b8',
                        formatter: '{HH}:{mm}'
                    },
                    splitLine: { show: false },
                    axisLine: { lineStyle: { color: '#334155' } }
                }
            ],
            yAxis: {
                // Shared Y-Axis: Strike Price
                type: 'value',
                min: 7300,
                max: 7520,
                interval: 25,
                name: 'Strike',
                nameLocation: 'center',
                nameGap: 40,
                nameTextStyle: { color: '#e2e8f0', fontSize: 12, fontWeight: 'bold' },
                axisLabel: { color: '#94a3b8' },
                splitLine: { lineStyle: { color: 'rgba(51, 65, 85, 0.2)' } },
                axisLine: { lineStyle: { color: '#334155' } }
            },
            series: [
                {
                    name: 'Pos GEX (OI)',
                    type: 'bar',
                    xAxisIndex: 0,
                    data: posGexOI,
                    itemStyle: { color: '#4ade80', opacity: 0.8 },
                    barWidth: 3
                },
                {
                    name: 'Neg GEX (OI)',
                    type: 'bar',
                    xAxisIndex: 0,
                    data: negGexOI,
                    itemStyle: { color: '#f87171', opacity: 0.8 },
                    barWidth: 3
                },
                {
                    name: 'Pos GEX (Volume)',
                    type: 'bar',
                    xAxisIndex: 0,
                    data: posGexVol,
                    itemStyle: { color: '#86efac', opacity: 0.9 }, // Lighter green
                    barWidth: 1.5,
                    barGap: '-75%' // Overlap with OI slightly
                },
                {
                    name: 'Neg GEX (Volume)',
                    type: 'bar',
                    xAxisIndex: 0,
                    data: negGexVol,
                    itemStyle: { color: '#fca5a5', opacity: 0.9 }, // Lighter red
                    barWidth: 1.5,
                    barGap: '-75%'
                },
                {
                    name: 'Spot',
                    type: 'line',
                    xAxisIndex: 1, // Binds to bottom time axis
                    data: spotData,
                    showSymbol: false,
                    lineStyle: { color: '#06b6d4', width: 2 }, // Cyan
                    markLine: {
                        symbol: ['none', 'none'],
                        label: {
                            show: true,
                            position: 'end',
                            formatter: '{c}',
                            color: '#06b6d4',
                            backgroundColor: 'rgba(6, 182, 212, 0.1)',
                            borderColor: '#06b6d4',
                            borderWidth: 1,
                            padding: [2, 4],
                            borderRadius: 4
                        },
                        data: [
                            { 
                                yAxis: spotData.length > 0 ? spotData[spotData.length-1][1] : 7412.54, 
                                lineStyle: { color: '#06b6d4', type: 'dotted', width: 1.5 } 
                            },
                            { 
                                yAxis: 7425, 
                                label: { formatter: 'Major Pos Gamma', position: 'insideStartTop', color: '#4ade80' },
                                lineStyle: { color: '#4ade80', type: 'dashed', width: 1 } 
                            },
                            { 
                                yAxis: 7400, 
                                label: { formatter: 'Major Neg Gamma', position: 'insideStartBottom', color: '#f87171' },
                                lineStyle: { color: '#f87171', type: 'dashed', width: 1 } 
                            },
                            { 
                                yAxis: 7415, 
                                label: { formatter: 'Zero Gamma', position: 'insideStartTop', color: '#f59e0b' },
                                lineStyle: { color: '#f59e0b', type: 'dashed', width: 1 } 
                            }
                        ]
                    }
                },
                {
                    name: 'Prior Dots',
                    type: 'scatter',
                    xAxisIndex: 0,
                    data: historicalDots,
                    itemStyle: { color: '#e2e8f0', shadowBlur: 5, shadowColor: '#000' },
                    symbolSize: 4
                }
            ]
        };
    }, [chartsReady, spotData]);

    const lastTime = spotData.length > 0 ? spotData[spotData.length - 1] : null;

    return (
        <div className="min-h-screen bg-[#0c0d10] text-slate-300 p-3 md:p-5 font-sans">
            <div className="w-full max-w-[1920px] mx-auto">
                <SyntheticDataBadge />
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
                            SPX Gamma Exposure (Bn)
                        </h1>
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-amber-500/20 text-amber-400 border-amber-500/30">
                            MOCK DATA
                        </span>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => router.push('/spx-volumes')}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs transition-colors"
                        >
                            SPX Volumes
                        </button>
                        <button
                            onClick={() => router.push('/market')}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs transition-colors"
                        >
                            Market Monitor
                        </button>
                    </div>
                </div>

                <div className="bg-[#0c0d10] border border-slate-800/80 rounded-xl p-2 shadow-2xl w-full">
                    <div className="h-[calc(100vh-100px)] min-h-[600px]">
                        {chartsReady ? (
                            <ReactECharts
                                option={option}
                                style={{ height: '100%', width: '100%' }}
                                notMerge={true}
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <div className="w-12 h-12 border-4 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
