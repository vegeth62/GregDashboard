import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

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
        const dateParam = searchParams.get('date');

        const targetDate = dateParam || getTodayKey();
        
        const dataPath = path.join(process.cwd(), 'data', 'volumes', `${targetDate}.json`);
        
        if (fs.existsSync(dataPath)) {
            const content = fs.readFileSync(dataPath, 'utf-8');
            try {
                const data = JSON.parse(content);
                return NextResponse.json({ date: targetDate, history: data }, { status: 200 });
            } catch (e) {
                return NextResponse.json({ error: 'Failed to parse JSON' }, { status: 500 });
            }
        } else {
            return NextResponse.json({ history: [] }, { status: 200 });
        }
    } catch (error: any) {
        console.error('Volume API Error:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: error.message },
            { status: 500 }
        );
    }
}
