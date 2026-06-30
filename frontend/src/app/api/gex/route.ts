// frontend/src/app/api/gex/route.ts
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

export async function GET() {
  try {
    // Determine date (today) to locate data file
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    // Look for local persistent data first
    const localPath = path.resolve(process.cwd(), '..', 'data', 'gex', `${today}.json`);
    let data;
    try {
      const raw = await fs.readFile(localPath, 'utf-8');
      data = JSON.parse(raw);
    } catch {
      // Fallback to generating synthetic data via Python script (execution/gexbot.py)
      const scriptPath = path.resolve(process.cwd(), '..', 'execution', 'gexbot.py');
      // Use child_process to exec python (works locally only)
      const { execFile } = await import('child_process');
      const result = await new Promise<string>((resolve, reject) => {
        execFile('python', [scriptPath], (error, stdout, stderr) => {
          if (error) reject(stderr || error.message);
          else resolve(stdout);
        });
      });
      data = JSON.parse(result);
    }
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Unexpected error' }, { status: 500 });
  }
}
