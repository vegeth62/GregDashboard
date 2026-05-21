# Architecture Notes

## Frontend Routes

- `/` -> redirect to `/login`
- `/login` -> hardcoded local login
- `/market` -> main charting dashboard
- `/spx-volumes` -> 3D SPX option volumes
- `/input` -> finance transaction form

## API Endpoints

### `GET /api/market`
Located in `frontend/src/app/api/market/route.ts`

Modes:
- `?history=true`: returns today's intraday history
- `?date=YYYY-MM-DD`: returns archived session for a specific date
- no params: returns latest point for today

Read path logic:
- Supabase first when configured
- local JSON fallback via `path.join(process.cwd(), 'data', 'market', ...)`

### `GET /api/volumes`
Located in `frontend/src/app/api/volumes/route.ts`

Modes:
- `?date=YYYY-MM-DD`: archived volume snapshots
- no params: today's data

Read path logic:
- local JSON only via `path.join(process.cwd(), 'data', 'volumes', ...)`

### `POST /api/finance`
Located in `frontend/src/app/api/finance/route.ts`

Behavior:
- validates required fields
- spawns `execution/save_transaction.py`
- expects `python3` in PATH

## Python Scripts

### `execution/tws_poller.py`
Collects:
- `VIX`
- `ES` continuous future
- `SPX`
- derived values: `volTide`, `coneUp`, `coneDown`

Writes:
- local JSON session file
- optional Supabase row insert

Important details:
- trading window is coded as `00:05` to `23:00`
- file output path is `frontend/data/market`
- Supabase insert currently sends only `vix`, `esf`, `time`, `date`

### `execution/tws_volumes_poller.py`
Collects:
- current SPX
- option volumes by strike for calls and puts
- opening SPX snapshot

Writes:
- local JSON snapshots to `frontend/data/volumes`

Important details:
- polling interval is 10 seconds
- active window is minute-based
- strike selection is trimmed to avoid IBKR ticker limits

### `execution/backfill_ibkr.py`
- pulls 1-minute historical bars for VIX and ES from IBKR
- writes synchronized points to a JSON file
- output path is `frontend/data/market`

### `execution/init_db.py`
- verifies Supabase connectivity
- prints SQL bootstrap instructions if table setup is missing

### `execution/check_sync.py`
- reads latest rows from Supabase for today's date

### `execution/save_transaction.py`
- validates CLI args
- appends one CSV row to `.tmp/transactions.csv`

## State And Persistence

### Browser
- `market_auth`
- `market_user`
- reference lines and visibility
- divergence visibility
- daily market cache

### File System
- market data currently exists in two places in the repo:
  - root `data/market`
  - `frontend/data/market`
- volume data currently lives in `frontend/data/volumes`
- finance data lives in `.tmp/transactions.csv`

### Cloud
- Supabase is optional and partially integrated

## What Seems Most Important For Future Work

- standardize where market and volume files are read/written
- decide whether Supabase is the source of truth or only a fallback
- clean up encoding/UI text artifacts
- reduce duplication between docs and actual behavior
