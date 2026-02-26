import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { createClient } from '@supabase/supabase-js';

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

        // --- Serve archived session from Supabase ---
        if (dateParam) {
            const { data, error } = await supabase
                .from('market_data')
                .select('time, vix, esf, created_at')
                .eq('date', dateParam)
                .order('created_at', { ascending: true });

            if (error) throw error;
            const history = (data || []).map((item: any) => ({
                ...item,
                time: new Date(item.created_at).toLocaleTimeString('it-IT', {
                    timeZone: 'Europe/Rome',
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                })
            }));
            return NextResponse.json({ date: dateParam, history }, { status: 200 });
        }

        // --- Intraday history for today ---
        if (historyMode) {
            const today = getTodayKey();
            const { data, error } = await supabase
                .from('market_data')
                .select('time, vix, esf, created_at')
                .eq('date', today)
                .order('created_at', { ascending: true });

            if (error) throw error;

            // If Supabase is empty for today, fallback to yfinance for the first load
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

            const history = data.map((item: any) => ({
                ...item,
                time: new Date(item.created_at).toLocaleTimeString('it-IT', {
                    timeZone: 'Europe/Rome',
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                })
            }));

            return NextResponse.json({ history }, { status: 200 });

        } else {
            // --- Latest price mode ---
            const [vixQuote, esfQuote] = await Promise.all([
                yahooFinance.quote('^VIX') as any,
                yahooFinance.quote('ES=F') as any
            ]);

            const vixPrice = vixQuote.regularMarketPrice
                ? Math.round(vixQuote.regularMarketPrice * 100) / 100
                : null;
            const esfPrice = esfQuote.regularMarketPrice
                ? Math.round(esfQuote.regularMarketPrice * 100) / 100
                : null;

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
