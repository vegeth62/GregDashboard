# Project Overview

## Purpose
This repository is a personal market dashboard with two main areas:

- `Market Monitor`: tracks `VIX` and `ES` data collected from IBKR TWS and renders an intraday chart in Next.js.
- `SPX Volumes`: renders 3D option-volume snapshots for SPX from a separate IBKR poller.
- `Finance Input`: simple form that appends manual transactions to a local CSV via Python.

## Current Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind v4
- Charting: `chart.js`, `react-chartjs-2`, `chartjs-plugin-annotation`, `echarts`, `echarts-for-react`, `echarts-gl`
- Backend/runtime glue: Next API routes
- Data collection: Python scripts using `ib_insync`
- Optional persistence: Supabase

## Real Repo Structure

- `frontend/`: Next.js application
- `execution/`: Python scripts for polling, backfill, DB checks, and CSV saving
- `data/market/`: root-level market JSON data exists in repo
- `frontend/data/market/`: pollers currently write market data here
- `frontend/data/volumes/`: poller currently writes volume snapshots here
- `directives/`: small task-specific operating notes
- `context/`: working notes created during analysis

## Main User Flows

### 1. Login
- Entry page redirects to `/login`
- Auth is client-side only
- Credentials are hardcoded in `frontend/src/app/login/page.tsx`
- Success stores `market_auth=true` in `localStorage`

### 2. Market Monitor
- UI: `frontend/src/app/market/page.tsx`
- API: `frontend/src/app/api/market/route.ts`
- Poller: `execution/tws_poller.py`
- Sources:
  - Latest or history from Supabase if configured
  - Fallback to local JSON files
- Frontend supports:
  - live polling from API
  - custom zoom/pan logic
  - reference lines
  - divergence overlays
  - cone values from backend data if present

### 3. SPX Volumes
- UI: `frontend/src/app/spx-volumes/page.tsx`
- API: `frontend/src/app/api/volumes/route.ts`
- Poller: `execution/tws_volumes_poller.py`
- Frontend polls API every 10 seconds and renders two ECharts 3D views

### 4. Finance Input
- UI: `frontend/src/app/input/page.tsx`
- API: `frontend/src/app/api/finance/route.ts`
- Writer script: `execution/save_transaction.py`
- Output: `.tmp/transactions.csv`

## Current Reality vs Existing Docs

The existing `Gemini.md` is useful as historical context, but it is not fully aligned with the codebase:

- it mentions older architecture details
- it contains encoding issues
- some paths differ from the code actually used today

Use the files in `context/` plus the source code as the current baseline.
