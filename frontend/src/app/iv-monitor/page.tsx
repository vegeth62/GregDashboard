'use client';

import { useEffect, useRef, useState } from 'react';
import { Chart as ChartJS, registerables } from 'chart.js';
import { Line } from 'react-chartjs-2';
import styles from './page.module.css';

ChartJS.register(...registerables);

/**
 * Tetto agli snapshot tenuti in memoria: una sessione intera a uno ogni
 * cinque secondi sono ~6.100 punti, piu' di quanti un grafico largo un
 * migliaio di pixel possa distinguere.
 */
const MAX_SNAPSHOT = 4000;

interface IVSnapshot {
  time: string;
  timestamp: number;
  esPrice: number | null;
  atmStrike: number;
  // Old (all nearby) - backward compat
  weightedPutIV: number | null;
  weightedCallIV: number | null;
  putIVChangePct: number | null;
  callIVChangePct: number | null;
  // New: ATM only
  putAtmIV?: number | null;
  callAtmIV?: number | null;
  putAtmIVChangePct?: number | null;
  callAtmIVChangePct?: number | null;
  // New: WING (OTM) - PRIMARY SIGNAL
  putWingIV?: number | null;
  callWingIV?: number | null;
  putWingIVChangePct?: number | null;
  callWingIVChangePct?: number | null;
  // New: SKEW
  putSkew?: number | null;
  callSkew?: number | null;
  putSkewChangePct?: number | null;
  callSkewChangePct?: number | null;
  // Differentials
  volDifferentialPct?: number | null;
  ivDifferentialPct: number | null;
  putsData?: Array<{ strike: number; bid?: number; ask?: number; mid?: number; iv?: number | null }>;
  callsData?: Array<{ strike: number; bid?: number; ask?: number; mid?: number; iv?: number | null }>;
}

interface ChartPoint {
  time: string;
  // Primary: WING IV changes
  putWingChange: number | null;
  callWingChange: number | null;
  // Secondary: ATM IV changes
  putAtmChange: number | null;
  callAtmChange: number | null;
  // Skew
  putSkewChange: number | null;
  callSkewChange: number | null;
  // Differentials
  volDifferential: number | null;
  // Raw IV values for reference
  putWingIV: number | null;
  callWingIV: number | null;
  putAtmIV: number | null;
  callAtmIV: number | null;
}

export default function IVMonitorPage() {
  const [snapshots, setSnapshots] = useState<IVSnapshot[]>([]);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [lookback, setLookback] = useState<'5s' | '30s' | '1m' | '5m'>('1m');
  const [strikeRange, setStrikeRange] = useState<'atm' | '±1' | '±2' | '±3'>('±2');
  const [isLive, setIsLive] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const mainChartRef = useRef<any>(null);
  const diffChartRef = useRef<any>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Ultimo snapshot gia' in memoria: la route restituisce solo i successivi.
  const ultimoTempo = useRef<string | null>(null);
  const giornoSessione = useRef<string | null>(null);

  const lookbackSeconds = {
    '5s': 5,
    '30s': 30,
    '1m': 60,
    '5m': 300,
  }[lookback];

  // Fetch IV data from API
  //
  // Incrementale, come /api/volumes e /api/gex. Prima si riscaricava l'intera
  // giornata a ogni giro: uno snapshot pesa ~1,3 KB e ne arriva uno ogni
  // cinque secondi, quindi a fine sessione sono ~8 MB per richiesta, 720
  // richieste l'ora. In locale e' solo spreco, ma quando i dati arrivano da
  // Supabase e' esattamente la voce che consuma l'egress del piano free.
  const fetchIVData = async () => {
    try {
      const since = ultimoTempo.current;
      const url = since ? `/api/iv-monitor?since=${encodeURIComponent(since)}` : '/api/iv-monitor';
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json();

      // Cambio di giornata: si riparte da zero, senza `since`.
      if (data.date && giornoSessione.current && data.date !== giornoSessione.current) {
        giornoSessione.current = data.date;
        ultimoTempo.current = null;
        setSnapshots([]);
        return;
      }
      if (data.date) giornoSessione.current = data.date;

      const arrivati: IVSnapshot[] = data.snapshots || [];
      if (arrivati.length > 0) {
        ultimoTempo.current = arrivati[arrivati.length - 1].time;
        setSnapshots((prec) => (since ? [...prec, ...arrivati].slice(-MAX_SNAPSHOT) : arrivati));
      }
      setLastUpdate(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Error fetching IV data:', error);
    }
  };

  // Build chart data from snapshots
  useEffect(() => {
    if (snapshots.length === 0) {
      setChartData([]);
      return;
    }

    const points: ChartPoint[] = snapshots.map((snap) => ({
      time: snap.time,
      // Primary: WING IV changes (OTM)
      putWingChange: snap.putWingIVChangePct ?? null,
      callWingChange: snap.callWingIVChangePct ?? null,
      // Secondary: ATM IV changes (for reference)
      putAtmChange: snap.putAtmIVChangePct ?? null,
      callAtmChange: snap.callAtmIVChangePct ?? null,
      // Skew changes
      putSkewChange: snap.putSkewChangePct ?? null,
      callSkewChange: snap.callSkewChangePct ?? null,
      // Differential (main summary)
      volDifferential: snap.volDifferentialPct ?? snap.ivDifferentialPct,
      // Raw IV values
      putWingIV: snap.putWingIV ?? null,
      callWingIV: snap.callWingIV ?? null,
      putAtmIV: snap.putAtmIV ?? null,
      callAtmIV: snap.callAtmIV ?? null,
    }));

    setChartData(points);
  }, [snapshots]);

  // Poll data every 5 seconds
  useEffect(() => {
    fetchIVData();

    pollIntervalRef.current = setInterval(() => {
      if (isLive) {
        fetchIVData();
      }
    }, 5000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isLive]);

  const currentSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

  return (
    <div className={styles.container}>
      {/* HEADER */}
      <header className={styles.header}>
        <div className={styles.headerTitle}>
          <h1>ES 0DTE ATM IMPLIED VOLATILITY</h1>
          <p className={styles.subtitle}>Real-Time Put vs Call IV Change</p>
        </div>
        <div className={styles.headerStatus}>
          <div className={styles.liveIndicator}>
            <span className={isLive ? styles.live : styles.paused}>●</span>
            <span className={styles.liveText}>{isLive ? 'LIVE' : 'PAUSED'}</span>
          </div>
          <div className={styles.updateInfo}>
            <div>Last update: {lastUpdate}</div>
            <div>Refresh: {isLive ? '5 sec' : '—'}</div>
          </div>
        </div>
      </header>

      {/* ES PANEL */}
      <section className={styles.esPanel}>
        <div className={styles.panelTitle}>ES FUTURE</div>
        <div className={styles.esData}>
          <div className={styles.dataItem}>
            <span className={styles.label}>ES:</span>
            <span className={styles.value}>{currentSnapshot?.esPrice?.toFixed(2) ?? '—'}</span>
          </div>
          <div className={styles.dataItem}>
            <span className={styles.label}>ATM:</span>
            <span className={styles.value}>{currentSnapshot?.atmStrike?.toFixed(0) ?? '—'}</span>
          </div>
          <div className={styles.dataItem}>
            <span className={styles.label}>Expiry:</span>
            <span className={styles.value}>0DTE (Today)</span>
          </div>
          <div className={styles.dataItem}>
            <span className={styles.label}>Update:</span>
            <span className={styles.value}>{currentSnapshot?.time ?? '—'}</span>
          </div>
        </div>
      </section>

      {/* MAIN CHART - WING IV Changes (PRIMARY SIGNAL) */}
      <section className={styles.chartSection}>
        <div className={styles.chartHeader}>
          <h2>ES 0DTE — WING (OTM) IMPLIED VOLATILITY CHANGE</h2>
          <div className={styles.chartControls}>
            <label>
              Lookback:
              <select value={lookback} onChange={(e) => setLookback(e.target.value as any)}>
                <option value="5s">5 sec</option>
                <option value="30s">30 sec</option>
                <option value="1m">1 min</option>
                <option value="5m">5 min</option>
              </select>
            </label>
            <button
              className={styles.liveButton}
              onClick={() => setIsLive(!isLive)}
            >
              {isLive ? 'PAUSE' : 'RESUME'}
            </button>
          </div>
        </div>

        <div className={styles.mainChart}>
          {chartData.length > 0 ? (
            <Line
              ref={mainChartRef}
              data={{
                labels: chartData.map((p) => p.time),
                datasets: [
                  {
                    label: 'PUT WING IV Change %',
                    data: chartData.map((p) => p.putWingChange),
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    tension: 0.1,
                  },
                  {
                    label: 'CALL WING IV Change %',
                    data: chartData.map((p) => p.callWingChange),
                    borderColor: '#0ea5e9',
                    backgroundColor: 'rgba(14, 165, 233, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    tension: 0.1,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                  legend: {
                    display: true,
                    position: 'top',
                    labels: {
                      padding: 15,
                      font: { size: 12, weight: 600 },
                      usePointStyle: true,
                    },
                  },
                  tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    padding: 12,
                    titleFont: { size: 12 },
                    bodyFont: { size: 11 },
                    callbacks: {
                      afterLabel(context) {
                        const idx = context.dataIndex;
                        const snap = snapshots[idx];
                        if (!snap) return '';
                        return [
                          `ES: ${snap.esPrice?.toFixed(2)}`,
                          `ATM: ${snap.atmStrike?.toFixed(0)}`,
                        ];
                      },
                    },
                  },
                },
                scales: {
                  x: {
                    display: true,
                    grid: { display: false },
                    ticks: { maxRotation: 0, font: { size: 10 } },
                  },
                  y: {
                    display: true,
                    position: 'left',
                    title: { display: true, text: 'IV Change %' },
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { font: { size: 10 } },
                  },
                },
              }}
            />
          ) : (
            <div className={styles.noData}>No data available</div>
          )}
        </div>
      </section>

      {/* DIFFERENTIAL CHART */}
      <section className={styles.diffChartSection}>
        <div className={styles.chartHeader}>
          <h2>PUT vs CALL IV DIFFERENTIAL</h2>
        </div>
        <div className={styles.diffChart}>
          {chartData.length > 0 ? (
            <Line
              ref={diffChartRef}
              data={{
                labels: chartData.map((p) => p.time),
                datasets: [
                  {
                    label: 'Differential %',
                    data: chartData.map((p) => p.volDifferential),
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    tension: 0.1,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    padding: 10,
                    titleFont: { size: 11 },
                    bodyFont: { size: 10 },
                  },
                },
                scales: {
                  x: {
                    display: true,
                    grid: { display: false },
                    ticks: { maxRotation: 0, font: { size: 9 } },
                  },
                  y: {
                    display: true,
                    title: { display: true, text: 'Differential %' },
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { font: { size: 9 } },
                  },
                },
              }}
            />
          ) : (
            <div className={styles.noData}>No data</div>
          )}
        </div>
      </section>

      {/* SUMMARY PANEL */}
      <section className={styles.summaryPanel}>
        <div className={styles.summaryTitle}>WING IV (OTM) — PRIMARY SIGNAL</div>
        <div className={styles.summaryGrid}>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>PUT WING IV</div>
            <div className={styles.summaryValue}>
              {(currentSnapshot?.putWingIV ?? currentSnapshot?.weightedPutIV)?.toFixed(2) ?? '—'}%
            </div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>PUT WING Δ</div>
            <div
              className={`${styles.summaryValue} ${
                (currentSnapshot?.putWingIVChangePct ?? 0) > 0
                  ? styles.positive
                  : styles.negative
              }`}
            >
              {currentSnapshot?.putWingIVChangePct
                ? (currentSnapshot.putWingIVChangePct > 0 ? '+' : '') +
                  currentSnapshot.putWingIVChangePct.toFixed(2)
                : '—'}
              %
            </div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>CALL WING IV</div>
            <div className={styles.summaryValue}>
              {(currentSnapshot?.callWingIV ?? currentSnapshot?.weightedCallIV)?.toFixed(2) ?? '—'}%
            </div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>CALL WING Δ</div>
            <div
              className={`${styles.summaryValue} ${
                (currentSnapshot?.callWingIVChangePct ?? 0) > 0
                  ? styles.positive
                  : styles.negative
              }`}
            >
              {currentSnapshot?.callWingIVChangePct
                ? (currentSnapshot.callWingIVChangePct > 0 ? '+' : '') +
                  currentSnapshot.callWingIVChangePct.toFixed(2)
                : '—'}
              %
            </div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>DIFFERENTIAL</div>
            <div
              className={`${styles.summaryValue} ${
                (currentSnapshot?.ivDifferentialPct ?? 0) > 0
                  ? styles.positive
                  : styles.negative
              }`}
            >
              {currentSnapshot?.ivDifferentialPct
                ? (currentSnapshot.ivDifferentialPct > 0 ? '+' : '') +
                  currentSnapshot.ivDifferentialPct.toFixed(2)
                : '—'}
              %
            </div>
          </div>
          <div className={styles.summaryItem}>
            <div className={styles.summaryLabel}>LOOKBACK</div>
            <div className={styles.summaryValue}>{lookback}</div>
          </div>
        </div>
      </section>

      {/* STRIKE DETAILS */}
      <section className={styles.strikeDetails}>
        <div className={styles.strikeTitle}>STRIKE DETAILS</div>
        <div className={styles.strikeGrid}>
          <div className={styles.strikeColumn}>
            <h3>PUTS</h3>
            {currentSnapshot?.putsData && currentSnapshot.putsData.length > 0 ? (
              <ul className={styles.strikeList}>
                {currentSnapshot.putsData.map((opt, i) => (
                  <li
                    key={i}
                    className={
                      opt.strike === currentSnapshot.atmStrike
                        ? styles.atmStrike
                        : ''
                    }
                  >
                    <span className={styles.strike}>{opt.strike.toFixed(0)}</span>
                    <span className={styles.iv}>IV: {opt.iv?.toFixed(2) ?? '—'}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.noData}>No data</div>
            )}
          </div>
          <div className={styles.strikeColumn}>
            <h3>CALLS</h3>
            {currentSnapshot?.callsData && currentSnapshot.callsData.length > 0 ? (
              <ul className={styles.strikeList}>
                {currentSnapshot.callsData.map((opt, i) => (
                  <li
                    key={i}
                    className={
                      opt.strike === currentSnapshot.atmStrike
                        ? styles.atmStrike
                        : ''
                    }
                  >
                    <span className={styles.strike}>{opt.strike.toFixed(0)}</span>
                    <span className={styles.iv}>IV: {opt.iv?.toFixed(2) ?? '—'}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.noData}>No data</div>
            )}
          </div>
        </div>
      </section>

      {/* STATUS */}
      <footer className={styles.footer}>
        <div className={styles.statusBox}>
          <p>
            <strong>Status:</strong> {snapshots.length > 0 ? 'Connected' : 'Waiting for data'} | <strong>Points:</strong> {snapshots.length}
          </p>
        </div>
      </footer>
    </div>
  );
}
