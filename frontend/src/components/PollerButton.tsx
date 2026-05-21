'use client';
import { useState } from 'react';

export default function PollerButton() {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    const startPollers = async () => {
        setStatus('loading');
        try {
            const res = await fetch('/api/poller', { method: 'POST' });
            if (res.ok) {
                setStatus('success');
                setTimeout(() => setStatus('idle'), 3000);
            } else {
                setStatus('error');
                setTimeout(() => setStatus('idle'), 3000);
            }
        } catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    return (
        <button
            onClick={startPollers}
            disabled={status === 'loading'}
            title="Avvia manualmente i processi Python per il polling dei dati"
            className="fixed bottom-4 right-4 z-50 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-full shadow-lg border border-slate-600 transition-colors text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-70"
        >
            {status === 'idle' && (
                <>
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                    Start Pollers
                </>
            )}
            {status === 'loading' && 'Avvio in corso...'}
            {status === 'success' && (
                <>
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse"></span>
                    Avviati!
                </>
            )}
            {status === 'error' && (
                <>
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
                    Errore
                </>
            )}
        </button>
    );
}
