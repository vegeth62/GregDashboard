import json
import os
import sys
import time
from datetime import datetime
import asyncio

try:
    from ib_insync import *
except ImportError:
    print("Error: ib_insync is not installed. Please run 'pip install ib_insync'.")
    sys.exit(1)

# Configuration
POLL_INTERVAL = 10  # seconds
START_HOUR = 8  # 14:30 Italian = 8:30 Eastern inside IBKR usually, but let's use local machine time
# Assuming local machine is CET
START_TIME_MINUTES = 13 * 60 + 30  # Adjusted for immediate testing
END_TIME_MINUTES = 22 * 60  # 22:00


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, '..', 'frontend', 'data', 'volumes')

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

def append_to_session_file(date_key, snapshot):
    ensure_data_dir()
    existing = read_session_file(date_key)
    existing.append(snapshot)
    
    # Keep only the last 100 snapshots to ensure performance
    if len(existing) > 100:
        existing = existing[-100:]
        
    file_path = get_file_path(date_key)
    try:
        # Write to temporary file, then rename for atomicity
        temp_file = file_path + ".tmp"
        with open(temp_file, 'w', encoding='utf-8') as f:
            json.dump(existing, f, separators=(',', ':'))
        os.replace(temp_file, file_path)
    except Exception as e:
        print(f"Error writing to file {file_path}: {e}")

def main():
    print("Starting Volumes Poller background service (IBKR TWS API)...")
    ensure_data_dir()
    
    ib = IB()
    connected = False
    import random
    
    for attempt in range(5):
        client_id = random.randint(1000, 9999)
        try:
            print(f"Attempting to connect to IBKR TWS (attempt {attempt+1}) as clientId {client_id}...")
            ib.connect('127.0.0.1', 7496, clientId=client_id, timeout=10)
            print("Connected to IBKR on port 7496.")
            connected = True
            break
        except Exception as e:
            print(f"Connection attempt {attempt+1} failed: {e}")
            ib.sleep(2)
            
    if not connected:
        print("CRITICAL: Failed to connect to IBKR after multiple attempts.")
        return


    # User confirmed they have real-time subscriptions
    ib.reqMarketDataType(1)

    # 1. Qualify SPX and get ATM
    spx_contract = Index('SPX', 'CBOE')
    ib.qualifyContracts(spx_contract)
    print("Qualifying SPX...")
    spx_ticker = ib.reqMktData(spx_contract, '', False, False)
    
    # Wait for SPX price
    spx = None
    for _ in range(10):
        ib.sleep(1)
        spx = spx_ticker.marketPrice()
        if spx and spx == spx:  # Check for NaN
            break
        elif spx_ticker.last and spx_ticker.last == spx_ticker.last:
            spx = spx_ticker.last
            break
        elif spx_ticker.close and spx_ticker.close == spx_ticker.close:
            spx = spx_ticker.close
            break

    if not spx or spx != spx:
        print("CRITICAL: Cannot determine SPX price to find ATM after 10 seconds.")
        return
        
    print(f"Current SPX Price: {spx}")

    # 2. Get Option Chain expiration
    chains = ib.reqSecDefOptParams(spx_contract.symbol, '', spx_contract.secType, spx_contract.conId)
    
    today_str = datetime.now().strftime('%Y%m%d')
    target_exp = today_str
    
    valid_chain = None
    # SPX dailies and weeklies are typically under tradingClass 'SPXW'
    for c in chains:
        if c.exchange == 'CBOE' and today_str in c.expirations:
            # Prefer SPXW if available since that's where dailies are, but any CBOE will do
            if c.tradingClass == 'SPXW' or not valid_chain:
                valid_chain = c

    if not valid_chain:
        print(f"CRITICAL: Could not find 0DTE options for today ({today_str}). Checking next available...")
        # Fallback if 0DTE doesn't exist (e.g. weekend testing or holiday)
        all_exp = set()
        for c in chains:
            if c.exchange == 'CBOE':
                all_exp.update(c.expirations)
        if not all_exp:
            return
        next_exp = sorted(list(all_exp))[0]
        for c in chains:
            if c.exchange == 'CBOE' and next_exp in c.expirations:
                valid_chain = c
                target_exp = next_exp
                break
                
        print(f"Fallback to Expiration: {target_exp}")
    else:
        print(f"Selected 0DTE Expiration: {target_exp} (Trading Class: {valid_chain.tradingClass})")
        
    chain = valid_chain

    # 3. Determine Strikes (18 above, 18 below ATM per ridurre del 10%)
    sorted_strikes = sorted(chain.strikes)
    
    # Find the index of the ATM strike (closest to spx)
    if not sorted_strikes:
        print("CRITICAL: No strikes found in the option chain.")
        return
        
    atm_strike_idx = min(range(len(sorted_strikes)), key=lambda i: abs(sorted_strikes[i] - spx))
    
    # Select 18 strikes below and 18 strikes above (37 strikes total -> 74 tickers)
    start_idx = max(0, atm_strike_idx - 18)
    end_idx = min(len(sorted_strikes), atm_strike_idx + 19)
    
    strikes = sorted_strikes[start_idx:end_idx]
    
    print(f"Selected {len(strikes)} strikes around {spx} (18 above, 18 below ATM)")
        
    # 4. Subscribe to Option Tickers
    option_tickers = []
    contracts = []
    for strike in strikes:
        c_call = Option('SPX', target_exp, strike, 'C', 'CBOE', multiplier='100', tradingClass=chain.tradingClass)
        c_put = Option('SPX', target_exp, strike, 'P', 'CBOE', multiplier='100', tradingClass=chain.tradingClass)
        contracts.extend([c_call, c_put])

    qualified = ib.qualifyContracts(*contracts)
    print(f"Qualified {len(qualified)} option contracts. Requesting Market Data...")

    for c in qualified:
        # Request data without volume limits if possible, we just need generic ticks (100) or short volume
        # Option Volume is usually included by default in reqMktData
        ticker = ib.reqMktData(c, '100', False, False)
        option_tickers.append({"strike": c.strike, "right": c.right, "ticker": ticker})

    print("Subscribed. Starting poller loop...")

    # Wait for initial data
    ib.sleep(5)

    last_poll = 0
    today_key = get_today_key()
    open_spx_captured = False

    while True:
        now = datetime.now()
        timestamp = now.timestamp()
        
        # Current time in minutes since midnight
        minutes_since_midnight = now.hour * 60 + now.minute
        
        is_active = START_TIME_MINUTES <= minutes_since_midnight <= END_TIME_MINUTES

        if is_active:
            if timestamp - last_poll >= POLL_INTERVAL:
                time_str = now.strftime('%H:%M:%S')
                
                # Capture current SPX price
                current_spx = spx_ticker.marketPrice()
                if not current_spx or current_spx != current_spx:
                    current_spx = spx_ticker.last if spx_ticker.last else spx_ticker.close
                
                # Sanitize NaN for JSON
                if current_spx != current_spx:
                    current_spx = None

                # Check for 15:30 open (9:30 EST)
                is_opening_snapshot = False
                if not open_spx_captured and now.hour == 15 and now.minute >= 30:
                    is_opening_snapshot = True
                    open_spx_captured = True
                    print(f"Captured SPX Opening Price at {time_str}: {current_spx}")
                
                # Aggregate volumes by strike
                volume_by_strike = {} # strike -> {calls, puts}
                
                # Initialize
                for s in strikes:
                    volume_by_strike[s] = {"calls": 0, "puts": 0}
                
                valid_data_points = 0
                for item in option_tickers:
                    ticker = item["ticker"]
                    strike = item["strike"]
                    right = item["right"] # 'C' or 'P'
                    
                    vol = ticker.volume if ticker.volume and ticker.volume == ticker.volume else 0
                    if right == 'C':
                        volume_by_strike[strike]["calls"] += vol
                    else:
                        volume_by_strike[strike]["puts"] += vol
                    
                    if vol > 0:
                        valid_data_points += 1

                print(f"[{time_str}] Aggregated volumes (C/P separate) for {valid_data_points} active contracts.")
                
                # We save a snapshot: time -> array of volumes [strike, calls, puts]
                snapshot = {
                    "time": time_str,
                    "spxPrice": current_spx,
                    "isOpening": is_opening_snapshot,
                    "volumes": [{"strike": k, "calls": v["calls"], "puts": v["puts"]} for k, v in volume_by_strike.items()]
                }
                
                append_to_session_file(today_key, snapshot)


                last_poll = timestamp
        else:
            if now.second % 30 == 0:
                print(f"[{now.strftime('%H:%M:%S')}] Outside active hours ({START_TIME_MINUTES//60}:{START_TIME_MINUTES%60} to {END_TIME_MINUTES//60}:{END_TIME_MINUTES%60}). Waiting...")
        
        ib.sleep(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nExiting...")
