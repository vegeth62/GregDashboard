import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

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
        const targetDate = searchParams.get('date') || getTodayKey();

        // Su Vercel esiste solo questa strada: il filesystem non ha i JSON
        // dei poller, che girano sulla macchina locale.
        if (supabase) {
            const { data, error } = await supabase
                .from('volumes_data')
                .select('payload')
                .eq('date', targetDate)
                .maybeSingle();

            if (error) {
                console.error('Volumes Supabase error:', error.message);
            } else if (data?.payload) {
                return NextResponse.json({ date: targetDate, history: data.payload }, { status: 200 });
            }
        }

        const dataPath = path.join(process.cwd(), 'data', 'volumes', `${targetDate}.json`);
        if (fs.existsSync(dataPath)) {
            const content = fs.readFileSync(dataPath, 'utf-8');
            try {
                return NextResponse.json({ date: targetDate, history: JSON.parse(content) }, { status: 200 });
            } catch {
                return NextResponse.json({ error: 'Failed to parse JSON' }, { status: 500 });
            }
        }

        return NextResponse.json({ date: targetDate, history: [] }, { status: 200 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Volume API Error:', message);
        return NextResponse.json({ error: 'Internal Server Error', details: message }, { status: 500 });
    }
}
