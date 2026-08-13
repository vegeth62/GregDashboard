-- Sottostante IBKR sugli snapshot dei volumi, per il calcolo del GEX reale.
--
-- Il GEX si calcola come gamma * contratti * 100 * S^2 * 0.01, e S dev'essere
-- il sottostante su cui IBKR ha valutato quel gamma. `spx_price` non basta:
-- prima dell'apertura del cash americano l'indice SPX non viene calcolato ed
-- e' NaN, mentre `undPrice` dei modelGreeks esiste sempre (deriva dai futures).
--
-- Il gamma per strike viaggia dentro il jsonb `volumes`, che non richiede
-- migrazione: ogni elemento diventa {strike, calls, puts, gamma}.
--
-- Da eseguire nel SQL Editor di Supabase.

alter table volumes_snapshots add column if not exists und_price float8;

-- Verifica: una riga.
select column_name, data_type
from information_schema.columns
where table_name = 'volumes_snapshots'
  and column_name = 'und_price';
