import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const yahooFinance = new (YahooFinance as any)();

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';
const supabase = createClient(supabaseUrl, supabaseKey);

export const dynamic = 'force-dynamic';

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
        const dateParam = searchParams.get('date'); // e.g. ?date=2026-02-19

        const isSupabaseConfigured = supabaseUrl !== 'https://placeholder.supabase.co';

        const getLocalData = (dateStr: string) => {
            try {
                const dataPath = path.join(process.cwd(), '..', 'data', 'market', `${dateStr}.json`);
                if (fs.existsSync(dataPath)) {
                    const content = fs.readFileSync(dataPath, 'utf-8');
                    return JSON.parse(content);
                }
            } catch (e) {
                console.error('Local JSON Error:', e);
            }
            return null;
        };

        const formatHistory = (data: any[]) => {
            return (data || []).map((item: any) => ({
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

        // --- Serve archived session ---
        if (dateParam) {
            let data = null;
            if (isSupabaseConfigured) {
                try {
                    const res = await supabase
                        .from('market_data')
                        .select('time, vix, esf, created_at')
                        .eq('date', dateParam)
                        .order('created_at', { ascending: true });
                    data = res.data;
                } catch (e) { console.error('Supabase fetch failed:', e); }
            }
            if (!data || data.length === 0) data = getLocalData(dateParam);

            return NextResponse.json({ date: dateParam, history: formatHistory(data || []) }, { status: 200 });
        }

        // --- Intraday history for today ---
        if (historyMode) {
            const today = getTodayKey();
            let data = null;

            if (isSupabaseConfigured) {
                try {
                    const res = await supabase
                        .from('market_data')
                        .select('time, vix, esf, created_at')
                        .eq('date', today)
                        .order('created_at', { ascending: true });
                    data = res.data;
                } catch (e) { console.error('Supabase fetch failed:', e); }
            }
            if (!data || data.length === 0) data = getLocalData(today);

            // If local/Supabase is empty for today, fallback to yfinance for the first load
            if (!data || data.length === 0) {
                const now = new Date();
                const startOfDay = new Date(now);
                startOfDay.setHours(0, 0, 0, 0);

                const [vixChart, esfChart] = await Promise.all([
                    yahooFinance.chart('^VIX', {
                        period1: Math.floor(startOfDay.getTime() / 1000),
                        interval: '1m'
                    }) as any,
                    yahooFinance.chart('ES=F', {
                        period1: Math.floor(startOfDay.getTime() / 1000),
                        interval: '1m'
                    }) as any
                ]);

                if (!vixChart.quotes || !esfChart.quotes) {
                    return NextResponse.json({ history: [] }, { status: 200 });
                }

                const esfMap = new Map();
                esfChart.quotes.forEach((q: any) => {
                    if (q.date && q.close !== null) {
                        const timeKey = new Date(q.date).getTime();
                        esfMap.set(timeKey, q.close);
                    }
                });

                const history: any[] = [];
                vixChart.quotes.forEach((q: any) => {
                    if (q.date && q.close !== null) {
                        const timeKey = new Date(q.date).getTime();
                        if (esfMap.has(timeKey)) {
                            history.push({
                                time: new Date(q.date).toLocaleTimeString('it-IT', {
                                    timeZone: 'Europe/Rome',
                                    hour12: false,
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                }),
                                vix: Math.round(q.close * 100) / 100,
                                esf: Math.round(esfMap.get(timeKey) * 100) / 100
                            });
                        }
                    }
                });
                return NextResponse.json({ history }, { status: 200 });
            }

            return NextResponse.json({ history: formatHistory(data) }, { status: 200 });

        } else {
            // --- Latest price mode ---
            const today = getTodayKey();
            let vixPrice = null;
            let esfPrice = null;

            if (isSupabaseConfigured) {
                try {
                    const { data, error } = await supabase
                        .from('market_data')
                        .select('vix, esf, created_at')
                        .eq('date', today)
                        .order('created_at', { ascending: false })
                        .limit(1);

                    if (!error && data && data.length > 0) {
                        vixPrice = data[0].vix;
                        esfPrice = data[0].esf;
                    }
                } catch (e) { console.error('Supabase fetch failed:', e); }
            }

            if (vixPrice === null || esfPrice === null) {
                const localData = getLocalData(today);
                if (localData && localData.length > 0) {
                    const lastPoint = localData[localData.length - 1];
                    vixPrice = lastPoint.vix;
                    esfPrice = lastPoint.esf;
                }
            }

            const now = new Date();
            return NextResponse.json({
                timestamp: now.toISOString(),
                vix: vixPrice,
                esf: esfPrice,
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
