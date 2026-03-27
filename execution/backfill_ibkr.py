#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime, timedelta
from ib_insync import *

# Configuration
SYMBOL_ES = "ES"
SYMBOL_VIX = "VIX"

# Determine paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'frontend', 'data', 'market')

def ensure_data_dir():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR, exist_ok=True)

def get_today_key():
    return datetime.now().strftime('%Y-%m-%d')

def get_file_path(date_key):
    return os.path.join(DATA_DIR, f"{date_key}.json")

def main():
    print("Starting IBKR Historical Backfill...")
    
    ib = IB()
    try:
        import random
        client_id = random.randint(10000, 19999)
        print(f"Connecting to TWS on 127.0.0.1:7496 (clientId {client_id})...")
        ib.connect('127.0.0.1', 7496, clientId=client_id)
    except Exception as e:
        print(f"Error: Could not connect to IBKR: {e}")
        sys.exit(1)

    # Contracts
    vix_contract = Index('VIX', 'CBOE')
    esf_contract = ContFuture('ES', 'CME')
    
    ib.qualifyContracts(vix_contract)
    ib.qualifyContracts(esf_contract)

    print("Requesting historical data for VIX...")
    # Request data for the last 24 hours to cover the whole day
    vix_bars = ib.reqHistoricalData(
        vix_contract,
        endDateTime='',
        durationStr='1 D',
        barSizeSetting='1 min',
        whatToShow='TRADES',
        useRTH=False,
        keepUpToDate=False
    )

    print("Requesting historical data for ES=F...")
    esf_bars = ib.reqHistoricalData(
        esf_contract,
        endDateTime='',
        durationStr='1 D',
        barSizeSetting='1 min',
        whatToShow='TRADES',
        useRTH=False,
        keepUpToDate=False
    )

    if not vix_bars or not esf_bars:
        print("Error: Could not retrieve historical data for one or both symbols.")
        ib.disconnect()
        return

    # Create maps for easy synchronization by minute
    vix_map = {b.date.strftime('%H:%M:%S'): b.close for b in vix_bars}
    esf_map = {b.date.strftime('%H:%M:%S'): b.close for b in esf_bars}

    # Common timestamps (union of both)
    all_times = sorted(list(set(vix_map.keys()) | set(esf_map.keys())))
    
    # Filter for today only (based on the date of the bars if possible, 
    # but here we just take what IB gave us for '1 D')
    # Actually, let's just use all points ib returned as it's the last 24h
    
    data_points = []
    for t in all_times:
        v = vix_map.get(t)
        e = esf_map.get(t)
        if v is not None and e is not None:
            data_points.append({
                "time": t,
                "vix": round(float(v), 2),
                "esf": round(float(e), 2)
            })

    if not data_points:
        print("No synchronized data points found.")
        ib.disconnect()
        return

    # Save to JSON
    today = get_today_key()
    ensure_data_dir()
    file_path = get_file_path(today)
    
    print(f"Saving {len(data_points)} points to {file_path}...")
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(data_points, f, indent=2)

    print("Backfill complete.")
    ib.disconnect()

if __name__ == "__main__":
    main()
