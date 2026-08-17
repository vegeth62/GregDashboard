/**
 * Lettura e scrittura delle linee di riferimento (R1/R2/R3) in localStorage.
 *
 * Le linee sono livelli di prezzo derivati da uno straddle 0DTE: valgono per
 * la giornata in cui sono state calcolate e domani non significano piu'
 * niente. Si salvano quindi con la loro data e si scartano al cambio di
 * giorno -- se restano quelle di ieri, l'applicazione automatica delle 10:35
 * si autoblocca, perche' vede r1Up gia' pieno e per rispetto di un'eventuale
 * modifica manuale non sovrascrive.
 *
 * Sta qui e non dentro una pagina perche' lo leggono sia /market sia /gex, e
 * quando il formato e' cambiato in un posto solo la seconda ha interpretato
 * il campo `date` come se fosse un livello di prezzo, mandando l'asse Y a
 * 2026.
 */

export const REF_LINES_KEY = 'marketRefLines';
export const REF_LINES_VIS_KEY = 'marketRefLineVisibility';

type Salvataggio = { date: string; values: Record<string, string> };

export function chiaveGiorno(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const g = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${g}`;
}

/**
 * Restituisce le linee salvate se sono di oggi, altrimenti `null` e ripulisce.
 * Il formato vecchio (piatto, senza data) si butta: non c'e' modo di sapere
 * di quando fosse.
 */
export function leggiRefLines(): Record<string, string> | null {
    if (typeof window === 'undefined') return null;
    const grezzo = localStorage.getItem(REF_LINES_KEY);
    if (!grezzo) return null;
    try {
        const parsed = JSON.parse(grezzo) as Partial<Salvataggio>;
        if (parsed && typeof parsed === 'object' && parsed.date && parsed.values) {
            if (parsed.date === chiaveGiorno()) return parsed.values;
        }
    } catch { /* JSON rotto: si tratta come assente */ }
    localStorage.removeItem(REF_LINES_KEY);
    return null;
}

export function salvaRefLines(values: Record<string, string>): void {
    if (typeof window === 'undefined') return;
    // Lo stato tutto vuoto e' quello iniziale: non si salva, o al primo
    // render si cancellerebbe quello appena riletto.
    if (!Object.values(values).some((v) => v)) return;
    localStorage.setItem(REF_LINES_KEY, JSON.stringify({ date: chiaveGiorno(), values }));
}

export function leggiVisibilita(): Record<string, boolean> | null {
    if (typeof window === 'undefined') return null;
    const grezzo = localStorage.getItem(REF_LINES_VIS_KEY);
    if (!grezzo) return null;
    try {
        // La visibilita' e' una preferenza, non un dato di giornata: non scade.
        return JSON.parse(grezzo) as Record<string, boolean>;
    } catch {
        return null;
    }
}
