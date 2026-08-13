-- Quote ATM su market_data, per il calcolo automatico dei range.
--
-- Il poller calcolava gia' bid/ask ATM, volTide e i coni, ma
-- `push_to_supabase()` spingeva solo vix, esf, time e date: tutto il resto
-- esisteva solo nel file JSON locale. Qui si aggiungono le colonne mancanti.
--
-- Le colonne `es_*` sono la novita': la mattina il range si calcola sulla
-- chain delle opzioni ES, non su SPX. Alle 10:35 CET sono le 04:35 a New
-- York, le SPX quotano in Global Trading Hours con spread larghi mentre le
-- ES 0DTE sono piene su CME (misurato: 0,3 punti di spread, 491 contratti
-- di volume sulla call ATM).
--
-- Da eseguire nel SQL Editor di Supabase.

-- Straddle ATM 0DTE sulla chain SPXW (usato per il range delle 15:35)
alter table market_data add column if not exists call_bid float8;
alter table market_data add column if not exists call_ask float8;
alter table market_data add column if not exists put_bid  float8;
alter table market_data add column if not exists put_ask  float8;
alter table market_data add column if not exists spx_atm_strike float8;

-- Straddle ATM sulla chain ES 0DTE (usato per il range delle 10:35)
alter table market_data add column if not exists es_call_bid   float8;
alter table market_data add column if not exists es_call_ask   float8;
alter table market_data add column if not exists es_put_bid    float8;
alter table market_data add column if not exists es_put_ask    float8;

-- Strike ATM effettivamente quotato: serve a poter verificare a posteriori
-- che il livello non sia stato calcolato su uno strike sbagliato.
alter table market_data add column if not exists es_atm_strike float8;

-- Riferimento SPX per il pannello Range. Volutamente separato da `spx`:
-- l'indice non e' calcolato prima dell'apertura del cash americano, e
-- scrivere la chiusura del giorno prima nella colonna vera disegnerebbe sul
-- grafico una linea piatta da mezzanotte alle 15:30. Qui invece serve solo
-- a non mostrare un basis inventato nel pannello.
alter table market_data add column if not exists spx_ref float8;

-- Verifica: devono comparire tutte e undici.
select column_name, data_type
from information_schema.columns
where table_name = 'market_data'
  and column_name in ('call_bid','call_ask','put_bid','put_ask','spx_atm_strike',
                      'es_call_bid','es_call_ask','es_put_bid','es_put_ask',
                      'es_atm_strike','spx_ref')
order by column_name;
