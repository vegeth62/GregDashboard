import { NextResponse } from 'next/server';
import { startPollers, runningPollerPids } from '@/lib/pollers';

export async function GET() {
    const pids = runningPollerPids();
    return NextResponse.json({ running: pids.length > 0, pids });
}

export async function POST() {
    try {
        // Non forza: se i poller sono già vivi (avvio automatico al boot del
        // server) non ne crea un secondo set che scriverebbe sugli stessi file.
        const result = startPollers();
        return NextResponse.json({ success: true, ...result }, { status: 200 });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Failed to start pollers:', err);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
