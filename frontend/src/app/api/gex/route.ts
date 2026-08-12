// frontend/src/app/api/gex/route.ts
//
// ATTENZIONE: i dati restituiti da questa route sono SINTETICI.
// Solo il prezzo SPX di riferimento e' reale (poller IBKR); strike,
// open interest, volume e segno della gamma exposure sono generati
// casualmente. Port di execution/gexbot.py, che faceva lo stesso: e'
// stato riscritto in TypeScript perche' su Vercel non c'e' Python.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';
const supabase = createClient(supabaseUrl, supabaseKey);

class MissingIbkrSpxError extends Error {}

function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function isValidPrice(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getLocalIbkrSpx(dateStr: string): number | null {
    const candidatePaths = [
        path.join(process.cwd(), 'data', 'market', `${dateStr}.json`),
        path.join(process.cwd(), '..', 'data', 'market', `${dateStr}.json`),
    ];

    for (const dataPath of candidatePaths) {
        try {
            if (!fs.existsSync(dataPath)) continue;
            const content = fs.readFileSync(dataPath, 'utf-8');
            const points = JSON.parse(content);
            if (!Array.isArray(points)) continue;

            for (let i = points.length - 1; i >= 0; i--) {
                const spx = points[i]?.spx;
                if (isValidPrice(spx)) return spx;
            }
        } catch (e) {
            console.error('Local IBKR SPX read failed:', e);
        }
    }

    return null;
}

async function getCurrentSpx(): Promise<number | null> {
    const today = getTodayKey();
    const isSupabaseConfigured = supabaseUrl !== 'https://placeholder.supabase.co';

    if (isSupabaseConfigured) {
        try {
            const { data, error } = await supabase
                .from('market_data')
                .select('spx, created_at')
                .eq('date', today)
                .not('spx', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1);

            if (!error && data && data.length > 0 && isValidPrice(data[0].spx)) {
                return data[0].spx;
            }
        } catch (e) {
            console.error('Supabase IBKR SPX fetch failed:', e);
        }
    }

    return getLocalIbkrSpx(today);
}

async function requireCurrentSpx(): Promise<number> {
    const spx = await getCurrentSpx();
    if (spx === null) {
        throw new MissingIbkrSpxError('No IBKR SPX data available. Start the IBKR market poller and wait for a valid SPX tick.');
    }
    return spx;
}

async function generateGexData(numPoints = 300) {
    const spxBase = await requireCurrentSpx();
    const spxAligned = Math.round(spxBase / 5) * 5;

    const strikes: number[] = [];
    for (let offset = -100; offset <= 100; offset += 5) strikes.push(spxAligned + offset);

    // Serie che parte dalle 13:30 UTC (apertura 9:30 ET), passo 1 minuto.
    const start = new Date();
    start.setUTCHours(13, 30, 0, 0);

    const data: { time: string; strike: number; gex: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
        const t = new Date(start.getTime() + i * 60_000);
        const time = t.toISOString().slice(11, 19);

        for (const strike of sample(strikes, randInt(3, 8))) {
            // La gamma e' piu' densa vicino allo strike ATM.
            const magnitude = Math.max(10, 100 - Math.abs(strike - spxBase));
            const oi = randInt(50, 400);
            const vol = randInt(10, 80);
            const sign = Math.random() < 0.5 ? -1 : 1;
            const gex = sign * oi * vol * 0.01 * (magnitude / 100);
            data.push({ time, strike, gex: Math.round(gex * 100) / 100 });
        }
    }
    return data;
}

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Estrae `count` elementi distinti a caso, come random.sample di Python. */
function sample<T>(items: T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    for (let i = 0; i < count && pool.length > 0; i++) {
        out.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
    }
    return out;
}

export async function GET() {
    try {
        return NextResponse.json(await generateGexData());
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unexpected error';
        const status = e instanceof MissingIbkrSpxError ? 503 : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
