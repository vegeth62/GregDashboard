# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal market dashboard ("Greg Dashboard") with three areas:
- **Market Monitor** (`/market`): live VIX + ES=F (S&P futures) intraday chart
- **SPX Volumes / GEX** (`/spx-volumes`, `/gex`, `/spx-gamma`): 3D and gamma-exposure visualizations of SPX option data
- **Finance Input** (`/input`): manual personal transaction log written to a local CSV

Frontend is Next.js (App Router), deployed to Vercel. Data collection is done by local Python scripts talking to Interactive Brokers TWS, which is only reachable when running on the developer's own machine — this is fundamentally a local-first tool with a cloud-deployed viewer.

Auth is a hardcoded client-side check (`Gregorio` / `Pinzolo26` in `frontend/src/app/login/page.tsx`) storing `market_auth` in `localStorage`. This is intentional for a single-user private tool — do not "fix" it into a real auth system unless asked.

## Commands

Frontend (run from `frontend/`):
```bash
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

Python (run from repo root):
```bash
pip install -r requirements.txt
pip install ib_insync          # not in requirements.txt but required by pollers

python execution/tws_poller.py          # VIX + ES=F + SPX poller (needs IBKR TWS running locally, port 7496)
python execution/tws_volumes_poller.py  # SPX option volume-by-strike poller
python execution/backfill_ibkr.py       # 1-min historical backfill for VIX/ES
python execution/init_db.py             # verify Supabase connectivity / print bootstrap SQL
python execution/check_sync.py          # read latest Supabase rows for today
```

`start_dashboard.bat` (Windows) opens the browser and hands off to `scripts/keep_dashboard_alive.ps1`, a supervisor that keeps `npm run dev` up (restarting it 15s after any exit) and POSTs `/api/poller` every minute so a poller that dies with TWS comes back. It does not launch the pollers itself: they start with the server via `frontend/src/instrumentation.ts` (skipped on Vercel, or with `AUTO_START_POLLERS=false`). There is no automated test suite in this repo.

## Architecture

### Data flow: pollers → files/Supabase → API routes → chart

Python pollers (`execution/tws_poller.py`, `execution/tws_volumes_poller.py`) connect to a locally running IBKR TWS instance, pull market/option data, and write JSON snapshot files. `tws_poller.py` also optionally pushes rows to Supabase (`push_to_supabase()` currently only sends `vix`, `esf`, `time`, `date` — NOT the derived `volTide`/`coneUp`/`coneDown` fields, so anything relying on those cloud-side will not find them).

Next.js API routes (`frontend/src/app/api/*/route.ts`) read this data back out:
- `GET /api/market` — Supabase first if configured, else local JSON fallback. No params = latest point; `?history=true` = today's intraday series; `?date=YYYY-MM-DD` = archived session.
- `GET /api/volumes` — Supabase table `volumes_snapshots` (una riga per snapshot) first, local JSON fallback. `?date=YYYY-MM-DD` as above; `?since=HH:MM:SS` returns only the snapshots after that time, which is how the page stays cheap — it fetches ~2 KB every 30s instead of re-downloading the session.
- `GET /api/gex` — **real** gamma exposure, computed in TypeScript from the same `volumes_snapshots` rows `/api/volumes` reads: gamma comes from the IBKR `modelGreeks` the volumes poller already subscribes to. This replaced the old synthetic generator (the port of `execution/gexbot.py`, still on disk but no longer invoked by anything). Every point carries two measures and the page switches between them without refetching: `gex` weighted by volume traded (a **flow** measure) and `gexOi` weighted by open interest (**positioning**, the canonical GEX — flat intraday, since OI is frozen at the previous close). The call-positive/put-negative sign is still the standard "dealers long calls, short puts" heuristic, not observed data. The response carries `points` (flow bubbles), `profile` (day total per strike), `spot` (the underlying as IBKR valued the gamma, one point per ~30s — the right series for a gamma page, unlike `/api/market` with its hand-rolled timezone shift), and `profileHistory` (the profile as it was 1/5/10 minutes ago, computed only on the full load — an incremental window is a few seconds wide and could not contain it). Supports `?date=` and `?since=` like `/api/volumes`, plus `?flow=0` to drop the bubbles (474 KB → 27 KB for a full session); the first load is truncated to the last ~8000 flow points (the cumulative `profile` is unaffected). Returns **503 when there is no gamma yet** — the volumes poller only collects between 13:30 and 22:00, so this is the normal answer in the morning, not a failure.
- `POST /api/poller` — spawns the pollers as detached background processes via `child_process.spawn('python', ...)`, one log each under `.tmp/poller-logs/`. Only works when the API itself is running locally (there's a "start pollers" button in the UI backed by this route, `PollerButton.tsx`; `instrumentation.ts` also calls it at server boot, and `scripts/keep_dashboard_alive.ps1` POSTs to it every minute). **A live PID is not proof a poller is running:** `frontend/src/lib/pollers.ts` verifies the process's actual command line (`Get-CimInstance Win32_Process` on Windows, `ps -o pid=,args=` elsewhere) before trusting `.tmp/pollers.lock`, because Windows recycles PIDs fast — a stale lock pointing at a recycled PID once made the pollers look alive for a whole day while nothing was collected. Restart is per-script, so one dead poller comes back without waiting for the other to die too. Do not "simplify" this back to `process.kill(pid, 0)`.
- `POST /api/finance` / `GET /api/finance` — writes to / reads from the Supabase `transactions` table, falling back to appending `.tmp/transactions.csv` when Supabase is not configured. The old `spawn('python3', ...)` is gone (it never worked on Windows and never worked on Vercel).

**Supabase egress is the binding constraint, not database size.** The free tier allows ~5 GB/month of egress, and the volumes path is what spends it: every extra KB moves ~3.000 times a day. Two rules keep it in budget — writes from the pollers must pass `returning="minimal"` (PostgREST otherwise echoes the whole inserted row back), and the volumes page must fetch incrementally via `?since=`. Reverting either one costs hundreds of MB per trading day. See `sql/001_volumes_snapshots.sql`.

**Known path inconsistency (real, not hypothetical):** pollers write market/volume JSON to `frontend/data/market` and `frontend/data/volumes`, while a root-level `data/market/` and `data/gex/` also exist and some routes resolve paths via `process.cwd()` in ways that assume Next was started from a specific directory. If a change touches file read/write paths, check the actual `path.join`/`path.resolve` calls in the specific route rather than assuming a single canonical data directory — the routes are not all consistent with each other yet.

### Frontend chart pages

- `frontend/src/app/market/page.tsx` — main Chart.js dashboard. Trading window is `00:05`–`23:00` CET; a 30s watcher detects session start/end and resets `localStorage` (`marketData_YYYY-MM-DD`) at `00:05`. Polls `/api/market` every 5s during the window. Custom auto-scroll logic: chart tracks live data at the right edge unless the user has manually panned back, in which case tracking locks until "RESTORE LIVE VIEW" is clicked. Also hosts the "Range Calc" panel (implied-volatility range model off ATM straddle prices entered manually at 10:35/15:35) which computes R1/R2/R3 reference lines and can push them onto the chart.
- `frontend/src/app/spx-volumes/page.tsx` — `echarts` + `echarts-gl` 3D view of call/put volume by strike over time, polling `/api/volumes` every 10s.
- `frontend/src/app/gex/page.tsx` — Chart.js view of the GEX **flow** over time (the `points` bubbles), reading `/api/gex` incrementally via `?since=` plus `/api/market?history=true` for the spot line.
- `frontend/src/app/spx-gamma/page.tsx` — `echarts` view of the GEX **profile by strike**: bars per strike, the spot scrolling alongside on a second (time) x-axis, and white dots showing the same profile 1/5/10 minutes ago. Fetches `/api/gex?flow=0` (it draws the profile, not the bubbles — the flow is ~95% of the payload) every 15s, and takes `?date=YYYY-MM-DD` to replay an archived session. Reference levels (Major Pos/Neg Gamma, Zero Gamma) are derived from the profile, not stored anywhere. Both bases are on one axis via a selector: on 0DTE the volume-weighted numbers run ~20× the OI-weighted ones, so showing them together by default would flatten the OI bars onto zero. **Values are in $M in the API and rendered as $Bn in this page** — check `inMiliardi()` before comparing numbers across the two pages.
- Chart updates should stay imperative (`chart.data... ; chart.update('none')`) to avoid resetting user zoom/pan state — this is the existing convention in `market/page.tsx`, follow it in other Chart.js views.

### Persistence layers in play simultaneously

- Browser `localStorage`: daily market cache, reference lines + visibility, auth token.
- Local filesystem: JSON snapshot files (see path caveat above); `.tmp/transactions.csv` for finance entries.
- Supabase (Postgres): optional, partial — only used by `/api/market` as a read source and by `tws_poller.py` as a write target, and only for a subset of fields. Env vars for it live in `frontend/.env.local` and `execution/.env` (see those files for the current key names — do not print their values).

On Vercel, only `/tmp` is writable and is wiped on cold start, so file-backed history does not persist there — Supabase (where wired up) is the only durable cloud store today.

## Project docs worth reading before larger changes

- `context/PROJECT_OVERVIEW.md`, `context/ARCHITECTURE_NOTES.md`, `context/MISMATCHES_AND_RISKS.md`, `context/NEXT_STEPS.md` — an existing audit of this repo's structure and known issues (data path inconsistencies, incomplete Supabase schema, `python3` vs `python` on Windows, hardcoded auth). Written more recently than `Gemini.md` and considered more accurate.
- `Gemini.md` — earlier project reference (in Italian); useful for historical context on the Range Calc math and chart color conventions, but treat path/architecture claims in it as superseded by `context/`.
- `directives/add_transaction.md` — SOP for the finance transaction flow.

## Windows-specific notes

Dev happens on Windows. `execution/api/finance/route.ts` spawns `python3`, which is typically not on PATH on Windows (only `python` is) — this is a known, not-yet-fixed issue (see `context/MISMATCHES_AND_RISKS.md`). `Procfile` also references a `market_poller.py` that does not currently exist in `execution/` — it's stale relative to the actual poller filenames (`tws_poller.py`, `tws_volumes_poller.py`).
