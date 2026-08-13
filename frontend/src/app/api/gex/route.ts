// frontend/src/app/api/gex/route.ts
//
// GEX reale calcolato dal gamma IBKR e dal volume per strike.
//
// Sostituisce il generatore sintetico (port di execution/gexbot.py), che
// inventava strike, open interest, volume e segno lasciando reale il solo
// prezzo SPX. Qui tutto viene dai dati che il poller dei volumi raccoglie
// da TWS: il gamma arriva dai modelGreeks sulle stesse sottoscrizioni gia'
// aperte per il volume.
//
// Ogni punto porta DUE misure, e la pagina commuta fra le due senza rifare
// la richiesta:
//   `gex`   pesato sul volume scambiato oggi -> misura di FLUSSO
//   `gexOi` pesato sull'open interest        -> misura di POSIZIONAMENTO,
//                                               e' il GEX canonico
// L'open interest e' fermo al closing del giorno prima, quindi intraday non
// si muove: cambia solo perche' cambiano gamma e spot.
//
// In entrambi i casi non si sa chi ha comprato e chi ha venduto: il segno
// (call positive, put negative) resta l'euristica standard "dealer lunghi di
// call, corti di put", non un dato osservato.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

interface StrikeRow {
    strike: number;
    calls?: number;
    puts?: number;
    callsOi?: number;
    putsOi?: number;
    gamma?: number | null;
}

interface Snapshot {
    time: string;
    spxPrice?: number | null;
    undPrice?: number | null;
    volumes: StrikeRow[];
}

interface GexPoint {
    time: string;
    strike: number;
    /** Pesato sul volume scambiato oggi: misura di flusso. */
    gex: number;
    /** Pesato sull'open interest: misura di posizionamento. Il GEX canonico. */
    gexOi: number;
}

/** Moltiplicatore del contratto SPX. */
const CONTRACT_SIZE = 100;

/** Minuti di scarto fra un fuso e UTC per un dato istante. */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return (asUtc - instant.getTime()) / 60000;
}

/**
 * Converte l'orario di Roma scritto dal poller nell'orario di New York che
 * la pagina GEX si aspetta.
 *
 * Non si sottraggono sei ore fisse: Europa e Stati Uniti cambiano l'ora in
 * date diverse, e per un paio di settimane l'anno lo scarto e' di cinque.
 */
function romeToNewYork(dateStr: string, timeStr: string): string {
    const guess = new Date(`${dateStr}T${timeStr}Z`);
    if (Number.isNaN(guess.getTime())) return timeStr;
    const instant = new Date(guess.getTime() - tzOffsetMinutes(guess, 'Europe/Rome') * 60000);
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/New_York', hour12: false,
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(instant);
}

function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Gamma exposure di uno strike, in milioni di dollari per un movimento
 * dell'1% del sottostante.
 *
 *   GEX = gamma * contratti * 100 * S^2 * 0.01
 *
 * `gamma` e' il gamma per punto di indice; moltiplicato per S^2 * 0.01
 * diventa la variazione di delta in dollari per un 1% di movimento. Call e
 * put entrano con segno opposto.
 */
function strikeGex(gamma: number, netContracts: number, spot: number): number {
    const dollars = gamma * netContracts * CONTRACT_SIZE * spot * spot * 0.01;
    return Math.round((dollars / 1e6) * 100) / 100;
}

function toGexPoints(snapshots: Snapshot[], dateStr: string): GexPoint[] {
    const out: GexPoint[] = [];
    for (const snap of snapshots) {
        const timeEt = romeToNewYork(dateStr, snap.time);
        // undPrice e' il sottostante secondo IBKR, quello su cui il gamma e'
        // stato effettivamente valutato: piu' corretto di spxPrice, che prima
        // dell'apertura del cash non esiste.
        const spot = snap.undPrice ?? snap.spxPrice ?? null;
        if (!spot || !Number.isFinite(spot) || !Array.isArray(snap.volumes)) continue;

        for (const row of snap.volumes) {
            if (row.gamma == null || !Number.isFinite(row.gamma)) continue;
            const gex = strikeGex(row.gamma, (row.calls ?? 0) - (row.puts ?? 0), spot);
            const gexOi = strikeGex(row.gamma, (row.callsOi ?? 0) - (row.putsOi ?? 0), spot);
            if (gex === 0 && gexOi === 0) continue;
            out.push({ time: timeEt, strike: row.strike, gex, gexOi });
        }
    }
    return out;
}

function readLocalSnapshots(dateStr: string): Snapshot[] | null {
    const candidates = [
        path.join(process.cwd(), 'data', 'volumes', `${dateStr}.json`),
        path.join(process.cwd(), 'frontend', 'data', 'volumes', `${dateStr}.json`),
    ];
    for (const p of candidates) {
        try {
            if (!fs.existsSync(p)) continue;
            const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            console.error('GEX local read failed:', e);
        }
    }
    return null;
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const targetDate = searchParams.get('date') || getTodayKey();
        const sinceParam = searchParams.get('since');
        // Ogni snapshot vale ~37 punti: senza `since` la pagina riscaricherebbe
        // l'intera giornata a ogni giro.
        const since = sinceParam && /^\d{2}:\d{2}:\d{2}$/.test(sinceParam) ? sinceParam : null;

        let snapshots: Snapshot[] | null = null;

        if (supabase) {
            let query = supabase
                .from('volumes_snapshots')
                .select('time, spx_price, und_price, volumes')
                .eq('date', targetDate)
                .order('time', { ascending: true });
            if (since) query = query.gt('time', since);
            const { data, error } = await query;

            if (error) {
                console.error('GEX Supabase error:', error.message);
            } else if (data) {
                snapshots = data.map((r) => ({
                    time: r.time,
                    spxPrice: r.spx_price,
                    undPrice: r.und_price,
                    volumes: r.volumes as StrikeRow[],
                }));
            }
        }

        if (!snapshots || snapshots.length === 0) {
            const local = readLocalSnapshots(targetDate) ?? [];
            snapshots = since ? local.filter((s) => s.time > since) : local;
        }

        const points = toGexPoints(snapshots, targetDate);
        // `lastTime` e' l'ora di Roma dell'ultimo snapshot: il client la
        // rimanda come `since`. I punti invece portano l'ora di New York,
        // che e' quella su cui ragiona la pagina.
        const lastTime = snapshots.length > 0 ? snapshots[snapshots.length - 1].time : null;

        // Con `since` una risposta vuota e' normale: vuol dire solo che non
        // sono arrivati snapshot nuovi. Il 503 vale solo al primo caricamento.
        if (!since && points.length === 0) {
            // Nessun gamma disponibile: il poller dei volumi gira solo nella
            // finestra 13:30-22:00, e prima di allora non c'e' niente da
            // calcolare. Meglio dirlo che restituire numeri inventati.
            return NextResponse.json(
                {
                    error: 'Nessun dato di gamma disponibile per ' + targetDate +
                        '. Il poller dei volumi raccoglie fra le 13:30 e le 22:00.',
                },
                { status: 503 },
            );
        }

        return NextResponse.json({ date: targetDate, since, lastTime, points }, { status: 200 });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unexpected error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
