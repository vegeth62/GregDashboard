-- Volumi SPX: una riga per snapshot invece di una riga JSONB per giornata.
--
-- La vecchia tabella `volumes_data` teneva l'intera sessione in una cella
-- JSONB: ogni push rimandava ~200 KB e ogni lettura ne riscaricava altrettanti,
-- per mostrare i soli 100 snapshot che il poller riusciva a tenere (16 minuti).
-- Qui uno snapshot pesa ~1,8 KB e il client scarica solo quelli nuovi.
--
-- Da eseguire nel SQL Editor di Supabase.

create table if not exists volumes_snapshots (
    date       date    not null,
    time       text    not null,                 -- 'HH:MM:SS', ora locale del poller
    spx_price  float8,
    is_opening boolean not null default false,
    volumes    jsonb   not null,                 -- [{strike, calls, puts}] x ~37
    created_at timestamptz not null default now(),
    primary key (date, time)
);

-- La chiave primaria copre gia' il pattern di lettura
-- (`date = $1 and time > $2` ordinato per time): nessun indice aggiuntivo.

alter table volumes_snapshots enable row level security;

drop policy if exists "volumes_snapshots leggibili" on volumes_snapshots;
create policy "volumes_snapshots leggibili"
    on volumes_snapshots for select
    using (true);

drop policy if exists "volumes_snapshots scrivibili" on volumes_snapshots;
create policy "volumes_snapshots scrivibili"
    on volumes_snapshots for insert
    with check (true);

-- Il poller fa upsert su (date, time) per sopravvivere a un riavvio nello
-- stesso secondo: serve anche la policy di update.
drop policy if exists "volumes_snapshots aggiornabili" on volumes_snapshots;
create policy "volumes_snapshots aggiornabili"
    on volumes_snapshots for update
    using (true) with check (true);

-- Nessuna policy di DELETE: la chiave anon finisce nel bundle del browser,
-- la pulizia la fa pg_cron qui sotto (che gira come owner e bypassa la RLS).


-- ---------------------------------------------------------------------------
-- Pulizia notturna.
--
-- Senza storico da conservare non ha senso accumulare ~3.000 righe di volumi
-- piu' ~16.500 di market_data al giorno: sono ~9 MB/giorno, che riempirebbero
-- i 500 MB del piano free in un paio di mesi. Con questi due job il database
-- resta in stato stazionario.
--
-- Gira dentro Postgres, sui server di Supabase: non serve avere il PC acceso.
-- E gira come owner, quindi bypassa la RLS -- per questo non c'e' (e non deve
-- esserci) una policy di DELETE per anon.
--
-- ATTENZIONE: pg_cron ragiona in UTC. '5 1 * * *' = 01:05 UTC = 03:05 italiane
-- d'estate, 02:05 d'inverno: in entrambi i casi la finestra del poller
-- (13:30-22:00 locali) e' gia' chiusa e non ancora riaperta.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

select cron.unschedule('pulizia-volumi')
    where exists (select 1 from cron.job where jobname = 'pulizia-volumi');

select cron.schedule(
    'pulizia-volumi',
    '5 1 * * *',
    $$delete from volumes_snapshots where date < current_date$$
);

select cron.unschedule('pulizia-market-data')
    where exists (select 1 from cron.job where jobname = 'pulizia-market-data');

-- NB: market_data.date e' una colonna TEXT, non date -- senza il cast il job
-- fallirebbe con "operator does not exist: text < date". Il formato e'
-- 'YYYY-MM-DD', quindi il confronto lessicografico coincide con quello
-- cronologico. (In volumes_snapshots la colonna e' un date vero.)
select cron.schedule(
    'pulizia-market-data',
    '5 1 * * *',
    $$delete from market_data where date < current_date::text$$
);

-- Verifica: i due job devono comparire qui.
select jobname, schedule, active, command from cron.job order by jobname;


-- ---------------------------------------------------------------------------
-- Da eseguire solo dopo aver verificato che la nuova tabella si popola.
-- ---------------------------------------------------------------------------

-- drop table if exists volumes_data;
