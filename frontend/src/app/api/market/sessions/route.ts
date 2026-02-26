import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';
const supabase = createClient(supabaseUrl, supabaseKey);

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // Fetch unique dates from market_data table
        // Note: In Supabase, we can use a select with unique values or a grouping
        // For efficiency, we query for distinct dates
        const { data, error } = await supabase
            .from('market_data')
            .select('date')
            .order('date', { ascending: false });

        if (error) throw error;

        // Extract unique dates from the result
        const uniqueDates = Array.from(new Set(data?.map(item => item.date))).filter(Boolean);

        return NextResponse.json({ sessions: uniqueDates }, { status: 200 });
    } catch (error: any) {
        console.error('Sessions API Error:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: error.message },
            { status: 500 }
        );
    }
}
