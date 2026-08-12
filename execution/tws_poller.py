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
    
    # Keep only the last 100 snapshots to ensure performance
    if len(existing) > 100:
        existing = existing[-100:]
        
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
        if "spx" in point and point["spx"] is not None:
            data["spx"] = point["spx"]
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
    
    for attempt in range(5):
        client_id = random.randint(1000, 9999)
        try:
            print(f"Attempting to connect to IBKR TWS on 127.0.0.1:7496 as clientId {client_id} (attempt {attempt+1})...")
            ib.connect('127.0.0.1', 7496, clientId=client_id, timeout=10)
            print("Connected to IBKR on port 7496.")
            connected = True
            break
        except Exception as e:
            print(f"Connection attempt {attempt+1} failed: {e}")
            ib.sleep(2)
            
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

    # SPX Index for Options logic (VolTide)
    spx_contract = Index('SPX', 'CBOE')
    ib.qualifyContracts(spx_contract)
    spx_ticker = ib.reqMktData(spx_contract, '', False, False)

    # Initialize option greeks variables
    vol_tide_score = 100.0
    cone_up = None
    cone_down = None
    last_skew_update = 0
    option_tickers = [] # [atm, put90, call120]
    
    ib.sleep(3) # Wait for initial data

    while True:
        now = datetime.now()
        hour = now.hour
        minute = now.minute
        timestamp = now.timestamp()
        
        is_active = (hour == 0 and minute >= 5) or (START_HOUR + 1 <= hour < END_HOUR)
        
        # Ensure we process incoming IBKR messages to keep subscriptions alive
        ib.sleep(POLL_INTERVAL)

        if is_active:
            # We get marketPrice() which uses last price, or bid/ask average if last price is not available
            vix = vix_ticker.marketPrice()
            esf = esf_ticker.marketPrice()
            spx = spx_ticker.marketPrice()
            
            # 1. Update Option Selection every 15 minutes (or if none selected)
            if (timestamp - last_skew_update > 900 or not option_tickers) and spx == spx and spx > 0:
                print(f"[{now.strftime('%H:%M:%S')}] Updating Option Skew targets (SPX at {spx})...")
                
                # Fetch chain
                chains = ib.reqSecDefOptParams(spx_contract.symbol, '', spx_contract.secType, spx_contract.conId)
                if chains:
                    # Preference: SPX (Standard) then SPXW (Weekly)
                    chain = next((c for c in chains if c.exchange == 'CBOE' and c.tradingClass == 'SPX'), None)
                    if not chain:
                        chain = next((c for c in chains if c.exchange == 'CBOE'), None)
                    
                    if chain:
                        # Find nearest weekly/monthly expiration (at least 2 days out, at most 30)
                        expirations = sorted(chain.expirations)
                        target_exp = expirations[0] 
                        for exp in expirations:
                            # Simple logic: closest to 7-10 days
                            try:
                                days = (datetime.strptime(exp, '%Y%m%d') - datetime.now()).days
                                if days >= 2:
                                    target_exp = exp
                                    break
                            except: continue
                        
                        # Strikes (Ensure we stay within bounds of what TWS offers)
                        strikes = sorted(chain.strikes)
                        target_90 = spx * 0.90
                        target_120 = spx * 1.20
                        
                        atm_strike = min(strikes, key=lambda x: abs(x - spx))
                        put90_strike = min(strikes, key=lambda x: abs(x - target_90))
                        call120_strike = min(strikes, key=lambda x: abs(x - target_120))
                        trading_class = chain.tradingClass

                        # 0DTE / nearest expiration for Intraday Range calculation
                        exp_0dte = expirations[0]
                        atm_0dte_c = Option('SPX', exp_0dte, atm_strike, 'C', 'CBOE', multiplier='100', tradingClass=trading_class)
                        atm_0dte_p = Option('SPX', exp_0dte, atm_strike, 'P', 'CBOE', multiplier='100', tradingClass=trading_class)
                        atm_c = Option('SPX', target_exp, atm_strike, 'C', 'CBOE', multiplier='100', tradingClass=trading_class)
                        put90_c = Option('SPX', target_exp, put90_strike, 'P', 'CBOE', multiplier='100', tradingClass=trading_class)
                        call120_c = Option('SPX', target_exp, call120_strike, 'C', 'CBOE', multiplier='100', tradingClass=trading_class)
                        
                        print(f"Qualifying: Exp0DTE={exp_0dte}, ATM={atm_strike}, ExpVolTide={target_exp}, P90={put90_strike}, C120={call120_strike} ({trading_class})")
                        qualified = ib.qualifyContracts(atm_0dte_c, atm_0dte_p, atm_c, put90_c, call120_c)
                        
                        # Cancel old
                        for t in option_tickers:
                            ib.cancelMktData(t.contract)
                            
                        # Request new
                        option_tickers = []
                        if atm_0dte_c in qualified: option_tickers.append(ib.reqMktData(atm_0dte_c, '106', False, False))
                        if atm_0dte_p in qualified: option_tickers.append(ib.reqMktData(atm_0dte_p, '106', False, False))
                        if atm_c in qualified and atm_c not in option_tickers: option_tickers.append(ib.reqMktData(atm_c, '106', False, False))
                        if put90_c in qualified: option_tickers.append(ib.reqMktData(put90_c, '106', False, False))
                        if call120_c in qualified: option_tickers.append(ib.reqMktData(call120_c, '106', False, False))
                        
                        last_skew_update = timestamp
                        print(f"Active Tickers: {len(option_tickers)} (Qualified: {[c.strike for c in qualified]})")

            # 2. Calculate VolTide Score & ATM Option Quotes
            atm_call_bid = None
            atm_call_ask = None
            atm_put_bid = None
            atm_put_ask = None

            if len(option_tickers) >= 2:
                # Find ATM 0DTE Call and Put tickers
                c_0dte_t = next((t for t in option_tickers if t.contract.right == 'C' and t.contract.strike == atm_strike), None)
                p_0dte_t = next((t for t in option_tickers if t.contract.right == 'P' and t.contract.strike == atm_strike), None)

                if c_0dte_t:
                    if c_0dte_t.bid and c_0dte_t.bid > 0: atm_call_bid = round(float(c_0dte_t.bid), 2)
                    if c_0dte_t.ask and c_0dte_t.ask > 0: atm_call_ask = round(float(c_0dte_t.ask), 2)
                if p_0dte_t:
                    if p_0dte_t.bid and p_0dte_t.bid > 0: atm_put_bid = round(float(p_0dte_t.bid), 2)
                    if p_0dte_t.ask and p_0dte_t.ask > 0: atm_put_ask = round(float(p_0dte_t.ask), 2)

                # Find the Put 90 and Call 120
                put_t = next((t for t in option_tickers if t.contract.right == 'P' and t.contract.strike != atm_strike), None)
                call_t = next((t for t in option_tickers if t.contract.right == 'C' and t.contract.strike > spx), None)
                atm_t = c_0dte_t or next((t for t in option_tickers if t.contract.right == 'C' and t.contract.strike <= spx), None)
                
                # Use modelGreeks safely
                put_iv = put_t.modelGreeks.impliedVol if (put_t and put_t.modelGreeks and put_t.modelGreeks.impliedVol) else None
                call_iv = call_t.modelGreeks.impliedVol if (call_t and call_t.modelGreeks and call_t.modelGreeks.impliedVol) else None
                atm_iv = atm_t.modelGreeks.impliedVol if (atm_t and atm_t.modelGreeks and atm_t.modelGreeks.impliedVol) else None
                
                if put_iv and call_iv and call_iv > 0:
                    vol_tide_score = round((put_iv / call_iv) * 100, 3)
                
                # 3. Straddle Cone Projection (using ATM IV)
                if atm_iv and atm_iv > 0:
                    move = atm_iv * esf * 0.052 # sqrt(1/365)
                    cone_up = round(esf + move, 2)
                    cone_down = round(esf - move, 2)
            
            # Check if vix/esf are valid numbers, not NaN or 0
            if vix == vix and esf == esf and vix > 0 and esf > 0:
                vix_rounded = round(float(vix), 2)
                esf_rounded = round(float(esf), 2)
                spx_rounded = round(float(spx), 2) if (spx and spx == spx and spx > 0) else None
                time_str = now.strftime('%H:%M:%S')
                
                point = {
                    "time": time_str, 
                    "vix": vix_rounded, 
                    "esf": esf_rounded,
                    "spx": spx_rounded,
                    "volTide": vol_tide_score,
                    "coneUp": cone_up,
                    "coneDown": cone_down,
                    "callBid": atm_call_bid,
                    "callAsk": atm_call_ask,
                    "putBid": atm_put_bid,
                    "putAsk": atm_put_ask
                }
                
                # Save locally
                append_to_session_file(get_today_key(), point)
                
                # Push to Cloud
                push_to_supabase(point)
                
                print(f"[{time_str}] VIX={vix_rounded}, ES=F={esf_rounded}, VolTide={vol_tide_score}")
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
