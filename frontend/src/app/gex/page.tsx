// frontend/src/app/gex/page.tsx
'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  Chart as ChartJS,
  LinearScale,
  CategoryScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  LineController,
  ScatterController,
  Tooltip,
  TimeScale,
  Legend
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { leggiRefLines, leggiVisibilita } from '@/lib/refLines';

// Base registration (safe for SSR).
// I *Controller servono quanto gli Element: qui il grafico si costruisce a
// mano con `new ChartJS`, e chart.js e' tree-shakeable, quindi senza
// registrarli il primo dataset di tipo line fa morire il render con
// `"line" is not a registered controller`. Finora non si notava perche'
// react-chartjs-2 registra LineController quando /market monta il suo <Line>:
// arrivando su /gex dal menu il controller c'era gia', aprendo /gex di suo
// no.
ChartJS.register(
  LinearScale, CategoryScale, PointElement, LineElement,
  BarElement, BarController, LineController, ScatterController,
  Tooltip, TimeScale, Legend
);

/** Flusso nuovo fra due snapshot: quanto e' stato scambiato in quei secondi. */
interface GexPoint {
  time: string;
  strike: number;
  /** Dai contratti scambiati fra i due snapshot. */
  gex: number;
  /** Dalla variazione di open interest, intraday quasi sempre zero. */
  gexOi: number;
}

/** Totale di giornata per strike, gia' cumulato dal server. */
interface ProfileRow {
  strike: number;
  gex: number;
  gexOi: number;
}

interface SpxHistoryPoint {
  time: string;
  spxPrice?: number | null;
  spx?: number | null;
  esf?: number | null;
}

/**
 * Tetto ai punti di flusso tenuti in memoria. Sono bolle su un asse dei
 * tempi: oltre questo numero si sovrappongono comunque, e l'unico effetto di
 * tenerne di piu' e' far rallentare il ridisegno a ogni aggiornamento.
 */
const MAX_PUNTI = 8000;

function getESTNowStr(): string {
  const localDate = new Date();
  // CET is 6 hours ahead of EST/EDT
  const estDate = new Date(localDate.getTime() - 6 * 60 * 60 * 1000);
  return estDate.toTimeString().slice(0, 8);
}

export default function GexPage() {
  const [gexData, setGexData] = useState<GexPoint[]>([]);
  const [profile, setProfile] = useState<ProfileRow[]>([]);
  const [spxHistory, setSpxHistory] = useState<SpxHistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'lines' | 'bars'>('lines');
  // Su cosa pesare il gamma: i contratti scambiati oggi (flusso) o le
  // posizioni aperte (posizionamento, il GEX canonico). Ogni punto porta
  // gia' entrambi i valori, quindi il cambio e' istantaneo.
  const [gexBasis, setGexBasis] = useState<'volume' | 'oi'>('volume');
  const [timeWindow, setTimeWindow] = useState<number | 'all'>(5);
  const [isZoomed, setIsZoomed] = useState(false);
  const [pluginsReady, setPluginsReady] = useState(false);
  const [nowClock, setNowClock] = useState<Date>(() => new Date());
  // Ora di Roma dell'ultimo snapshot ricevuto, da rimandare come `since`.
  const lastGexTime = useRef<string | null>(null);
  const giornoSessione = useRef<string | null>(null);
  const [refLines, setRefLines] = useState<Record<string, string>>({});
  const [refLineVisibility, setRefLineVisibility] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const salvate = leggiRefLines();
    if (salvate) setRefLines(salvate);
    const vis = leggiVisibilita();
    if (vis) setRefLineVisibility(vis);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);
  const isUserZoomedRef = useRef(false);
  const prevLineDateRef = useRef<number>(0);
  const latestGexData = useRef<GexPoint[]>([]);
  const latestSpxHistory = useRef<SpxHistoryPoint[]>([]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowClock(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  latestGexData.current = gexData;
  latestSpxHistory.current = spxHistory;

  // ─── Dynamic import of plugins (client-side only) ───
  useEffect(() => {
    Promise.all([
      import('chartjs-plugin-zoom'),
      import('chartjs-plugin-annotation'),
    ]).then(([zoomMod, annotationMod]) => {
      ChartJS.register(zoomMod.default, annotationMod.default);
      setPluginsReady(true);
    });
  }, []);

  // ─── Data fetching ───
  useEffect(() => {
    const fetchGexData = async () => {
      try {
        // Ogni snapshot vale ~37 punti: senza `since` si riscaricherebbe
        // l'intera giornata a ogni giro.
        const since = lastGexTime.current;
        const res = await fetch(since ? `/api/gex?since=${encodeURIComponent(since)}` : '/api/gex', { cache: 'no-store' });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || 'Failed to load GEX data');
        }
        const json = await res.json();

        // Cambio di giornata: si riparte da zero, senza `since`. Senza questo
        // il cursore restava all'ultimo snapshot di ieri sera e per tutto
        // oggi la pagina scartava quello che arrivava prima di quell'ora.
        if (json.date && giornoSessione.current && json.date !== giornoSessione.current) {
          giornoSessione.current = json.date;
          lastGexTime.current = null;
          setGexData([]);
          setProfile([]);
          return;
        }
        if (json.date) giornoSessione.current = json.date;

        if (json.lastTime) lastGexTime.current = json.lastTime;
        const incoming: GexPoint[] = json.points ?? [];
        // Il profilo e' gia' il totale di giornata: si sostituisce, non si
        // somma. I punti sono flusso, quelli si accodano -- ma solo entro la
        // finestra che il grafico puo' mostrare, altrimenti a fine sessione
        // ci si ritrova a ridisegnare decine di migliaia di bolle.
        const nuovoProfilo: ProfileRow[] = json.profile ?? [];
        if (nuovoProfilo.length > 0) setProfile(nuovoProfilo);
        if (since) {
          if (incoming.length > 0) setGexData((prev) => [...prev, ...incoming].slice(-MAX_PUNTI));
        } else {
          setGexData(incoming.slice(-MAX_PUNTI));
        }
        setError(null);
      } catch (e: any) {
        setError(e.message || 'Error');
      }
    };
    const fetchSpxData = async () => {
      try {
        const res = await fetch('/api/market?history=true', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json.history?.length > 0) {
            setSpxHistory(
              json.history
                .filter((p: any) => p.time && (p.spx != null || p.esf != null) && (p.time.split(':').map(Number)[0] > 15 || (p.time.split(':').map(Number)[0] === 15 && p.time.split(':').map(Number)[1] >= 30)))
                .map((p: any) => {
                  const parts = p.time.split(':').map(Number);
                  let hrs = parts[0];
                  if (hrs >= 15) {
                    hrs = hrs - 6;
                  }
                  const estTime = `${String(hrs).padStart(2, '0')}:${String(parts[1] || 0).padStart(2, '0')}:${String(parts[2] || 0).padStart(2, '0')}`;
                  return { time: estTime, spxPrice: p.spx || p.esf, spx: p.spx, esf: p.esf };
                })
            );
          }
        }
      } catch (e) {
        console.error('Failed to load SPX price history:', e);
      }
    };
    fetchGexData();
    fetchSpxData();
    const interval = setInterval(() => { fetchGexData(); fetchSpxData(); }, 30000);
    return () => clearInterval(interval);
  }, []);

  // ─── Derived data ───
  const filteredGexData = useMemo(() => {
    const now = getESTNowStr();
    return gexData.filter((d) => d.time <= now);
  }, [gexData]);

  // `latestDataTime` stava qui: calcolato a ogni aggiornamento e mai letto da
  // nessuno. Non era solo peso morto -- faceva `Math.max(...punti)`, e lo
  // spread passa un argomento per elemento: oltre qualche decina di migliaia
  // di punti lo stack finisce e la pagina muore con una eccezione
  // client-side, che e' esattamente come si presentava il guasto.
  // Gli spread rimasti qui sotto lavorano su array corti e delimitati (37
  // strike, i livelli di riferimento), non sulla serie dei punti.

  const gexProfile = useMemo(() => {
    // Il totale di giornata arriva gia' cumulato dal server: qui si sceglie
    // solo quale delle due misure mostrare.
    return profile.map((p) => ({ strike: p.strike, gex: gexBasis === 'oi' ? p.gexOi : p.gex }));
  }, [profile, gexBasis]);

  const currentBasis = useMemo(() => {
    for (let i = spxHistory.length - 1; i >= 0; i--) {
      const pt = spxHistory[i];
      if (pt.esf != null && pt.spx != null && pt.esf > 0 && pt.spx > 0) {
        return pt.esf - pt.spx;
      }
    }
    return 0;
  }, [spxHistory]);

  const yLimits = useMemo(() => {
    const now = getESTNowStr();
    const filteredPrices = spxHistory.filter((dp) => dp.time <= now);
    const strikes = gexProfile.map((p) => p.strike);
    const prices = filteredPrices.map((p) => p.spxPrice).filter((p): p is number => !!p);

    // Gli strike sono il riferimento di scala: un livello lontano piu' del 20%
    // da li' non e' un livello, e' un dato sporco. Senza questo controllo
    // bastava una chiave estranea in `marketRefLines` per portare il minimo
    // dell'asse a 2026 e schiacciare tutto il grafico in una striscia.
    const centro = strikes.length > 0 ? (Math.min(...strikes) + Math.max(...strikes)) / 2 : null;
    const plausibile = (v: number) => centro === null || Math.abs(v - centro) <= centro * 0.2;

    const refLevels: number[] = [];
    Object.entries(refLines).forEach(([key, valStr]) => {
      const val = parseFloat(valStr);
      if (!isNaN(val) && refLineVisibility[key] !== false && plausibile(val - currentBasis)) {
        refLevels.push(val - currentBasis);
      }
    });

    const allValues = [...strikes, ...prices, ...refLevels];
    if (allValues.length === 0) return { min: 7300, max: 7600 };
    // Con reduce e non con lo spread: `prices` segue lo storico e cresce per
    // tutta la sessione.
    const min = allValues.reduce((a, b) => (b < a ? b : a), allValues[0]);
    const max = allValues.reduce((a, b) => (b > a ? b : a), allValues[0]);
    const padding = (max - min) * 0.05 || 50;
    return { min: Math.floor(min - padding), max: Math.ceil(max + padding) };
  }, [gexProfile, spxHistory, refLines, refLineVisibility, currentBasis]);

  const maxGexVal = useMemo(() => {
    if (gexProfile.length === 0) return 1;
    return Math.max(...gexProfile.map((p) => Math.abs(p.gex)));
  }, [gexProfile]);

  const lineDate = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const estTimeStr = getESTNowStr();
    return new Date(`${todayStr}T${estTimeStr}`);
  }, [nowClock]);

  const lineAnnotations = useMemo(() => {
    const annotations: Record<string, any> = {};

    // 1. Vertical line at "NOW"
    if (viewMode === 'lines') {
      const latestPrice = spxHistory.length > 0 ? spxHistory[spxHistory.length - 1].spxPrice : null;
      
      annotations[`now-line`] = {
        type: 'line',
        xMin: lineDate,
        xMax: lineDate,
        xScaleID: 'xTime',
        borderColor: 'rgba(168, 85, 247, 0.85)',
        borderWidth: 2,
        borderDash: [4, 3],
        label: {
          display: true,
          content: latestPrice ? `SPX ${latestPrice.toFixed(2)}` : 'NOW',
          position: 'start',
          yAdjust: 10,
          backgroundColor: 'rgba(168, 85, 247, 0.95)',
          color: '#ffffff',
          font: { size: 11, weight: 'bold' as const },
          padding: { top: 3, bottom: 3, left: 6, right: 6 },
          borderRadius: 4
        }
      };
    }

    if (viewMode !== 'lines' || gexProfile.length === 0) return annotations;

    // 2. Horizontal GEX strike lines
    gexProfile.forEach((p, idx) => {
      const ratio = Math.abs(p.gex) / maxGexVal;
      // Only draw major levels to declutter like Bookmap (e.g. > 10% of max)
      if (ratio < 0.10) return;

      const importanceRatio = ratio;
      // Much thicker lines for major levels
      const borderWidth = 3 + importanceRatio * 12.0;
      let borderColor: string;
      
      if (p.gex > 0) {
        // Bright green/teal for positive GEX levels
        const opacity = Math.min(0.95, Math.max(0.4, importanceRatio));
        borderColor = `rgba(34, 197, 94, ${opacity})`;
      } else {
        // Bright red/orange for negative GEX levels
        const opacity = Math.min(0.95, Math.max(0.4, importanceRatio));
        borderColor = `rgba(239, 68, 68, ${opacity})`;
      }
      annotations[`gex-line-${idx}`] = { type: 'line', yMin: p.strike, yMax: p.strike, borderColor, borderWidth, label: { display: false } };
    });

    // 3. Solo i 4 livelli più importanti: R1 Up/Down (Morning bold, OB tratteggiato)
    const baseConfigs = [
      { key: 'r1Up',     label: 'R1↑',    color: '#3b82f6', dash: [],     width: 2.5 },
      { key: 'r1Down',   label: 'R1↓',    color: '#ef4444', dash: [],     width: 2.5 },
      { key: 'r1UpOb',   label: 'R1↑ OB', color: '#60a5fa', dash: [8, 4], width: 1.5 },
      { key: 'r1DownOb', label: 'R1↓ OB', color: '#f87171', dash: [8, 4], width: 1.5 },
    ];

    baseConfigs.forEach(({ key, label, color, dash, width }) => {
      const valStr = refLines[key];
      if (valStr && !isNaN(parseFloat(valStr)) && refLineVisibility[key] !== false) {
        const spxLevel = parseFloat(valStr) - currentBasis;
        annotations[`ref-${key}`] = {
          type: 'line',
          yMin: spxLevel,
          yMax: spxLevel,
          borderColor: color,
          borderWidth: width,
          borderDash: dash,
          label: {
            display: true,
            content: `${label} ${spxLevel.toFixed(0)}`,
            position: 'end',
            xAdjust: -8,
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            color: color,
            font: { size: 11, weight: 'bold' as const },
            padding: { top: 3, bottom: 3, left: 5, right: 5 },
            borderRadius: 4
          }
        };
      }
    });

    return annotations;
  }, [gexProfile, maxGexVal, viewMode, spxHistory, lineDate, refLines, refLineVisibility, currentBasis]);

  // ─── Build datasets helper ───
  const buildDatasets = useCallback((currentGexData: GexPoint[], currentSpxHistory: SpxHistoryPoint[], currentGexProfile: { strike: number; gex: number }[]) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = getESTNowStr();

    const priceData = currentSpxHistory
      .filter(dp => dp.time <= now)
      .map((dp) => {
        const t = dp.time.includes(':') ? dp.time : `${dp.time}:00`;
        return { x: new Date(`${todayStr}T${t}`), y: dp.spxPrice || 0 };
      })
      .filter((pt) => !isNaN(pt.x.getTime()) && pt.y > 0);

    const priceDataset = {
      type: 'line' as const, label: 'SPX Price', data: priceData,
      xAxisID: 'xTime', yAxisID: 'y', borderColor: '#00f0ff',
      borderWidth: 2.5, pointRadius: 0, fill: false, tension: 0.1,
      showLine: true,
    };

    const scatterPoints = currentGexData
      .filter(d => d.time <= now)
      .map((d) => {
        const t = d.time.includes(':') ? d.time : `${d.time}:00`;
        // Le bolle seguono il selettore come le barre: in modalita' open
        // interest sono quasi sempre vuote, ed e' corretto -- l'OI e' fermo
        // al closing del giorno prima e intraday non si muove.
        return { x: new Date(`${todayStr}T${t}`), y: d.strike, gex: gexBasis === 'oi' ? d.gexOi : d.gex };
      })
      .filter((pt) => !isNaN(pt.x.getTime()) && pt.gex !== 0);

    const maxSingleEvent = scatterPoints.reduce((max, p) => Math.max(max, Math.abs(p.gex)), 0);
    const threshold = maxSingleEvent * 0.10; // Lower threshold to show more granular addition/subtraction data

    const blueDotsDataset = {
      type: 'scatter' as const, label: 'GEX+ (Addition)',
      data: scatterPoints.filter((p) => p.gex > 0 && p.gex >= threshold),
      xAxisID: 'xTime', yAxisID: 'y', 
      backgroundColor: (ctx: any) => {
        const val = ctx.raw?.gex || 0;
        const ratio = Math.min(1, val / maxSingleEvent);
        return `rgba(59, 130, 246, ${0.4 + 0.6 * ratio})`; // Dynamic opacity blue
      },
      borderColor: 'rgba(96, 165, 250, 0.8)', 
      borderWidth: 1, 
      pointRadius: (ctx: any) => {
        const val = ctx.raw?.gex || 0;
        const ratio = Math.min(1, val / maxSingleEvent);
        return 3 + ratio * 15; // Dynamic bubble size (3 to 18)
      }, 
      pointHoverRadius: 10,
    };
    const purpleDotsDataset = {
      type: 'scatter' as const, label: 'GEX- (Subtraction)',
      data: scatterPoints.filter((p) => p.gex < 0 && Math.abs(p.gex) >= threshold),
      xAxisID: 'xTime', yAxisID: 'y', 
      backgroundColor: (ctx: any) => {
        const val = Math.abs(ctx.raw?.gex || 0);
        const ratio = Math.min(1, val / maxSingleEvent);
        return `rgba(217, 70, 239, ${0.4 + 0.6 * ratio})`; // Dynamic opacity purple/fuchsia
      },
      borderColor: 'rgba(232, 121, 249, 0.8)', 
      borderWidth: 1, 
      pointRadius: (ctx: any) => {
        const val = Math.abs(ctx.raw?.gex || 0);
        const ratio = Math.min(1, val / maxSingleEvent);
        return 3 + ratio * 15; // Dynamic bubble size (3 to 18)
      }, 
      pointHoverRadius: 10,
    };

    if (viewMode === 'lines') return [priceDataset, blueDotsDataset, purpleDotsDataset];

    const posGexDataset = {
      type: 'bar' as const, label: 'Positive GEX (M$/1%)',
      data: currentGexProfile.map((p) => ({ x: p.gex > 0 ? p.gex : 0, y: p.strike })),
      xAxisID: 'xGex', yAxisID: 'y',
      backgroundColor: (ctx: any) => `rgba(34, 197, 94, ${Math.min(0.55, Math.max(0.12, (ctx.raw?.x || 0) / 15))})`,
      borderColor: (ctx: any) => `rgba(74, 222, 128, ${Math.min(0.7, Math.max(0.2, (ctx.raw?.x || 0) / 15))})`,
      borderWidth: 1, barThickness: 8, indexAxis: 'y' as const,
    };
    const negGexDataset = {
      type: 'bar' as const, label: 'Negative GEX (M$/1%)',
      data: currentGexProfile.map((p) => ({ x: p.gex < 0 ? Math.abs(p.gex) : 0, y: p.strike })),
      xAxisID: 'xGex', yAxisID: 'y',
      backgroundColor: (ctx: any) => `rgba(239, 68, 68, ${Math.min(0.55, Math.max(0.12, (ctx.raw?.x || 0) / 15))})`,
      borderColor: (ctx: any) => `rgba(248, 113, 113, ${Math.min(0.7, Math.max(0.2, (ctx.raw?.x || 0) / 15))})`,
      borderWidth: 1, barThickness: 8, indexAxis: 'y' as const,
    };
    return [priceDataset, posGexDataset, negGexDataset];
  }, [viewMode, gexBasis]);

  const handleTimeWindowChange = useCallback((w: number | 'all') => {
    setTimeWindow(w);
    isUserZoomedRef.current = false;
    setIsZoomed(false);
    const chart = chartRef.current;
    if (chart) {
      chart.resetZoom();
      chart.update('none');
    }
  }, []);

  // ─── Create chart ONCE on mount (after plugins are ready) ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pluginsReady) return;

    // Destroy previous
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    isUserZoomedRef.current = false;
    setIsZoomed(false);

    const datasets = buildDatasets(latestGexData.current, latestSpxHistory.current, gexProfile);

    const xLimits = (() => {
      if (timeWindow === 'all') return null;
      const minDate = new Date(lineDate.getTime() - (timeWindow as number) * 60 * 1000);
      const paddingSeconds = Math.max(90, (timeWindow as number) * 0.25 * 60);
      const maxDateWithPadding = new Date(lineDate.getTime() + paddingSeconds * 1000);
      return { min: minDate, max: maxDateWithPadding };
    })();

    const chart = new ChartJS(canvas, {
      type: 'bar',
      data: { datasets: datasets as any },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false as const,
        scales: {
          xTime: {
            type: 'time' as const, position: 'bottom' as const,
            time: { unit: 'minute' as const, displayFormats: { minute: 'HH:mm' } },
            title: { display: true, text: 'Time (EST)', color: '#94a3b8', font: { size: 11, weight: 'bold' as const } },
            grid: { color: 'rgba(255,255,255,0.03)' },
            ticks: { color: '#94a3b8', font: { size: 10 } },
            min: xLimits ? xLimits.min : undefined,
            max: xLimits ? xLimits.max : undefined,
          },
          xGex: {
            type: 'linear' as const, position: 'top' as const, display: viewMode === 'bars',
            title: { display: true, text: 'SPX Gamma Exposure (M$ per 1%)', color: '#94a3b8', font: { size: 11, weight: 'bold' as const } },
            grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } }, min: 0,
          },
          y: {
            type: 'linear' as const, position: 'right' as const,
            min: yLimits.min, max: yLimits.max,
            title: { display: true, text: 'Strike', color: '#94a3b8', font: { size: 11, weight: 'bold' as const } },
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94a3b8', font: { size: 10 } },
          },
        },
        plugins: {
          legend: { display: true, position: 'bottom' as const, labels: { color: '#e2e8f0', boxWidth: 12, font: { size: 11 } } },
          annotation: { annotations: lineAnnotations },
          tooltip: {
            mode: 'index' as const, intersect: false,
            backgroundColor: '#0f172a', titleColor: '#38bdf8', bodyColor: '#f1f5f9',
            borderColor: '#334155', borderWidth: 1,
            callbacks: {
              label: (ctx: any) => {
                const l = ctx.dataset.label || '';
                if (l.includes('SPX Price')) return `SPX Price: ${ctx.parsed.y.toFixed(2)}`;
                if (l.includes('GEX+') || l.includes('GEX-')) return `${l.split(' ')[0]} Strike ${ctx.parsed.y}: ${(ctx.raw?.gex || 0).toFixed(2)} M$`;
                return `${l}: ${ctx.parsed.x.toFixed(2)} M$`;
              },
            },
          },
          zoom: {
            zoom: {
              // La rotella la gestiamo a mano piu' sotto: qui ci sono tre
              // scale (xTime, xGex, y) e serve poter allargare il tempo
              // senza toccare gli strike. Al plugin restano il pizzico e il
              // trascinamento, che vanno bene come sono.
              wheel: { enabled: false }, pinch: { enabled: true }, mode: 'xy' as const,
              onZoom: () => { isUserZoomedRef.current = true; setIsZoomed(true); },
            },
            pan: {
              enabled: true, mode: 'xy' as const,
              onPan: () => { isUserZoomedRef.current = true; setIsZoomed(true); },
            },
          },
        },
      } as any,
    });

    chartRef.current = chart;

    /**
     * Rotella: ogni asse per conto suo.
     *
     * Sopra l'asse dei tempi allarga o stringe solo la finestra temporale,
     * sopra quello degli strike solo gli strike, dentro il grafico entrambi
     * come prima. Il perno e' il puntatore, non il centro: si stringe dove
     * si sta guardando.
     *
     * Lo zoom vero lo applica `zoomScale`, che e' del plugin: scrivere i
     * limiti a mano in `options.scales` funzionerebbe lo stesso, ma il
     * plugin non registrerebbe da dove si era partiti e il tasto "Reset
     * zoom" resterebbe senza niente a cui tornare.
     */
    const onWheel = (e: WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      // Su = si stringe, giu' = si allarga.
      const fattore = e.deltaY < 0 ? 0.85 : 1.18;

      const zooma = (sc: (typeof chart.scales)[string], pixel: number) => {
        const perno = sc.getValueForPixel(pixel);
        if (perno == null || !isFinite(perno)) return;
        chart.zoomScale(sc.id, {
          min: perno - (perno - sc.min) * fattore,
          max: perno + (sc.max - perno) * fattore,
        }, 'none');
      };

      // Gli assi non si cercano per nome: si prende quello sotto al
      // puntatore, qualunque sia. Le scale qui sono tre e cambiano con la
      // vista (xGex esiste solo in "Profile Bars"), quindi nominarle a mano
      // vuol dire sbagliare appena la vista cambia.
      const asse = Object.values(chart.scales).find(
        (sc) => px >= sc.left && px <= sc.right && py >= sc.top && py <= sc.bottom,
      );

      const area = chart.chartArea;
      const dentro = !!area && px >= area.left && px <= area.right && py >= area.top && py <= area.bottom;

      if (asse) {
        zooma(asse, asse.isHorizontal() ? px : py);
      } else if (dentro) {
        // Dentro il grafico si muovono insieme, come prima.
        for (const sc of Object.values(chart.scales)) {
          zooma(sc, sc.isHorizontal() ? px : py);
        }
      } else {
        return;
      }

      e.preventDefault();
      isUserZoomedRef.current = true;
      setIsZoomed(true);
    };

    // `passive: false` o il browser ignora la preventDefault e scorre la pagina.
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      chart.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginsReady, viewMode]);

  // ─── Imperative data update — preserves zoom/pan ───
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const newDatasets = buildDatasets(gexData, spxHistory, gexProfile);

    newDatasets.forEach((ds, i) => {
      if (chart.data.datasets[i]) {
        chart.data.datasets[i].data = ds.data as any;
        if ('backgroundColor' in ds) chart.data.datasets[i].backgroundColor = ds.backgroundColor as any;
        if ('borderColor' in ds) chart.data.datasets[i].borderColor = ds.borderColor as any;
      } else {
        chart.data.datasets[i] = ds as any;
      }
    });
    if (chart.data.datasets.length > newDatasets.length) {
      chart.data.datasets.length = newDatasets.length;
    }

    // Update annotations
    const annOpts = (chart.options.plugins as any)?.annotation;
    if (annOpts) annOpts.annotations = lineAnnotations;

    const currentLineMs = lineDate.getTime();
    const deltaMs = prevLineDateRef.current ? currentLineMs - prevLineDateRef.current : 0;
    prevLineDateRef.current = currentLineMs;

    const optXScale = (chart.options.scales as any)?.xTime;
    const realXScale = (chart.scales as any)?.xTime;

    if (isUserZoomedRef.current && optXScale && deltaMs > 0) {
      const getMs = (v: any) => {
        if (typeof v === 'number') return v;
        if (v instanceof Date) return v.getTime();
        if (typeof v === 'string') return new Date(v).getTime();
        return null;
      };

      const curMin = getMs(realXScale?.min) ?? getMs(optXScale?.min);
      const curMax = getMs(realXScale?.max) ?? getMs(optXScale?.max);

      if (curMin != null && curMax != null) {
        optXScale.min = new Date(curMin + deltaMs);
        optXScale.max = new Date(curMax + deltaMs);
      }
    } else if (!isUserZoomedRef.current) {
      const yScale = chart.options.scales?.y as any;
      if (yScale) { yScale.min = yLimits.min; yScale.max = yLimits.max; }

      if (optXScale) {
        if (timeWindow === 'all') {
          delete optXScale.min;
          delete optXScale.max;
        } else {
          const minDate = new Date(lineDate.getTime() - (timeWindow as number) * 60 * 1000);
          const paddingSeconds = Math.max(90, (timeWindow as number) * 0.25 * 60);
          const maxDateWithPadding = new Date(lineDate.getTime() + paddingSeconds * 1000);
          
          optXScale.min = minDate;
          optXScale.max = maxDateWithPadding;
        }
      }
    }

    chart.update('none');
  }, [gexData, spxHistory, gexProfile, lineAnnotations, yLimits, timeWindow, lineDate, buildDatasets]);

  // ─── Reset zoom ───
  const handleResetZoom = useCallback(() => {
    const chart = chartRef.current;
    if (chart) {
      chart.resetZoom();
      isUserZoomedRef.current = false;
      setIsZoomed(false);
      const yScale = chart.options.scales?.y as any;
      if (yScale) { yScale.min = yLimits.min; yScale.max = yLimits.max; }
      chart.update('none');
    }
  }, [yLimits]);

  return (
    <div className="w-full h-full bg-[#0c0d10] p-2 flex flex-col justify-between">
      {error && (
        <div className="text-red-400 bg-red-950/30 border border-red-900/50 p-2 rounded text-xs mb-2">⚠️ {error}</div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800/80">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-900/60 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setViewMode('lines')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${viewMode === 'lines' ? 'bg-slate-800 text-teal-400 shadow-md border border-slate-700/60' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Heatmap Lines (Photo)
            </button>
            <button
              onClick={() => setViewMode('bars')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${viewMode === 'bars' ? 'bg-slate-800 text-teal-400 shadow-md border border-slate-700/60' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Profile Bars
            </button>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-900/60 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setGexBasis('volume')}
              title="Gamma pesato sui contratti scambiati oggi: misura di flusso"
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${gexBasis === 'volume' ? 'bg-slate-800 text-teal-400 shadow-md border border-slate-700/60' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Volume
            </button>
            <button
              onClick={() => setGexBasis('oi')}
              title="Gamma pesato sulle posizioni aperte: il GEX canonico. L'open interest e' fermo alla chiusura del giorno prima"
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${gexBasis === 'oi' ? 'bg-slate-800 text-teal-400 shadow-md border border-slate-700/60' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Open Interest
            </button>
            {isZoomed && (
              <button
                onClick={handleResetZoom}
                className="px-3 py-1.5 text-xs font-semibold rounded-md transition-all bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30 ml-1"
              >
                Reset Zoom
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-slate-900/60 p-0.5 rounded-lg border border-slate-800">
            {(['5', '15', '30', 'all'] as const).map((w) => (
              <button
                key={w}
                onClick={() => handleTimeWindowChange(w === 'all' ? 'all' : Number(w))}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  (w === 'all' && timeWindow === 'all') || (w !== 'all' && timeWindow === Number(w))
                    ? 'bg-slate-800 text-teal-400 shadow-md border border-slate-700/60'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {w === 'all' ? 'Full Session' : `${w}m`}
              </button>
            ))}
          </div>
        </div>

        {viewMode === 'lines' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-medium text-slate-300 bg-slate-900/60 px-4 py-2 rounded-lg border border-slate-700/80 shadow-sm">
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500/80 border border-blue-400" /> Addition (GEX+)</span>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-fuchsia-500/80 border border-fuchsia-400" /> Subtraction (GEX-)</span>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400">Bubble size = Activity Volume</span>
            <span className="text-slate-500">|</span>
            <span className="flex items-center gap-2"><span className="w-4 h-1.5 bg-green-500 rounded-sm" /> Major Call Wall</span>
            <span className="flex items-center gap-2"><span className="w-4 h-1.5 bg-red-500 rounded-sm" /> Major Put Wall</span>
            {currentBasis !== 0 && (
              <>
                <span className="text-slate-500">|</span>
                <span className="text-amber-400/90 font-mono text-[10px]">
                  Basis: {currentBasis >= 0 ? `+${currentBasis.toFixed(2)}` : currentBasis.toFixed(2)} pts (SPX Ranges Active)
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-[340px] relative">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
