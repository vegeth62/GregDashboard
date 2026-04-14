import os
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime

# Load from execution/.env
load_dotenv()

SUBAPASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

def check_live_sync():
    print(f"Connecting to Supabase at {SUBAPASE_URL}...")
    supabase: Client = create_client(SUBAPASE_URL, SUPABASE_KEY)
    
    try:
        today = datetime.now().strftime('%Y-%m-%d')
        print(f"Checking latest entries for {today}...")
        res = supabase.table("market_data").select("*").eq("date", today).order("created_at", desc=True).limit(5).execute()
        
        if res.data:
            print(f"Found {len(res.data)} recently pushed items in Supabase:")
            for item in res.data:
                print(f" - [{item.get('time')}] ES: {item.get('esf')}, VIX: {item.get('vix')}")
        else:
            print("NO DATA FOUND in Supabase for today.")
            
    except Exception as e:
        print(f"Error fetching from Supabase: {e}")

if __name__ == "__main__":
    check_live_sync()
