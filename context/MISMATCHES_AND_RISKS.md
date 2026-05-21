# Mismatches And Risks

## Confirmed Mismatches

### 1. Local data paths are inconsistent

Observed behavior:
- `execution/tws_poller.py` writes to `frontend/data/market`
- `execution/tws_volumes_poller.py` writes to `frontend/data/volumes`
- `execution/backfill_ibkr.py` writes to `frontend/data/market`
- API routes read from `process.cwd()/data/...`

Why this matters:
- this only works if Next is started with `process.cwd()` equal to `frontend`
- if the app is started from a different working directory, APIs may miss the poller output

### 2. Existing documentation does not fully match the code

Examples:
- `Gemini.md` mentions older paths and older architecture wording
- current repo contains `spx-volumes`, which is not reflected consistently
- some files referenced in docs are no longer central

### 3. Encoding issues are present in user-facing strings and docs

Examples observed:
- broken characters in `Gemini.md`
- broken glyphs in some frontend labels copied through file history

Why this matters:
- makes maintenance harder
- may surface ugly text in UI depending on editor/runtime chain

### 4. Finance API depends on local Python runtime

Observed behavior:
- `frontend/src/app/api/finance/route.ts` uses `spawn('python3', ...)`

Risk:
- not portable on Windows without aliasing
- likely unsuitable for Vercel/serverless

### 5. Hardcoded credentials in frontend

Observed behavior:
- username/password are embedded in client code

Risk:
- acceptable only for private personal use with limited exposure
- not suitable for multi-user or public deployment

### 6. Supabase schema support is incomplete

Observed behavior:
- poller calculates `volTide`, `coneUp`, `coneDown`
- `push_to_supabase()` only inserts `vix`, `esf`, `time`, `date`

Risk:
- cloud data may not match file data shape
- frontend enhancements relying on derived fields may silently depend on local JSON only

## Working Assumptions

- this is a personal tool, not a public SaaS
- IBKR TWS is expected to run locally on `127.0.0.1:7496`
- local-first operation matters more than production-hardening right now

## Suggested Priority Order

1. Normalize data paths between pollers, backfill, and API routes
2. Decide the canonical persistence model: local JSON, Supabase, or hybrid
3. Fix encoding artifacts in docs and UI
4. Make the local startup story explicit and repeatable
5. Only then refine features or visuals
