# execution/check_supabase.py
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

try:
    print("Testing table query...")
    res = supabase.table("market_data").select("time, vix, esf").limit(1).execute()
    print("Basic columns work:", res.data)
except Exception as e:
    print("Basic columns error:", e)

try:
    print("Testing 'spx' column query...")
    res_spx = supabase.table("market_data").select("spx").limit(1).execute()
    print("spx column exists! Data:", res_spx.data)
except Exception as e:
    print("spx column does NOT exist or has error:", e)
