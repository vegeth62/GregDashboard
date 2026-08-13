-- VWAP di giornata di ES, per tracciarlo sul grafico di /market.
--
-- Arriva da IBKR con il generic tick 233 (RTVolume), che porta con se' il
-- volume-weighted average price della sessione. Sul VIX non si richiede:
-- e' un indice, non ha volume, e restituisce NaN.
--
-- Da eseguire nel SQL Editor di Supabase.

alter table market_data add column if not exists vwap float8;

-- Verifica: una riga.
select column_name, data_type
from information_schema.columns
where table_name = 'market_data' and column_name = 'vwap';
