# Local Runbook

## Frontend

From `frontend/`:

```powershell
npm install
npm run dev
```

Expected app:
- `http://localhost:3000`

## Python Dependencies

From project root:

```powershell
pip install -r requirements.txt
pip install ib_insync
```

Notes:
- `requirements.txt` currently does not include `ib_insync`
- Supabase and dotenv support are expected by the scripts

## Market Poller

From project root:

```powershell
python execution/tws_poller.py
```

Expected prerequisites:
- IBKR TWS running locally
- API socket enabled
- market data subscriptions available

## Volumes Poller

From project root:

```powershell
python execution/tws_volumes_poller.py
```

## Backfill

From project root:

```powershell
python execution/backfill_ibkr.py
```

## Supabase Helpers

```powershell
python execution/init_db.py
python execution/check_sync.py
```

## Notes

- If Next is started from inside `frontend/`, API file reads likely resolve against `frontend/data/...`
- If Next is started from project root in a different way, file path assumptions should be rechecked
- `POST /api/finance` currently expects `python3`, which may require adjustment on Windows
