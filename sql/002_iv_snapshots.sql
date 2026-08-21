-- Volatilita' implicita SPX 0DTE: una riga per snapshot.
--
-- La tabella non era mai stata creata: `tws_iv_poller.py` la scrive dal 19
-- agosto 2026 e ogni push falliva con
--   Could not find the table 'public.iv_snapshots' in the schema cache
-- In locale non si notava, perche' il poller scrive comunque il suo JSON e la
-- route ripiega su quello; in cloud invece non e' mai arrivato niente.
--
-- Da eseguire nel SQL Editor di Supabase.

create table if not exists iv_snapshots (
    date                date    not null,
    time                text    not null,        -- 'HH:MM:SS', ora locale del poller
    es_price            float8,
    atm_strike          float8,
    weighted_put_iv     float8,
    weighted_call_iv    float8,
    put_iv_change_pct   float8,
    call_iv_change_pct  float8,
    iv_differential_pct float8,
    puts_data           jsonb,                   -- [{strike, bid, ask, mid, iv}] x ~5
    calls_data          jsonb,
    created_at          timestamptz not null default now(),
    primary key (date, time)
);

-- Le colonne dei valori restano nullable di proposito: quando IBKR non ha
-- ancora un prezzo il poller manda null, e un null e' un'informazione onesta.
-- (Fino al 21/08/2026 mandava NaN, che JSON non prevede: bastava un valore
-- mancante per rendere illeggibile l'intero file di giornata.)

-- La chiave primaria copre gia' il pattern di lettura
-- (`date = $1 and time > $2` ordinato per time): nessun indice aggiuntivo.

alter table iv_snapshots enable row level security;

drop policy if exists "iv_snapshots leggibili" on iv_snapshots;
create policy "iv_snapshots leggibili"
    on iv_snapshots for select
    using (true);

drop policy if exists "iv_snapshots scrivibili" on iv_snapshots;
create policy "iv_snapshots scrivibili"
    on iv_snapshots for insert
    with check (true);

-- Il poller fa upsert su (date, time) per sopravvivere a un riavvio nello
-- stesso secondo: serve anche la policy di update.
drop policy if exists "iv_snapshots aggiornabili" on iv_snapshots;
create policy "iv_snapshots aggiornabili"
    on iv_snapshots for update
    using (true) with check (true);

-- Nessuna policy di DELETE: la chiave anon finisce nel bundle del browser,
-- la pulizia la fa pg_cron qui sotto (che gira come owner e bypassa la RLS).


-- ---------------------------------------------------------------------------
-- Pulizia notturna.
--
-- Uno snapshot ogni 5 secondi dalle 13:30 alle 22:00 fa ~6.100 righe al
-- giorno, e ognuna porta due array JSONB: circa 8 MB al giorno, che da soli
-- riempirebbero i 500 MB del piano free in due mesi. Con questo job il
-- database resta in stato stazionario, come per i volumi.
--
-- pg_cron ragiona in UTC: '5 1 * * *' = 03:05 italiane d'estate, 02:05
-- d'inverno. In entrambi i casi la finestra del poller e' chiusa.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

select cron.unschedule('pulizia-iv')
    where exists (select 1 from cron.job where jobname = 'pulizia-iv');

select cron.schedule(
    'pulizia-iv',
    '5 1 * * *',
    $$delete from iv_snapshots where date < current_date$$
);

-- Verifica: il job deve comparire qui insieme agli altri.
select jobname, schedule, active, command from cron.job order by jobname;
