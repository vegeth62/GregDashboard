#!/usr/bin/env python3
import json
import time
import os
import sys
from datetime import datetime
from dotenv import load_dotenv

try:
    from ib_insync import *
except ImportError:
    print("Error: ib_insync is not installed. Please run 'pip install ib_insync'.")
    sys.exit(1)

from supabase import create_client, Client

# Load environment variables
load_dotenv()

# Configuration
POLL_INTERVAL = 5  # seconds
START_HOUR = 0
END_HOUR = 23

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

# Determine paths relative to this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'frontend', 'data', 'market')

def ensure_data_dir():
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR, exist_ok=True)

def get_today_key():
    return datetime.now().strftime('%Y-%m-%d')

def get_file_path(date_key):
    return os.path.join(DATA_DIR, f"{date_key}.json")

def read_session_file(date_key):
    file_path = get_file_path(date_key)
    if not os.path.exists(file_path):
        return []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error reading file {file_path}: {e}")
        return []

def append_to_session_file(date_key, point):
    ensure_data_dir()
    existing = read_session_file(date_key)
    existing.append(point)
    file_path = get_file_path(date_key)
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(existing, f, indent=2)
    except Exception as e:
        print(f"Error writing to file {file_path}: {e}")

def push_to_supabase(point):
    if not SUPABASE_URL or not SUPABASE_KEY or SUPABASE_URL == "YOUR_SUPABASE_URL":
        return
    
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        data = {
            "vix": point["vix"],
            "esf": point["esf"],
            "time": point["time"],
            "date": get_today_key()
        }
        supabase.table("market_data").insert(data).execute()
    except Exception as e:
        print(f"Error pushing to Supabase: {e}", file=sys.stderr)

def main():
    print("Starting Market Poller background service (IBKR TWS API)...")
    print(f"Data directory: {DATA_DIR}")
    print(f"Trading window: {START_HOUR}:00 - {END_HOUR}:00")
    
    if not SUPABASE_URL or SUPABASE_URL == "YOUR_SUPABASE_URL":
        print("WARNING: Supabase credentials not found. Falling back to local files only.")
    
    ib = IB()
    connected = False
    
    import random
    client_id = random.randint(1, 9999)
    
    try:
        print(f"Attempting to connect to IBKR TWS on 127.0.0.1:7496 as clientId {client_id}...")
        ib.connect('127.0.0.1', 7496, clientId=client_id)
        print("Connected to IBKR on port 7496.")
        connected = True
    except Exception as e:
        pass
            
    if not connected:
        print("\nERROR: Failed to connect to IBKR on port 7496.")
        print("Please make sure TWS is open, and go to:")
        print("File -> Global Configuration -> API -> Settings")
        print("And check 'Enable ActiveX and Socket Clients'.")
        return

    # User confirmed they have real-time subscriptions, defaulting to 1 (Live)
    ib.reqMarketDataType(1)

    # Request market data
    # VIX Index
    vix_contract = Index('VIX', 'CBOE')
    ib.qualifyContracts(vix_contract)
    vix_ticker = ib.reqMktData(vix_contract, '', False, False)

    # ES continuous futures
    esf_contract = ContFuture('ES', 'CME')
    ib.qualifyContracts(esf_contract)
    esf_ticker = ib.reqMktData(esf_contract, '', False, False)

    ib.sleep(2) # Wait for initial data

    while True:
        now = datetime.now()
        hour = now.hour
        minute = now.minute
        
        is_active = (hour == 0 and minute >= 5) or (START_HOUR + 1 <= hour < END_HOUR)
        
        # Ensure we process incoming IBKR messages to keep subscriptions alive
        ib.sleep(POLL_INTERVAL)

        if is_active:
            # We get marketPrice() which uses last price, or bid/ask average if last price is not available
            vix = vix_ticker.marketPrice()
            esf = esf_ticker.marketPrice()
            
            # Check if vix/esf are valid numbers, not NaN or 0
            # IB uses nan for missing data initially
            if vix == vix and esf == esf and vix > 0 and esf > 0:
                # Format to 2 decimal places
                vix_rounded = round(float(vix), 2)
                esf_rounded = round(float(esf), 2)

                time_str = now.strftime('%H:%M:%S')
                point = {"time": time_str, "vix": vix_rounded, "esf": esf_rounded}
                
                # Save locally
                append_to_session_file(get_today_key(), point)
                
                # Push to Cloud
                push_to_supabase(point)
                
                print(f"[{time_str}] Saved (Local + Cloud): VIX={vix_rounded}, ES=F={esf_rounded}")
            else:
                print(f"[{now.strftime('%H:%M:%S')}] Waiting for valid market quotes (VIX: {vix}, ES: {esf})")
        else:
            if now.second < POLL_INTERVAL:
                print(f"[{now.strftime('%H:%M:%S')}] Outside trading hours. Waiting...")
            continue

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nExiting...")
