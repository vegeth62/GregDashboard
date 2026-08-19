import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';
const supabase = createClient(supabaseUrl, supabaseKey);

export const dynamic = 'force-dynamic';

// La colonna `spx` fa parte dello schema di market_data: la migrazione a
// runtime che la aggiungeva (con credenziali Postgres dirette) non serve piu'.

function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const historyMode = searchParams.get('history') === 'true';

        const isSupabaseConfigured = supabaseUrl !== 'https://placeholder.supabase.co';

        const getLocalData = (dateStr: string) => {
            try {
                const dataPath = path.join(process.cwd(), 'data', 'market', `${dateStr}.json`);
                if (fs.existsSync(dataPath)) {
                    const content = fs.readFileSync(dataPath, 'utf-8');
                    return JSON.parse(content);
                }
            } catch (e) {
                console.error('Local JSON Error:', e);
            }
            return null;
        };

        // Le colonne delle quote sono snake_case su Postgres ma la pagina le
        // legge in camelCase, come le scrive il poller nel file locale.
        const QUOTE_COLUMNS = 'call_bid, call_ask, put_bid, put_ask, es_call_bid, es_call_ask, es_put_bid, es_put_ask, es_atm_strike, spx_atm_strike, spx_ref';

        const withCamelQuotes = (row: any) => ({
            ...row,
            callBid: row.callBid ?? row.call_bid ?? null,
            callAsk: row.callAsk ?? row.call_ask ?? null,
            putBid: row.putBid ?? row.put_bid ?? null,
            putAsk: row.putAsk ?? row.put_ask ?? null,
            esCallBid: row.esCallBid ?? row.es_call_bid ?? null,
            esCallAsk: row.esCallAsk ?? row.es_call_ask ?? null,
            esPutBid: row.esPutBid ?? row.es_put_bid ?? null,
            esPutAsk: row.esPutAsk ?? row.es_put_ask ?? null,
            esAtmStrike: row.esAtmStrike ?? row.es_atm_strike ?? null,
            spxAtmStrike: row.spxAtmStrike ?? row.spx_atm_strike ?? null,
            spxRef: row.spxRef ?? row.spx_ref ?? null,
            vwap: typeof row.vwap === 'number' ? row.vwap : null,
        });

        /**
         * Scarica tutte le righe di una giornata, a pagine.
         *
         * PostgREST tronca silenziosamente a 1000 righe (`db-max-rows`): senza
         * paginare, con il poller che scrive ogni 5 secondi si perdeva tutto
         * quello che veniva dopo le prime ~83 minuti di sessione.
         */
        const fetchDayRows = async (dateStr: string, columns: string) => {
            const PAGE = 1000;
            const MAX = 30000; // ~24h a 5 secondi, con margine
            const all: any[] = [];
            for (let from = 0; from < MAX; from += PAGE) {
                const { data, error } = await supabase
                    .from('market_data')
                    .select(columns)
                    .eq('date', dateStr)
                    .order('created_at', { ascending: true })
                    .range(from, from + PAGE - 1);
                if (error) {
                    console.error('Supabase page fetch failed:', error.message);
                    break;
                }
                if (!data || data.length === 0) break;
                all.push(...data);
                if (data.length < PAGE) break;
            }
            return all;
        };

        const formatHistory = (data: any[]) => {
            return (data || []).map((raw: any) => withCamelQuotes(raw)).map((item: any) => ({
                ...item,
                time: item.time || new Date(item.created_at).toLocaleTimeString('it-IT', {
                    timeZone: 'Europe/Rome',
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                })
            }));
        };

        // Le sessioni passate restano nel database ma non si servono: qui si
        // risponde solo sulla giornata corrente, e non c'e' un `?date=` da
        // cui chiedere il resto.

        // --- Intraday history for today ---
        if (historyMode) {
            const today = getTodayKey();
            let data = null;

            if (isSupabaseConfigured) {
                try {
                    data = await fetchDayRows(today, `time, vix, esf, spx, created_at, volTide, coneUp, coneDown, vwap, ${QUOTE_COLUMNS}`);
                } catch (e) { console.error('Supabase fetch failed:', e); }
            }
            if (!data || data.length === 0) data = getLocalData(today);

            // If local/Supabase is empty for today, just return empty history
            if (!data || data.length === 0) {
                return NextResponse.json({ history: [] }, { status: 200 });
            }

            return NextResponse.json({ history: formatHistory(data) }, { status: 200 });

        } else {
            // --- Latest price mode ---
            const today = getTodayKey();
            let vixPrice = null;
            let esfPrice = null;
            let spxPrice = null;
            let quotes: Record<string, number | null> = {};
            // Orario della riga di origine: il poller scrive ogni 15 secondi
            // mentre la pagina interroga ogni 5, e senza questo appenderebbe
            // tre volte lo stesso punto.
            let sourceTime: string | null = null;

            if (isSupabaseConfigured) {
                try {
                    const { data, error } = await supabase
                        .from('market_data')
                        .select(`time, vix, esf, spx, created_at, vwap, ${QUOTE_COLUMNS}`)
                        .eq('date', today)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (!error && data && data.length > 0) {
                        vixPrice = data[0].vix;
                        esfPrice = data[0].esf;
                        spxPrice = data[0].spx ?? null;
                        quotes = withCamelQuotes(data[0]);
                        sourceTime = (data[0] as { time?: string }).time ?? null;
                    }
                } catch (e) { console.error('Supabase fetch failed:', e); }
            }

            if (vixPrice === null || esfPrice === null) {
                const localData = getLocalData(today);
                if (localData && localData.length > 0) {
                    const lastPoint = localData[localData.length - 1];
                    vixPrice = lastPoint.vix;
                    esfPrice = lastPoint.esf;
                    if (lastPoint.spx !== undefined) spxPrice = lastPoint.spx;
                    quotes = withCamelQuotes(lastPoint);
                    sourceTime = lastPoint.time ?? null;
                }
            }

            if (vixPrice === null || esfPrice === null) {
                return NextResponse.json({ error: 'No data available for today. Please ensure the poller is running.' }, { status: 404 });
            }

            const now = new Date();
            return NextResponse.json({
                timestamp: now.toISOString(),
                sourceTime,
                vwap: quotes.vwap ?? null,
                vix: vixPrice,
                esf: esfPrice,
                spx: spxPrice,
                // Quote ATM per la compilazione automatica del Range Calc:
                // le es* dalla chain ES (range delle 10:35), le altre da SPX
                // (range delle 15:35).
                callBid: quotes.callBid ?? null,
                callAsk: quotes.callAsk ?? null,
                putBid: quotes.putBid ?? null,
                putAsk: quotes.putAsk ?? null,
                esCallBid: quotes.esCallBid ?? null,
                esCallAsk: quotes.esCallAsk ?? null,
                esPutBid: quotes.esPutBid ?? null,
                esPutAsk: quotes.esPutAsk ?? null,
                esAtmStrike: quotes.esAtmStrike ?? null,
                spxAtmStrike: quotes.spxAtmStrike ?? null,
                spxRef: quotes.spxRef ?? null,
            }, { status: 200 });
        }
    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: error.message },
            { status: 500 }
        );
    }
}
