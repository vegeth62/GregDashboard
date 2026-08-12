import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const VALID_TYPES = ['Income', 'Expense'];

/** Fallback locale: stesso CSV che scriveva execution/save_transaction.py. */
function appendToCsv(row: Record<string, string>) {
    const csvPath = path.join(process.cwd(), '..', '.tmp', 'transactions.csv');
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
    const fields = ['date', 'amount', 'description', 'category', 'type'];
    if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, fields.join(',') + '\n');
    const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    fs.appendFileSync(csvPath, fields.map((f) => escape(row[f] ?? '')).join(',') + '\n');
}

export async function GET() {
    if (!supabase) return NextResponse.json({ transactions: [] });
    const { data, error } = await supabase
        .from('transactions')
        .select('date, amount, description, category, type')
        .order('date', { ascending: false })
        .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ transactions: data ?? [] });
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { date, amount, description, category, type } = body;

        if (!date || amount === undefined || amount === null || !description || !category || !type) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
            return NextResponse.json({ error: 'Date must be YYYY-MM-DD' }, { status: 400 });
        }
        const parsedAmount = Number(amount);
        if (!Number.isFinite(parsedAmount)) {
            return NextResponse.json({ error: 'Amount must be a number' }, { status: 400 });
        }
        if (!VALID_TYPES.includes(type)) {
            return NextResponse.json({ error: `Type must be one of ${VALID_TYPES.join(', ')}` }, { status: 400 });
        }

        const row = {
            date: String(date),
            amount: parsedAmount,
            description: String(description),
            category: String(category),
            type: String(type),
        };

        if (supabase) {
            const { error } = await supabase.from('transactions').insert(row);
            if (error) {
                return NextResponse.json({ error: 'Failed to save', details: error.message }, { status: 500 });
            }
            return NextResponse.json({ message: 'Transaction saved', storage: 'supabase' }, { status: 200 });
        }

        // Senza Supabase configurato si resta sul CSV locale: nessuno spawn di
        // Python, che su Vercel non esiste e su Windows falliva su `python3`.
        appendToCsv({ ...row, amount: String(parsedAmount) });
        return NextResponse.json({ message: 'Transaction saved', storage: 'csv' }, { status: 200 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Finance API Error:', message);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
