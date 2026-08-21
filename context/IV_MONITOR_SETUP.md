# ES 0DTE IV Monitor Setup Guide

## Overview

The new **ES 0DTE IV Monitor** tracks real-time changes in implied volatility for SPX options near the at-the-money strike, comparing PUT vs CALL IV changes with a focus on simplicity and clarity.

## Components Created

### 1. Python Poller: `execution/tws_iv_poller.py`

Connects to IBKR TWS and collects implied volatility (IV) data for SPX 0DTE options.

**Key Features:**
- Polls IV data every 5 seconds during trading hours (13:30–22:00 CET)
- Automatically selects strikes near ATM (configurable range)
- Calculates weighted IV for PUT and CALL (weighted by distance from ATM)
- Computes IV change % relative to lookback period (default 1 minute)
- Saves snapshots to local JSON files: `frontend/data/iv-monitor/YYYY-MM-DD.json`
- Optionally pushes to Supabase table `iv_snapshots` (if configured)

**Configuration:**

Strike range (in tws_iv_poller.py, line ~265):
```python
strike_range = 2  # Options: 0 (ATM only), 1, 2, 3
```

Lookback period for IV change (in calculate_iv_change, line ~160):
```python
lookback_seconds=60  # Default 1 minute, adjustable
```

**Data Structure (JSON snapshot):**
```json
{
  "time": "15:42:33",
  "timestamp": 1692900153.456,
  "esPrice": 4802.25,
  "atmStrike": 4800,
  "weightedPutIV": 18.45,
  "weightedCallIV": 17.82,
  "putIVChangePct": 2.15,
  "callIVChangePct": -0.85,
  "ivDifferentialPct": 3.0,
  "putsData": [
    {"strike": 4790, "bid": 0.42, "ask": 0.48, "mid": 0.45, "iv": 18.2},
    ...
  ],
  "callsData": [
    {"strike": 4810, "bid": 0.38, "ask": 0.44, "mid": 0.41, "iv": 17.9},
    ...
  ]
}
```

### 2. API Endpoint: `frontend/src/app/api/iv-monitor/route.ts`

Exposes IV data via REST API.

**GET `/api/iv-monitor`**

Query Parameters:
- `date` (optional): `YYYY-MM-DD` — defaults to today
- `since` (optional): `HH:MM:SS` — returns only snapshots after this time
- `limit` (optional): integer — max number of snapshots to return

**Examples:**
```bash
# Today's full session
GET /api/iv-monitor

# Specific date
GET /api/iv-monitor?date=2026-08-19

# Only new data since 15:30:00
GET /api/iv-monitor?since=15:30:00

# Last 50 snapshots
GET /api/iv-monitor?limit=50
```

**Response:**
```json
{
  "date": "2026-08-19",
  "snapshots": [
    { /* snapshot object */ },
    ...
  ],
  "count": 42
}
```

**Data Sources (in priority order):**
1. Supabase `iv_snapshots` table (if configured)
2. Local JSON file: `frontend/data/iv-monitor/YYYY-MM-DD.json`

### 3. Frontend Page: `frontend/src/app/iv-monitor/page.tsx`

Professional volatility monitoring dashboard.

**Access URL:** `http://localhost:3000/iv-monitor`

**Features:**

- **Real-time updates:** Polls `/api/iv-monitor` every 5 seconds
- **Main chart:** PUT IV Change % vs CALL IV Change % over time
- **Differential chart:** PUT Change − CALL Change (volatility skew indicator)
- **Live status:** Shows connection state and last update time
- **Summary panel:** Current IV levels, changes, and metrics
- **Strike details:** Lists PUT/CALL options used, highlights ATM strike
- **Controls:**
  - Lookback period selector: 5s, 30s, 1min, 5min (default 1min)
  - Live/Pause toggle
  - Strike range selector (when implemented in frontend)

## Weighted IV Calculation

The weighted IV for PUT/CALL near ATM is calculated using:

```
weight[strike] = 1 / (1 + distance_from_atm / 5)
weighted_iv = Σ(iv[i] × weight[i]) / Σ(weight[i])
```

This gives higher weight to strikes closer to ATM, with a 5-point distance scale.

## Interpretation Guide

### Main Chart (PUT vs CALL IV Change %)

- **Both above 0:** Broad volatility expansion in 0DTE
- **Both below 0:** Volatility contraction across the board
- **PUT > CALL:** Put volatility rising faster (dealers buying puts, market hedging tail risk)
- **CALL > PUT:** Call volatility rising faster (call skew, bullish positioning)

### Differential Chart (PUT − CALL)

- **Positive:** PUT IV expanding relative to CALL IV
- **Negative:** CALL IV expanding relative to PUT IV
- **Zero crossover:** Reversal of volatility skew

## Setup Checklist

- [ ] Run `tws_iv_poller.py` (requires IBKR TWS running locally on port 7496)
- [ ] Access `/iv-monitor` page (or add navigation link to main dashboard)
- [ ] **(Optional) Supabase integration:**
  - Create table: `sql/iv_snapshots_init.sql` (see schema below)
  - Verify env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Supabase Schema (if using cloud storage)

```sql
CREATE TABLE iv_snapshots (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  time TIME NOT NULL,
  es_price NUMERIC(10, 2),
  atm_strike NUMERIC(10, 1),
  weighted_put_iv NUMERIC(5, 2),
  weighted_call_iv NUMERIC(5, 2),
  put_iv_change_pct NUMERIC(6, 2),
  call_iv_change_pct NUMERIC(6, 2),
  iv_differential_pct NUMERIC(6, 2),
  puts_data JSONB,
  calls_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(date, time)
);

CREATE INDEX idx_iv_snapshots_date ON iv_snapshots(date);
CREATE INDEX idx_iv_snapshots_date_time ON iv_snapshots(date, time);
```

## Known Limitations

1. **No archived sessions yet:** Currently displays today's data only. To support historical dates, implement date selector in frontend and update API to serve archived snapshots.

2. **Strike range not yet configurable in UI:** Currently hardcoded to ATM ± 2. To make this dynamic:
   - Add state in frontend
   - Pass `strikeRange` param to API
   - Have poller re-qualify contracts based on setting

3. **IV calculation requires fresh IBKR subscription:** If TWS disconnects or market data subscription lapses, poller stops collecting. Implement reconnection logic.

4. **Windows-specific issues:**
   - Verify `python` command works (not `python3`)
   - Check IBKR TWS port 7496 is accessible

## Debugging

**Poller not collecting data?**
- Ensure IBKR TWS is running and accessible on `127.0.0.1:7496`
- Check `.tmp/poller-logs/tws_iv_poller.log` for connection errors
- Verify that market hours are active (13:30–22:00 CET)

**API returns empty snapshots?**
- Verify local file exists: `frontend/data/iv-monitor/2026-08-19.json`
- Check Supabase connectivity if using cloud
- Ensure poller has run and saved data

**Frontend shows "No data"?**
- Confirm `/api/iv-monitor` responds with snapshots
- Check browser console for fetch errors
- Verify page is live and polling is enabled (click RESUME if paused)

## Future Enhancements

- [ ] Historical date selector in UI
- [ ] Configurable strike range via settings panel
- [ ] Alert/notification for IV divergence
- [ ] Export session data (CSV/JSON)
- [ ] Multi-timeframe comparison (e.g., 1m vs 5m skew)
- [ ] VIX correlation overlay
- [ ] Machine learning model: predict IV move direction
