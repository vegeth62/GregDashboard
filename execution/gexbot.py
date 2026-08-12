import json, random, datetime, os, sys

try:
    from ib_insync import IB, Index
except ImportError:
    print("Error: ib_insync is not installed. Please run 'pip install ib_insync'.")
    sys.exit(1)

def get_current_spx():
    """Fetch current SPX price from the local IBKR TWS API."""
    ib = IB()
    try:
        ib.connect('127.0.0.1', 7496, clientId=random.randint(1000, 9999), timeout=10)
        ib.reqMarketDataType(1)

        spx_contract = Index('SPX', 'CBOE')
        ib.qualifyContracts(spx_contract)
        spx_ticker = ib.reqMktData(spx_contract, '', False, False)
        ib.sleep(3)

        price = spx_ticker.marketPrice()
        if price == price and price > 0:
            return float(price)
    except Exception as e:
        print(f"Error fetching SPX price from IBKR: {e}")
    finally:
        if ib.isConnected():
            ib.disconnect()

    raise RuntimeError("No valid SPX price available from IBKR TWS API")

def generate_gex_data(num_points=300):
    """Generate synthetic GEX data centered around the current SPX price.
    Returns a list of dicts with fields:
        time: ISO time string (HH:MM:SS)
        strike: float (centered around SPX price, step of 5)
        gex: float (positive/negative exposure value)
    """
    spx_base = get_current_spx()
    # Align base price to closest 5 points
    spx_base_aligned = round(spx_base / 5) * 5
    
    # Generate strikes in range of SPX +/- 100 points, steps of 5
    strikes = [spx_base_aligned + offset for offset in range(-100, 101, 5)]
    
    start_time = datetime.datetime.utcnow().replace(hour=13, minute=30, second=0, microsecond=0) # 9:30 EST
    data = []
    
    for i in range(num_points):
        # Time steps every 1 minute
        timestamp = (start_time + datetime.timedelta(minutes=i)).strftime('%H:%M:%S')
        
        # Pick 3 to 8 random strikes to receive GEX updates at each time step
        active_strikes = random.sample(strikes, random.randint(3, 8))
        for strike in active_strikes:
            # GEX is larger near the center (SPX base price)
            distance = abs(strike - spx_base)
            magnitude = max(10, 100 - distance)
            
            oi = random.randint(50, 400)
            vol = random.randint(10, 80)
            sign = random.choice([-1, 1])
            gex = sign * oi * vol * 0.01 * (magnitude / 100.0)
            
            data.append({
                "time": timestamp,
                "strike": float(strike),
                "gex": round(gex, 2)
            })
            
    return data

if __name__ == "__main__":
    today = datetime.date.today().isoformat()
    out_dir = os.path.join(os.path.dirname(__file__), "../data/gex")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{today}.json")
    with open(out_path, "w") as f:
        json.dump(generate_gex_data(), f, indent=2)
    print(f"GEX data written to {out_path} centered around SPX price")
