// frontend/src/app/gex/page.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  LinearScale,
  CategoryScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  TimeScale,
  Legend
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { Chart } from 'react-chartjs-2';
import zoomPlugin from 'chartjs-plugin-zoom';

ChartJS.register(
  LinearScale,
  CategoryScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  TimeScale,
  Legend,
  zoomPlugin
);

interface GexPoint {
  time: string; // HH:mm:ss
  strike: number;
  gex: number; // can be negative or positive
}

interface SpxHistoryPoint {
  time: string;
  spxPrice?: number | null;
}

export default function GexPage() {
  const [gexData, setGexData] = useState<GexPoint[]>([]);
  const [spxHistory, setSpxHistory] = useState<SpxHistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGexData = async () => {
      try {
        const res = await fetch('/api/gex', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load GEX data');
        const json = await res.json();
        setGexData(json);
      } catch (e: any) {
        setError(e.message || 'Error');
      }
    };

    const fetchSpxData = async () => {
      try {
        const res = await fetch('/api/volumes', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json.history) {
            setSpxHistory(json.history);
          }
        }
      } catch (e) {
        console.error('Failed to load SPX price history:', e);
      }
    };

    fetchGexData();
    fetchSpxData();

    const interval = setInterval(() => {
      fetchGexData();
      fetchSpxData();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Aggregate GEX data by strike to build the profile
  const gexProfile = useMemo(() => {
    const profile: Record<number, number> = {};
    gexData.forEach((p) => {
      profile[p.strike] = (profile[p.strike] || 0) + p.gex;
    });
    return Object.entries(profile).map(([strike, gex]) => ({
      strike: parseFloat(strike),
      gex,
    }));
  }, [gexData]);

  // Determine chart scale limits based on strikes and SPX price
  const yLimits = useMemo(() => {
    const strikes = gexProfile.map((p) => p.strike);
    const prices = spxHistory.map((p) => p.spxPrice).filter((p): p is number => !!p);
    const allValues = [...strikes, ...prices];
    if (allValues.length === 0) {
      return { min: 7300, max: 7600 };
    }
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.05 || 50;
    return {
      min: Math.floor(min - padding),
      max: Math.ceil(max + padding),
    };
  }, [gexProfile, spxHistory]);

  const chartData = useMemo(() => {
    // 1. Positive GEX Profile Dataset (Green horizontal bars with glowing opacity based on value)
    const posGexDataset = {
      type: 'bar' as const,
      label: 'Positive GEX (Bn)',
      data: gexProfile.map((p) => ({
        x: p.gex > 0 ? p.gex : 0,
        y: p.strike,
      })),
      xAxisID: 'xGex',
      yAxisID: 'y',
      backgroundColor: (ctx: any) => {
        const val = ctx.raw?.x || 0;
        // Keep it highly translucent so the price line remains clearly visible
        const opacity = Math.min(0.55, Math.max(0.12, val / 15));
        return `rgba(34, 197, 94, ${opacity})`;
      },
      borderColor: (ctx: any) => {
        const val = ctx.raw?.x || 0;
        const opacity = Math.min(0.7, Math.max(0.2, val / 15));
        return `rgba(74, 222, 128, ${opacity})`;
      },
      borderWidth: 1,
      barThickness: 8,
      indexAxis: 'y' as const,
    };

    // 2. Negative GEX Profile Dataset (Red horizontal bars with glowing opacity based on value)
    const negGexDataset = {
      type: 'bar' as const,
      label: 'Negative GEX (Bn)',
      data: gexProfile.map((p) => ({
        x: p.gex < 0 ? Math.abs(p.gex) : 0,
        y: p.strike,
      })),
      xAxisID: 'xGex',
      yAxisID: 'y',
      backgroundColor: (ctx: any) => {
        const val = ctx.raw?.x || 0;
        const opacity = Math.min(0.55, Math.max(0.12, val / 15));
        return `rgba(239, 68, 68, ${opacity})`;
      },
      borderColor: (ctx: any) => {
        const val = ctx.raw?.x || 0;
        const opacity = Math.min(0.7, Math.max(0.2, val / 15));
        return `rgba(248, 113, 113, ${opacity})`;
      },
      borderWidth: 1,
      barThickness: 8,
      indexAxis: 'y' as const,
    };

    // 3. SPX Price Path line dataset
    const todayStr = new Date().toISOString().slice(0, 10);
    const priceData = spxHistory.map((dp) => {
      const timePart = dp.time.includes(':') ? dp.time : `${dp.time}:00`;
      return {
        x: new Date(`${todayStr}T${timePart}`),
        y: dp.spxPrice || 0,
      };
    }).filter(pt => !isNaN(pt.x.getTime()) && pt.y > 0);

    const priceDataset = {
      type: 'line' as const,
      label: 'SPX Price',
      data: priceData,
      xAxisID: 'xTime',
      yAxisID: 'y',
      borderColor: '#00f0ff', // Cyan
      borderWidth: 2.5,
      pointRadius: 0,
      fill: false,
      tension: 0.1,
    };

    return {
      datasets: [priceDataset, posGexDataset, negGexDataset],
    };
  }, [gexProfile, spxHistory]);

  const options = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        xTime: {
          type: 'time' as const,
          position: 'bottom' as const,
          time: {
            unit: 'minute' as const,
            stepSize: 30,
            displayFormats: {
              minute: 'HH:mm',
            },
          },
          title: {
            display: true,
            text: 'Time (EST)',
            color: '#94a3b8',
            font: { size: 11, weight: 'bold' },
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.03)',
          },
          ticks: {
            color: '#94a3b8',
            font: { size: 10 },
          },
        },
        xGex: {
          type: 'linear' as const,
          position: 'top' as const,
          title: {
            display: true,
            text: 'SPX Gamma Exposure (Bn)',
            color: '#94a3b8',
            font: { size: 11, weight: 'bold' },
          },
          grid: {
            display: false,
          },
          ticks: {
            color: '#94a3b8',
            font: { size: 10 },
          },
          min: 0,
        },
        y: {
          type: 'linear' as const,
          position: 'left' as const,
          min: yLimits.min,
          max: yLimits.max,
          title: {
            display: true,
            text: 'Strike',
            color: '#94a3b8',
            font: { size: 11, weight: 'bold' },
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: '#94a3b8',
            font: { size: 10 },
          },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom' as const,
          labels: {
            color: '#e2e8f0',
            boxWidth: 12,
            font: { size: 11 },
          },
        },
        tooltip: {
          mode: 'index' as const,
          intersect: false,
          backgroundColor: '#0f172a',
          titleColor: '#38bdf8',
          bodyColor: '#f1f5f9',
          borderColor: '#334155',
          borderWidth: 1,
          callbacks: {
            label: (ctx: any) => {
              const datasetLabel = ctx.dataset.label || '';
              if (datasetLabel.includes('SPX Price')) {
                return `SPX Price: ${ctx.parsed.y.toFixed(2)}`;
              }
              return `${datasetLabel}: ${ctx.parsed.x.toFixed(2)} Bn`;
            }
          }
        },
        zoom: {
          zoom: {
            wheel: {
              enabled: true,
            },
            pinch: {
              enabled: true,
            },
            mode: 'xy' as const,
          },
          pan: {
            enabled: true,
            mode: 'xy' as const,
          },
        },
      },
    };
  }, [yLimits]);

  return (
    <div className="w-full h-full bg-[#0c0d10] p-2 flex flex-col justify-between">
      {error && (
        <div className="text-red-400 bg-red-950/30 border border-red-900/50 p-2 rounded text-xs mb-2">
          ⚠️ {error}
        </div>
      )}
      <div className="flex-1 min-h-[340px] relative">
        <Chart type="bar" data={chartData} options={options} />
      </div>
    </div>
  );
}
