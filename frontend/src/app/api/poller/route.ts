import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST() {
    try {
        const rootDir = path.join(process.cwd(), '..');
        
        // Poller 1: TWS Poller
        const p1 = spawn('python', ['execution/tws_poller.py'], {
            cwd: rootDir,
            detached: true,
            stdio: 'ignore'
        });
        p1.unref();

        // Poller 2: Volumes Poller
        const p2 = spawn('python', ['execution/tws_volumes_poller.py'], {
            cwd: rootDir,
            detached: true,
            stdio: 'ignore'
        });
        p2.unref();

        return NextResponse.json({ success: true, message: 'Poller avviati in background' }, { status: 200 });
    } catch (err: any) {
        console.error('Failed to start pollers:', err);
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}
