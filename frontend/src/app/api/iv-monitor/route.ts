import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

interface IVSnapshot {
  time: string;
  timestamp: number;
  esPrice: number | null;
  atmStrike: number;
  weightedPutIV: number | null;
  weightedCallIV: number | null;
  putIVChangePct: number | null;
  callIVChangePct: number | null;
  ivDifferentialPct: number | null;
  putsData?: Array<{ strike: number; bid?: number; ask?: number; mid?: number; iv?: number | null }>;
  callsData?: Array<{ strike: number; bid?: number; ask?: number; mid?: number; iv?: number | null }>;
}

interface IVSnapshot_Supabase {
  time: string;
  es_price: number | null;
  atm_strike: number;
  weighted_put_iv: number | null;
  weighted_call_iv: number | null;
  put_iv_change_pct: number | null;
  call_iv_change_pct: number | null;
  iv_differential_pct: number | null;
  puts_data?: IVSnapshot['putsData'];
  calls_data?: IVSnapshot['callsData'];
}

async function readLocalFile(date: string): Promise<IVSnapshot[]> {
  try {
    const dataDir = path.join(process.cwd(), 'data', 'iv-monitor');
    const filePath = path.join(dataDir, `${date}.json`);

    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as IVSnapshot[];
  } catch (error) {
    console.error('Error reading local IV file:', error);
    return [];
  }
}

async function readFromSupabase(
  date: string,
  since?: string
): Promise<IVSnapshot[]> {
  try {
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return [];
    }

    let url = `${SUPABASE_URL}/rest/v1/iv_snapshots?date=eq.${date}&order=time.asc`;

    if (since) {
      url += `&time=gt.${since}`;
    }

    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('Supabase error:', response.status);
      return [];
    }

    const rows = (await response.json()) as IVSnapshot_Supabase[];

    // Map Supabase response to our format
    return rows.map((row) => ({
      time: row.time,
      timestamp: 0, // Not stored in Supabase, computed if needed
      esPrice: row.es_price,
      atmStrike: row.atm_strike,
      weightedPutIV: row.weighted_put_iv,
      weightedCallIV: row.weighted_call_iv,
      putIVChangePct: row.put_iv_change_pct,
      callIVChangePct: row.call_iv_change_pct,
      ivDifferentialPct: row.iv_differential_pct,
      putsData: row.puts_data,
      callsData: row.calls_data,
    }));
  } catch (error) {
    console.error('Error reading from Supabase:', error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sinceParam = searchParams.get('since'); // HH:MM:SS
    const limitParam = searchParams.get('limit');

    // Solo la giornata corrente: le sessioni passate restano nei file e nel
    // database ma non si servono, e non c'e' un parametro per chiederle.
    const date = new Date().toISOString().split('T')[0];

    // Try Supabase first, then local file
    let snapshots = await readFromSupabase(date, sinceParam || undefined);

    if (snapshots.length === 0) {
      snapshots = await readLocalFile(date);

      // Filter by since if provided
      if (sinceParam) {
        snapshots = snapshots.filter((s) => s.time > sinceParam);
      }
    }

    // Limit results if requested
    const limit = limitParam ? parseInt(limitParam) : undefined;
    if (limit && snapshots.length > limit) {
      snapshots = snapshots.slice(-limit);
    }

    return NextResponse.json({
      date,
      snapshots,
      count: snapshots.length,
    });
  } catch (error) {
    console.error('Error in /api/iv-monitor:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
