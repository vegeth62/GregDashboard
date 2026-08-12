// frontend/check_supabase.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  try {
    const { data, error } = await supabase
      .from('market_data')
      .select('time, vix, esf')
      .limit(1);
    console.log('Columns time, vix, esf:', { data, error });

    const { data: dataSpx, error: errorSpx } = await supabase
      .from('market_data')
      .select('spx')
      .limit(1);
    console.log('Column spx:', { dataSpx, error: errorSpx?.message || errorSpx });
  } catch (e) {
    console.error('Err:', e);
  }
}

check();
