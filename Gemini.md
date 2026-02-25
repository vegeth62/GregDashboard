# GEMINI.md — Greg Dashboard: Project Reference

> Questo file è la **fonte di verità** per chiunque (umano o AI) lavori su questo progetto.
> Aggiornarlo ad ogni sviluppo significativo è obbligatorio.

---

## 1. Panoramica del Progetto

**Greg Dashboard** è un'applicazione web personale a uso esclusivo di **Gregorio** per:

1. **Market Monitor** — monitoraggio in tempo reale di VIX (Volatility Index) e ES=F (S&P 500 Futures) con grafici interattivi, durante la finestra di trading 15:00–23:00 CET. Archiviazione e consultazione delle sessioni storiche per data.
2. **Finance Input** — registrazione manuale di transazioni finanziarie personali (entrate/uscite) in un CSV locale.

**URL di produzione:** [https://vix-es-monitor.vercel.app](https://vix-es-monitor.vercel.app)
**Repository GitHub:** [https://github.com/vegeth62/GregDashboard](https://github.com/vegeth62/GregDashboard)

---

## 2. Architettura

```
Prova Greg/
├── frontend/                    # App Next.js (deployed su Vercel)
│   ├── src/app/
│   │   ├── page.tsx             # Root → redirect a /login
│   │   ├── login/page.tsx       # Pagina di autenticazione
│   │   ├── market/page.tsx      # ★ Market Monitor (componente principale)
│   │   ├── input/page.tsx       # Form inserimento transazioni
│   │   └── api/
│   │       ├── market/
│   │       │   ├── route.ts     # API: dati live Yahoo Finance + archivio sessioni
│   │       │   └── sessions/
│   │       │       └── route.ts # API: lista sessioni archiviate
│   │       └── finance/
│   │           └── route.ts     # API: salva transazione via Python script
│   ├── next.config.ts           # transpilePackages: ['chartjs-plugin-zoom']
│   ├── package.json
│   └── .vercel/                 # Config Vercel (projectId linked)
│
├── execution/                   # Script Python deterministici
│   ├── fetch_market_data.py     # Fetch VIX + ES=F da yfinance (standalone, non usato dall'API)
│   └── save_transaction.py     # Salva transazione in .tmp/transactions.csv
│
├── directives/
│   └── add_transaction.md      # SOP per aggiungere transazioni
│
├── .tmp/
│   └── transactions.csv        # Storico transazioni (locale, non committato)
│
├── data/market/                 # [locale] Sessioni storiche JSON: YYYY-MM-DD.json
│   └── YYYY-MM-DD.json         # Su Vercel: scrive in /tmp/market/ (volatile)
│
├── Gemini.md                   # Istruzioni operative per l'agente AI
└── GEMINI.md                   # ← questo file (reference tecnica di progetto)
```

---

## 3. Stack Tecnologico

| Layer | Tecnologia | Versione |
|---|---|---|
| Framework | Next.js | 16.1.6 |
| UI | React | 19.x |
| Styling | Tailwind CSS | v4 |
| Grafici | Chart.js + react-chartjs-2 | 4.5.x |
| Zoom grafico | chartjs-plugin-zoom | 2.2.x |
| Annotazioni | chartjs-plugin-annotation | 3.1.x |
| Data source | yahoo-finance2 (Node.js) | 3.13.x |
| Python scripts | yfinance (Python) | — |
| Deploy | Vercel | — |
| Language | TypeScript + Python 3 | — |

---

## 4. Autenticazione

- **Meccanismo**: client-side, hardcoded in `login/page.tsx`
- **Credenziali**: `Gregorio` / `Pinzolo26`
- **Token**: `localStorage.setItem('market_auth', 'true')` — verificato in `market/page.tsx` via `useEffect`
- **⚠️ Nota:** non è un sistema sicuro per multi-utente. Va bene per uso personale su Vercel con URL non pubblico.

---

## 5. Market Monitor — Logica Dettagliata

### 5.1 Polling e Finestra Oraria

```
15:00 ──────────────────────── 23:00
  │  Polling ogni 5 secondi      │
  │  Dati salvati su disco/tmp   │
  └──────────────────────────────┘
  Prima e dopo: status = 'paused', dati visibili
```

- **`isInTradingHours()`** → `getHours() >= 15 && < 23`
- **Session reset**: alle `15:00:00` (rilevato via watcher ogni 30s), il localStorage del giorno viene svuotato e il grafico riparte da zero
- **Watcher**: `setInterval` ogni 30s controlla la transizione 15:00 e 23:00

### 5.2 Persistence Strategy

| Storage | Cosa contiene | Durata |
|---|---|---|
| `localStorage.marketData_YYYY-MM-DD` | Tutti i data points del giorno | Fino alla prossima 15:00 |
| `localStorage.marketRefLines` | Reference lines (R1/R2 up/down) | Permanente |
| `localStorage.marketRefLineVisibility` | Visibilità delle reference lines | Permanente |
| Disco: `../data/market/YYYY-MM-DD.json` | Archivio sessioni (locale) | Permanente |
| `/tmp/market/YYYY-MM-DD.json` | Archivio sessioni (Vercel) | Volatile (cold start) |

### 5.3 Flusso Mount della pagina `/market`

1. Check auth → se fail, redirect `/login`
2. Controlla `isTradingJustStarted()` → se sì, clear localStorage oggi
3. Carica `marketData_YYYY-MM-DD` da localStorage (fast first render)
4. Fetch `/api/market?history=true` (yfinance intraday) per colmare i gap
5. Se dentro finestra oraria → start polling ogni 5s
6. Watcher 30s per rilevare inizio/fine sessione
7. Fetch `/api/market/sessions` per popolare il picker storico

### 5.4 API Routes

#### `GET /api/market`
- **No params** → prezzo live da `yahoo-finance2.quote()` + archivio su disco se 15:00–23:00
- **`?history=true`** → dati intraday da `yahoo-finance2.chart()` (da inizio giornata)
- **`?date=YYYY-MM-DD`** → legge file JSON archivio per quella data

#### `GET /api/market/sessions`
- Lista tutti i file `.json` in `DATA_DIR`, ordine decrescente

### 5.5 Grafico

- **Chart.js** con doppio asse Y: `y-left` (VIX, blu) e `y-right` (ES=F, verde)
- **Zoom**: `chartjs-plugin-zoom` — wheel zoom + pinch + pan. Caricato dinamicamente (`import()`) per evitare SSR issues
- **Aggiornamento imperativo**: i dati vengono iniettati direttamente nell'istanza di Chart.js (`chart.data.labels = ...`) per preservare lo stato di zoom durante il polling
- **Crosshair**: plugin custom disegna linee verticale/orizzontale che seguono il mouse
- **Annotazioni**: reference lines orizzontali configurabili (R1 Down, R2 Down, R2 Up, R1 Up) con colori dedicati

---

## 6. Finance Input

- **UI**: form semplice su `/input` con campi: data, tipo (Income/Expense), importo, categoria, descrizione
- **API**: `POST /api/finance` → spawna `execution/save_transaction.py` via `child_process.spawn`
- **Output**: `.tmp/transactions.csv` (append)
- **⚠️ Non funziona su Vercel** (spawna Python, non disponibile in serverless). Solo locale.

---

## 7. Script Python

### `execution/fetch_market_data.py`
- Fetch VIX + ES=F da `yfinance`
- Modalità: `--history` (dati intraday 1m) oppure live (prezzo corrente)
- **Non usato dall'API Next.js** — standalone, per uso manuale o futuro

### `execution/save_transaction.py`
- CLI: `--date`, `--amount`, `--description`, `--category`, `--type`
- Scrive in `.tmp/transactions.csv`
- Chiamato da `POST /api/finance`

---

## 8. Deployment

### Vercel (produzione)
> Il progetto usa **Vercel** come unica piattaforma di deploy. Firebase è stato rimosso.
```bash
cd frontend
npx vercel --prod --yes
```
- Project ID: `prj_VLjZwbLGQA9qRsQyPMAmCTfbCoih`
- Org ID: `team_9FJxwQaAEJO9gqf2WcPeiFPu`
- **⚠️ Filesystem**: solo `/tmp` è scrivibile. Le sessioni storiche su Vercel sono in `/tmp/market/` e si perdono ad ogni cold start.

### Locale (sviluppo)
```bash
cd frontend
npm run dev          # http://localhost:3000
```
- Le sessioni storiche vengono salvate in `../data/market/` (relativo alla root del progetto)

### GitHub
```bash
git add -A && git commit -m "..." && git push origin main
```

---

## 9. Problemi Noti e Workaround

| Problema | Causa | Workaround / Fix Pianificato |
|---|---|---|
| Sessioni storiche perse su Vercel | `/tmp` volatile su serverless | Integrare **Vercel KV** o **Firestore** |
| Finance Input non funziona su Vercel | `child_process.spawn` no-go in serverless | Riscrivere `save_transaction.py` in TypeScript come API route |
| Auth hardcoded | Soluzione semplice | OK per uso personale. Se multi-utente: JWT + DB |
| `yahoo-finance2` può fallire per rate limiting | API non ufficiale | Retry con backoff o cache lato server |

---

## 10. Sviluppi Futuri (Backlog)

- [ ] **Persistenza sessioni su Vercel** → Vercel KV Storage (`@vercel/kv`)
- [ ] **Finance su Vercel** → riscrivere `save_transaction` come API route TypeScript con storage cloud (es. Google Sheets API o Supabase)
- [ ] **Dashboard analytics** → pagina con grafici delle transazioni (spese per categoria, trend mensile)
- [ ] **Notifiche** → alert quando VIX supera soglie configurabili
- [ ] **Autenticazione robusta** → nextauth.js o JWT
- [ ] **Export dati** → download CSV delle sessioni storiche

---

## 11. Convenzioni di Sviluppo

- **Tailwind**: usare classi Tailwind con viewport responsive (`md:`, `lg:`)
- **Palette**: slate-950/900 per background, blue-400 per VIX, green-400 per ES=F, purple per historical mode
- **TypeScript strict**: nessun `any` non giustificato; interfacce esplicite per tutti i data shape
- **Chart updates**: sempre imperativi (`chart.data... + chart.update('none')`) per preservare zoom
- **Polling**: gestire sempre il cleanup del `clearInterval` nel return dell'`useEffect`
- **Commit style**: `feat:`, `fix:`, `refactor:`, `chore:` prefix

---

*Ultima modifica: 2026-02-20 — Antigravity AI*