import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { date, amount, description, category, type } = body;

        if (!date || !amount || !description || !category || !type) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // Construct path to python script
        // Assuming the API route is running from project root context
        const scriptPath = path.join(process.cwd(), '..', 'execution', 'save_transaction.py');

        return new Promise<NextResponse>((resolve) => {
            const pythonProcess = spawn('python3', [
                scriptPath,
                '--date', date,
                '--amount', amount.toString(),
                '--description', description,
                '--category', category,
                '--type', type
            ]);

            let stdout = '';
            let stderr = '';

            pythonProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Python script exited with code ${code}`);
                    console.error(`stderr: ${stderr}`);
                    resolve(NextResponse.json({ error: 'Failed to save transaction', details: stderr }, { status: 500 }));
                } else {
                    resolve(NextResponse.json({ message: 'Transaction saved successfully', output: stdout }, { status: 200 }));
                }
            });
        });

    } catch (error) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
