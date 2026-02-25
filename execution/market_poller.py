#!/usr/bin/env python3
import json
import time
import os
import sys
from datetime import datetime
import yfinance as yf
from supabase import create_client, Client
from dotenv import load_dotenv

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
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'data', 'market')

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
    # Keep local backup
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

def fetch_latest_data():
    try:
        vix_ticker = yf.Ticker("^VIX")
        esf_ticker = yf.Ticker("ES=F")

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

        if vix_price is not None and esf_price is not None:
            return round(float(vix_price), 2), round(float(esf_price), 2)
        return None, None
    except Exception as e:
        print(f"Error fetching data: {e}", file=sys.stderr)
        return None, None

def main():
    print(f"Starting Market Poller background service (Cloud Native)...")
    print(f"Data directory (Backup): {DATA_DIR}")
    print(f"Trading window: {START_HOUR}:00 - {END_HOUR}:00")
    
    if not SUPABASE_URL or SUPABASE_URL == "YOUR_SUPABASE_URL":
        print("WARNING: Supabase credentials not found in .env. Falling back to local files only.")
    
    while True:
        now = datetime.now()
        hour = now.hour
        
        if START_HOUR <= hour < END_HOUR:
            vix, esf = fetch_latest_data()
            if vix is not None and esf is not None:
                time_str = now.strftime('%H:%M:%S')
                point = {"time": time_str, "vix": vix, "esf": esf}
                
                # Save locally (backup)
                append_to_session_file(get_today_key(), point)
                
                # Push to Cloud
                push_to_supabase(point)
                
                print(f"[{time_str}] Saved (Local + Cloud): VIX={vix}, ES=F={esf}")
        else:
            if now.second == 0:
                print(f"[{now.strftime('%H:%M:%S')}] Outside trading hours. Waiting...")
            time.sleep(1)
            continue

        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
