/**
 * Hook eseguito da Next una volta all'avvio del server.
 * Fa partire i poller IBKR insieme all'applicazione, senza dover premere
 * il bottone "Start Pollers".
 */
export async function register() {
    // `register` gira anche nel runtime edge, dove child_process non esiste.
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    // Su Vercel non c'è runtime Python né TWS raggiungibile.
    if (process.env.VERCEL) return;
    if (process.env.AUTO_START_POLLERS === 'false') {
        console.log('[pollers] avvio automatico disattivato (AUTO_START_POLLERS=false)');
        return;
    }

    try {
        const { startPollers } = await import('./lib/pollers');
        console.log(`[pollers] ${startPollers().message}`);
    } catch (err) {
        console.error('[pollers] avvio automatico fallito:', err);
    }
}
