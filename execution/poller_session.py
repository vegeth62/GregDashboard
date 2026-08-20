"""
Tiene in piedi un poller senza che nessuno lo riavvii a mano.

I tre poller avevano tutti la stessa forma: `main()` si collegava a TWS,
sceglieva la catena 0DTE di *quel* momento, si abbonava ai contratti e poi
girava per sempre. Bastava una qualsiasi delle tre cose qui sotto per
lasciare la giornata senza dati:

  - mezzanotte. Il file su cui scrivere veniva ricalcolato a ogni giro, ma
    la scadenza 0DTE no: restava quella scelta all'avvio. Dal giorno dopo il
    poller sembrava vivo e scriveva sul file giusto, solo che era abbonato a
    opzioni scadute.
  - TWS che si riavvia la notte. `ConnectionError: Socket disconnect` usciva
    da `main()` e il processo moriva.
  - dati non ancora disponibili all'avvio. Ogni "CRITICAL: ..." era un
    `return`, cioe' una morte definitiva: il poller IV riavviato alle 08:27
    non trovava il prezzo SPX (il cash apre alle 15:30) e chiudeva li'.

Qui la sessione diventa una cosa che finisce: quando il giorno cambia il
poller esce dal suo giro, e questo modulo lo rifa' partire da capo, con una
connessione nuova e la catena del giorno nuovo.
"""

import sys
import time
from datetime import datetime

# Connessione della sessione in corso, da chiudere prima di aprirne un'altra:
# senza questo TWS si ritrova un client fantasma per ogni tentativo.
_connessione = None


def giorno_corrente() -> str:
    return datetime.now().strftime('%Y-%m-%d')


def registra_connessione(ib) -> None:
    """Affida la connessione al modulo, che la chiude a fine sessione."""
    global _connessione
    _connessione = ib


def _chiudi_connessione() -> None:
    global _connessione
    if _connessione is None:
        return
    try:
        if _connessione.isConnected():
            _connessione.disconnect()
    except Exception:
        pass
    _connessione = None


def esegui_a_oltranza(sessione, nome: str, pausa: int = 30) -> None:
    """
    Chiama `sessione` per sempre: quando ritorna (giorno cambiato, dati non
    pronti) o solleva (TWS caduto) si aspetta `pausa` secondi e si ricomincia.

    L'unica uscita e' KeyboardInterrupt, cioe' qualcuno che ferma il processo.
    """
    while True:
        inizio = giorno_corrente()
        try:
            sessione()
            motivo = 'sessione conclusa'
        except KeyboardInterrupt:
            _chiudi_connessione()
            raise
        except Exception as e:
            motivo = f'{type(e).__name__}: {e}'
            print(f"[{nome}] sessione interrotta -> {motivo}", file=sys.stderr)

        _chiudi_connessione()

        if giorno_corrente() != inizio:
            print(f"[{nome}] giorno cambiato ({inizio} -> {giorno_corrente()}): "
                  f"nuova sessione con la catena di oggi")

        print(f"[{nome}] {motivo}, si riparte fra {pausa}s", flush=True)
        time.sleep(pausa)
