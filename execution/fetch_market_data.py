#!/usr/bin/env python3
"""
Fetches VIX and ES=F data from Yahoo Finance.
Can return either the latest price or the full history for the current day.

Usage:
    python3 fetch_market_data.py [--history]
"""

import json
import sys
import argparse
import yfinance as yf
from datetime import datetime, time
import pandas as pd

def fetch_data(history_mode=False):
    """Fetch VIX and ES=F values."""
    try:
        vix_ticker = yf.Ticker("^VIX")
        esf_ticker = yf.Ticker("ES=F")

        if history_mode:
            # Fetch minute data for today
            # yfinance '1d' period '1m' interval works for minute data
            vix_hist = vix_ticker.history(period="1d", interval="1m")
            esf_hist = esf_ticker.history(period="1d", interval="1m")

            if vix_hist.empty or esf_hist.empty:
                return {"error": "No historical data found for today"}

            # Align the data - we want points where both exist
            common_index = vix_hist.index.intersection(esf_hist.index)
            vix_hist = vix_hist.loc[common_index]
            esf_hist = esf_hist.loc[common_index]

            history = []
            for ts, row in vix_hist.iterrows():
                # We filter for 15:30 CET onwards if needed, but for now we'll 
                # just return all points from today as yfinance already filters by 'period=1d'
                history.append({
                    "time": ts.strftime('%H:%M:%S'),
                    "vix": round(float(row["Close"]), 2),
                    "esf": round(float(esf_hist.loc[ts, "Close"]), 2)
                })
            
            return {"history": history}

        else:
            # Current price mode (optimized)
            vix_price = vix_ticker.fast_info.get("lastPrice", None)
            esf_price = esf_ticker.fast_info.get("lastPrice", None)

            if vix_price is None:
                hist = vix_ticker.history(period="1d", interval="1m")
                if not hist.empty:
                    vix_price = float(hist["Close"].iloc[-1])

            if esf_price is None:
                hist = esf_ticker.history(period="1d", interval="1m")
                if not hist.empty:
                    esf_price = float(hist["Close"].iloc[-1])

            return {
                "timestamp": datetime.now().isoformat(),
                "vix": round(float(vix_price), 2) if vix_price is not None else None,
                "esf": round(float(esf_price), 2) if esf_price is not None else None,
            }

    except Exception as e:
        return {"error": str(e)}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--history", action="store_true", help="Fetch history for today")
    args = parser.parse_args()

    result = fetch_data(args.history)
    
    if "error" in result:
        print(json.dumps(result), file=sys.stderr)
        sys.exit(1)
    
    print(json.dumps(result))

if __name__ == "__main__":
    main()
