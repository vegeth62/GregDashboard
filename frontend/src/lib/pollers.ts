import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Next runs from `frontend/`, i poller vivono nella root del repo.
const ROOT_DIR = path.join(process.cwd(), '..');
const LOCK_FILE = path.join(ROOT_DIR, '.tmp', 'pollers.lock');
const LOG_DIR = path.join(ROOT_DIR, '.tmp', 'poller-logs');

const POLLER_SCRIPTS = [
    'execution/tws_poller.py',
    'execution/tws_volumes_poller.py',
];

type Lock = { pids: number[]; startedAt: string };

/** Il segnale 0 non viene inviato: serve solo a verificare che il PID esista. */
function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readLock(): Lock | null {
    try {
        return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) as Lock;
    } catch {
        return null;
    }
}

/** PID registrati nel lock che risultano ancora vivi. */
export function runningPollerPids(): number[] {
    const lock = readLock();
    if (!Array.isArray(lock?.pids)) return [];
    return lock.pids.filter(isAlive);
}

export type StartResult = {
    started: boolean;
    pids: number[];
    message: string;
};

/**
 * Avvia i due poller come processi detached.
 * Senza `force`, non fa nulla se il lock indica poller già vivi: evita
 * duplicati a ogni restart del dev server (che riesegue instrumentation).
 */
export function startPollers({ force = false } = {}): StartResult {
    const alive = runningPollerPids();
    if (alive.length > 0 && !force) {
        return {
            started: false,
            pids: alive,
            message: `Poller già attivi (PID ${alive.join(', ')})`,
        };
    }

    fs.mkdirSync(LOG_DIR, { recursive: true });

    const pids: number[] = [];
    for (const script of POLLER_SCRIPTS) {
        // Senza questo l'output finiva in 'ignore': un push su Supabase che
        // falliva restava invisibile per mesi. Ora ogni poller ha il suo log.
        const logFile = path.join(LOG_DIR, `${path.basename(script, '.py')}.log`);
        const fd = fs.openSync(logFile, 'a');
        fs.writeSync(fd, `\n=== avvio ${new Date().toISOString()} ===\n`);

        // `-u` disattiva il buffering di Python, altrimenti il log resta
        // vuoto finche' il buffer non si riempie.
        const child = spawn('python', ['-u', script], {
            cwd: ROOT_DIR,
            detached: true,
            stdio: ['ignore', fd, fd],
        });
        // spawn non lancia in modo sincrono se `python` non è nel PATH.
        child.on('error', (err) => {
            console.error(`[pollers] impossibile avviare ${script}:`, err.message);
        });
        child.unref();
        // Il figlio ha la sua copia del descrittore: qui possiamo chiuderlo.
        fs.closeSync(fd);
        if (child.pid) pids.push(child.pid);
    }

    const lock: Lock = { pids, startedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2));

    return {
        started: true,
        pids,
        message: `Poller avviati (PID ${pids.join(', ')}) - log in .tmp/poller-logs/`,
    };
}
