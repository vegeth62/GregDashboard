// frontend/src/app/api/gex/route.ts
//
// GEX reale calcolato dal gamma IBKR e dal volume per strike.
//
// Sostituisce il generatore sintetico (port di execution/gexbot.py), che
// inventava strike, open interest, volume e segno lasciando reale il solo
// prezzo SPX. Qui tutto viene dai dati che il poller dei volumi raccoglie
// da TWS: il gamma arriva dai modelGreeks sulle stesse sottoscrizioni gia'
// aperte per il volume.
//
// Ogni punto porta DUE misure, e la pagina commuta fra le due senza rifare
// la richiesta:
//   `gex`   pesato sul volume scambiato oggi -> misura di FLUSSO
//   `gexOi` pesato sull'open interest        -> misura di POSIZIONAMENTO,
//                                               e' il GEX canonico
// L'open interest e' fermo al closing del giorno prima, quindi intraday non
// si muove: cambia solo perche' cambiano gamma e spot.
//
// In entrambi i casi non si sa chi ha comprato e chi ha venduto: il segno
// (call positive, put negative) resta l'euristica standard "dealer lunghi di
// call, corti di put", non un dato osservato.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

interface StrikeRow {
    strike: number;
    calls?: number;
    puts?: number;
    callsOi?: number;
    putsOi?: number;
    gamma?: number | null;
}

interface Snapshot {
    time: string;
    spxPrice?: number | null;
    undPrice?: number | null;
    volumes: StrikeRow[];
}

/**
 * Flusso NUOVO di uno snapshot: il gamma exposure dei soli contratti
 * scambiati da quello precedente, non il totale di giornata.
 */
interface GexPoint {
    time: string;
    strike: number;
    /** Dai contratti scambiati fra i due snapshot. */
    gex: number;
    /** Dalla variazione di open interest, intraday quasi sempre zero. */
    gexOi: number;
}

/** Totale di giornata per strike: l'ultimo valore cumulato disponibile. */
interface ProfileRow {
    strike: number;
    gex: number;
    gexOi: number;
}

/**
 * Il sottostante al momento dello snapshot, cosi' come IBKR lo vedeva quando
 * ha valutato il gamma. E' la serie giusta per la linea dello spot su una
 * pagina di gamma: viene dallo stesso istante e dallo stesso feed, non da
 * /api/market con la sua conversione di fuso fatta a mano.
 */
interface SpotPoint {
    time: string;
    price: number;
}

/** Il profilo com'era N minuti fa, per mostrare da che parte si sta muovendo. */
interface ProfileSnapshot {
    minutesAgo: number;
    time: string;
    rows: ProfileRow[];
}

/** Quanto lontano indietro guardano i pallini storici. */
const MINUTI_STORICO = [1, 5, 10];

/** Un punto di spot ogni mezzo minuto: piu' fitto non si distingue. */
const SPOT_STEP_SEC = 30;

function toSeconds(hhmmss: string): number {
    const [h, m, s] = hhmmss.split(':').map(Number);
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

/** Moltiplicatore del contratto SPX. */
const CONTRACT_SIZE = 100;

/** Minuti di scarto fra un fuso e UTC per un dato istante. */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return (asUtc - instant.getTime()) / 60000;
}

/**
 * Converte l'orario di Roma scritto dal poller nell'orario di New York che
 * la pagina GEX si aspetta.
 *
 * Non si sottraggono sei ore fisse: Europa e Stati Uniti cambiano l'ora in
 * date diverse, e per un paio di settimane l'anno lo scarto e' di cinque.
 */
function romeToNewYork(dateStr: string, timeStr: string): string {
    const guess = new Date(`${dateStr}T${timeStr}Z`);
    if (Number.isNaN(guess.getTime())) return timeStr;
    const instant = new Date(guess.getTime() - tzOffsetMinutes(guess, 'Europe/Rome') * 60000);
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/New_York', hour12: false,
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(instant);
}

function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Gamma exposure di uno strike, in milioni di dollari per un movimento
 * dell'1% del sottostante.
 *
 *   GEX = gamma * contratti * 100 * S^2 * 0.01
 *
 * `gamma` e' il gamma per punto di indice; moltiplicato per S^2 * 0.01
 * diventa la variazione di delta in dollari per un 1% di movimento. Call e
 * put entrano con segno opposto.
 */
function strikeGex(gamma: number, netContracts: number, spot: number): number {
    const dollars = gamma * netContracts * CONTRACT_SIZE * spot * spot * 0.01;
    return Math.round((dollars / 1e6) * 100) / 100;
}

/** Contratti netti di uno strike all'ultimo snapshot visto. */
interface Netti {
    vol: number;
    oi: number;
}

/**
 * Traduce gli snapshot in flusso nuovo piu' profilo cumulato.
 *
 * Il volume che il poller legge da TWS e' cumulato dall'apertura: ogni
 * snapshot porta il totale della giornata, non quanto e' passato negli
 * ultimi dieci secondi. Restituire quel totale come una serie di punti nel
 * tempo -- come si faceva finche' i dati erano sintetici, dove ogni
 * estrazione era indipendente -- disegna 900 bolle quasi identiche per
 * strike, una sopra l'altra: le legende "Addition" e "Subtraction" dicono
 * flusso ma mostrano giacenza, e il grafico diventa una banda piena
 * illeggibile che pesa due megabyte.
 *
 * Qui si separano le due domande:
 *   `points`  quanto e' stato scambiato FRA due snapshot, valutato al gamma
 *             corrente: e' il flusso, ed e' quello che ha senso disporre su
 *             un asse dei tempi. Vale zero quando nessuno ha scambiato, e in
 *             quel caso il punto non si manda proprio.
 *   `profile` il totale di giornata per strike, che e' semplicemente
 *             l'ultimo cumulato: e' quello che serve per i muri e le barre.
 *
 * Si differenziano i CONTRATTI, non il GEX: il gamma si muove a ogni
 * snapshot con lo spot e la volatilita', quindi differenziare il GEX
 * spaccerebbe per flusso anche la semplice rivalutazione di posizioni ferme.
 */
function elaboraSnapshot(
    snapshots: Snapshot[],
    dateStr: string,
    base: Map<number, Netti> | null,
    conStorico: boolean,
): { points: GexPoint[]; profile: ProfileRow[]; spot: SpotPoint[]; profileHistory: ProfileSnapshot[] } {
    const points: GexPoint[] = [];
    const precedenti = new Map<number, Netti>(base ?? []);
    const profilo = new Map<number, ProfileRow>();
    const spotSerie: SpotPoint[] = [];
    let ultimoSpotSec = -Infinity;
    let ultimoValido: SpotPoint | null = null;

    // Il profilo di N minuti fa non si ricostruisce dai `points`: quelli sono
    // differenze di contratti, mentre il profilo e' l'ultimo cumulato valutato
    // al gamma di quel momento. Si tiene invece una copia mentre si cammina,
    // ma solo sulla coda utile: dieci minuti a uno snapshot ogni dieci secondi
    // sono una sessantina di copie, non le migliaia di tutta la giornata.
    const ultimoSec = snapshots.length > 0 ? toSeconds(snapshots[snapshots.length - 1].time) : 0;
    const inizioCoda = ultimoSec - Math.max(...MINUTI_STORICO) * 60;
    const coda: { sec: number; time: string; rows: ProfileRow[] }[] = [];

    for (const snap of snapshots) {
        const timeEt = romeToNewYork(dateStr, snap.time);
        // undPrice e' il sottostante secondo IBKR, quello su cui il gamma e'
        // stato effettivamente valutato: piu' corretto di spxPrice, che prima
        // dell'apertura del cash non esiste.
        const spot = snap.undPrice ?? snap.spxPrice ?? null;
        if (!spot || !Number.isFinite(spot) || !Array.isArray(snap.volumes)) continue;

        const snapSec = toSeconds(snap.time);
        if (snapSec - ultimoSpotSec >= SPOT_STEP_SEC) {
            spotSerie.push({ time: timeEt, price: spot });
            ultimoSpotSec = snapSec;
        }

        for (const row of snap.volumes) {
            if (row.gamma == null || !Number.isFinite(row.gamma)) continue;

            const vol = (row.calls ?? 0) - (row.puts ?? 0);
            const oi = (row.callsOi ?? 0) - (row.putsOi ?? 0);

            profilo.set(row.strike, {
                strike: row.strike,
                gex: strikeGex(row.gamma, vol, spot),
                gexOi: strikeGex(row.gamma, oi, spot),
            });

            const prec = precedenti.get(row.strike);
            precedenti.set(row.strike, { vol, oi });
            // Primo snapshot che vede questo strike: non c'e' un "prima" da
            // cui misurare il flusso. Il cumulato entra comunque nel profilo.
            if (!prec) continue;

            const dVol = vol - prec.vol;
            const dOi = oi - prec.oi;
            if (dVol === 0 && dOi === 0) continue;

            points.push({
                time: timeEt,
                strike: row.strike,
                gex: strikeGex(row.gamma, dVol, spot),
                gexOi: strikeGex(row.gamma, dOi, spot),
            });
        }

        if (conStorico && snapSec >= inizioCoda) {
            coda.push({ sec: snapSec, time: timeEt, rows: [...profilo.values()] });
        }
        ultimoValido = { time: timeEt, price: spot };
    }

    // L'ultimo prezzo non deve aspettare il prossimo passo di campionamento:
    // e' quello che la pagina disegna come spot corrente.
    if (ultimoValido && spotSerie[spotSerie.length - 1]?.time !== ultimoValido.time) {
        spotSerie.push(ultimoValido);
    }

    const profileHistory: ProfileSnapshot[] = [];
    for (const minuti of MINUTI_STORICO) {
        const limite = ultimoSec - minuti * 60;
        // Il piu' recente non oltre il limite: se la sessione e' appena
        // cominciata non c'e', e quel pallino semplicemente non si disegna.
        let scelto: { sec: number; time: string; rows: ProfileRow[] } | null = null;
        for (const c of coda) {
            if (c.sec <= limite && (!scelto || c.sec > scelto.sec)) scelto = c;
        }
        if (scelto) {
            profileHistory.push({
                minutesAgo: minuti,
                time: scelto.time,
                rows: scelto.rows.sort((a, b) => a.strike - b.strike),
            });
        }
    }

    return {
        points,
        profile: [...profilo.values()].sort((a, b) => a.strike - b.strike),
        spot: spotSerie,
        profileHistory,
    };
}

function readLocalSnapshots(dateStr: string): Snapshot[] | null {
    const candidates = [
        path.join(process.cwd(), 'data', 'volumes', `${dateStr}.json`),
        path.join(process.cwd(), 'frontend', 'data', 'volumes', `${dateStr}.json`),
    ];
    for (const p of candidates) {
        try {
            if (!fs.existsSync(p)) continue;
            const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            console.error('GEX local read failed:', e);
        }
    }
    return null;
}

/**
 * L'ultimo snapshot non oltre `since`, che fa da base per il primo delta di
 * una richiesta incrementale. Una riga sola, quindi non paga la pena di
 * paginare.
 */
async function leggiSnapshotPrecedente(dateStr: string, since: string): Promise<Snapshot | null> {
    if (supabase) {
        const { data, error } = await supabase
            .from('volumes_snapshots')
            .select('time, spx_price, und_price, volumes')
            .eq('date', dateStr)
            .lte('time', since)
            .order('time', { ascending: false })
            .limit(1);
        if (!error && data && data.length > 0) {
            return {
                time: data[0].time,
                spxPrice: data[0].spx_price,
                undPrice: data[0].und_price,
                volumes: data[0].volumes as StrikeRow[],
            };
        }
        if (error) console.error('GEX base snapshot error:', error.message);
    }
    const local = readLocalSnapshots(dateStr);
    if (!local) return null;
    const prima = local.filter((s) => s.time <= since);
    return prima.length > 0 ? prima[prima.length - 1] : null;
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const targetDate = searchParams.get('date') || getTodayKey();
        const sinceParam = searchParams.get('since');
        // Ogni snapshot vale ~37 punti: senza `since` la pagina riscaricherebbe
        // l'intera giornata a ogni giro.
        const since = sinceParam && /^\d{2}:\d{2}:\d{2}$/.test(sinceParam) ? sinceParam : null;
        // `flow=0` per chi vuole solo il profilo per strike: le bolle del
        // flusso sono il 95% della risposta (mezzo megabyte a fine sessione)
        // e /spx-gamma non le disegna.
        const conFlusso = searchParams.get('flow') !== '0';

        let snapshots: Snapshot[] | null = null;

        if (supabase) {
            // PostgREST tronca a 1000 righe (`db-max-rows`) senza dire niente.
            // Il poller scrive uno snapshot ogni 10 secondi, quindi il tetto
            // arriva dopo meno di tre ore di sessione: da li' in poi il primo
            // caricamento della pagina restava fermo a meta' pomeriggio,
            // mentre gli aggiornamenti con `since` -- poche righe per volta --
            // continuavano ad arrivare. Il risultato era un grafico che
            // sembrava vivo ma con un buco in mezzo.
            const PAGE = 1000;
            const MAX = 10000; // ~28h a 10 secondi, con margine
            const righe: { time: string; spx_price: number | null; und_price: number | null; volumes: unknown }[] = [];
            let erroreDb = false;

            for (let from = 0; from < MAX; from += PAGE) {
                let query = supabase
                    .from('volumes_snapshots')
                    .select('time, spx_price, und_price, volumes')
                    .eq('date', targetDate)
                    .order('time', { ascending: true })
                    .range(from, from + PAGE - 1);
                if (since) query = query.gt('time', since);
                const { data, error } = await query;

                if (error) {
                    console.error('GEX Supabase error:', error.message);
                    erroreDb = true;
                    break;
                }
                if (!data || data.length === 0) break;
                righe.push(...data);
                if (data.length < PAGE) break;
            }

            if (!erroreDb) {
                snapshots = righe.map((r) => ({
                    time: r.time,
                    spxPrice: r.spx_price,
                    undPrice: r.und_price,
                    volumes: r.volumes as StrikeRow[],
                }));
            }
        }

        if (!snapshots || snapshots.length === 0) {
            const local = readLocalSnapshots(targetDate) ?? [];
            snapshots = since ? local.filter((s) => s.time > since) : local;
        }

        // Il flusso e' una differenza, quindi il primo snapshot dopo `since`
        // ha bisogno di quello prima di `since` per essere misurato: senza,
        // ogni giro da 30 secondi perderebbe un pezzo di scambiato.
        let base: Map<number, Netti> | null = null;
        if (since && snapshots.length > 0) {
            const precedente = await leggiSnapshotPrecedente(targetDate, since);
            if (precedente) {
                base = new Map();
                for (const row of precedente.volumes ?? []) {
                    base.set(row.strike, {
                        vol: (row.calls ?? 0) - (row.puts ?? 0),
                        oi: (row.callsOi ?? 0) - (row.putsOi ?? 0),
                    });
                }
            }
        }

        // Lo storico serve solo al primo caricamento, per non far aspettare
        // dieci minuti i pallini: dopo, il client ha gia' i profili che ha
        // ricevuto e se li tiene da solo. Con `since` la finestra e' larga
        // pochi secondi e non conterrebbe comunque niente.
        const { points, profile, spot, profileHistory } = elaboraSnapshot(snapshots, targetDate, base, !since);
        // `lastTime` e' l'ora di Roma dell'ultimo snapshot: il client la
        // rimanda come `since`. I punti invece portano l'ora di New York,
        // che e' quella su cui ragiona la pagina.
        const lastTime = snapshots.length > 0 ? snapshots[snapshots.length - 1].time : null;

        // Con `since` una risposta vuota e' normale: vuol dire solo che non
        // sono arrivati snapshot nuovi. Il 503 vale solo al primo caricamento.
        // Si guarda il profilo, non i punti: a mercato fermo puo' non essere
        // passato un solo contratto, ma le posizioni ci sono lo stesso.
        if (!since && profile.length === 0) {
            // Nessun gamma disponibile: il poller dei volumi gira solo nella
            // finestra 13:30-22:00, e prima di allora non c'e' niente da
            // calcolare. Meglio dirlo che restituire numeri inventati.
            return NextResponse.json(
                {
                    error: 'Nessun dato di gamma disponibile per ' + targetDate +
                        '. Il poller dei volumi raccoglie fra le 13:30 e le 22:00.',
                },
                { status: 503 },
            );
        }

        // Il primo caricamento non manda tutto il flusso della giornata: a
        // fine sessione sono decine di migliaia di bolle e qualche megabyte,
        // per un grafico che a quella densita' e' comunque una macchia. Si
        // manda l'ultimo tratto -- circa un'ora e mezza -- e il resto della
        // giornata resta comunque rappresentato, perche' `profile` e'
        // cumulato dall'apertura e non dipende da questo taglio.
        const MAX_PUNTI = 8000;
        const tagliati = conFlusso && points.length > MAX_PUNTI;
        const finali = conFlusso ? (tagliati ? points.slice(-MAX_PUNTI) : points) : [];

        // `profile` sostituisce quello che il client ha, non ci si somma: e'
        // gia' il totale di giornata. `points` invece si accoda.
        return NextResponse.json(
            { date: targetDate, since, lastTime, points: finali, profile, spot, profileHistory, troncato: tagliati },
            { status: 200 },
        );
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unexpected error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
