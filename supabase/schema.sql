create table if not exists ge_acct(name_l text primary key, name text not null, salt text not null, hash text not null, token text unique not null, home int[] not null, created bigint not null);
create table if not exists ge_pub(name_l text primary key references ge_acct(name_l) on delete cascade, data jsonb not null, t bigint not null);
create table if not exists ge_save(name_l text primary key references ge_acct(name_l) on delete cascade, z text not null, t bigint not null, updated timestamptz default now());
create table if not exists ge_meta(k text primary key, v jsonb);
alter table ge_acct enable row level security; alter table ge_pub enable row level security; alter table ge_save enable row level security; alter table ge_meta enable row level security;
create extension if not exists pg_cron; create extension if not exists pg_net;
create table if not exists ge_fleet(id bigserial primary key, from_l text not null, to_l text, to_npc text, mission text not null, data jsonb not null, arrive bigint not null, status text not null default 'out', result jsonb, created timestamptz default now());
create index if not exists ge_fleet_to on ge_fleet(to_l,status); create index if not exists ge_fleet_from on ge_fleet(from_l,status);
create table if not exists ge_event(id bigserial primary key, name_l text not null, data jsonb not null, acked boolean not null default false, created timestamptz default now());
create index if not exists ge_event_n on ge_event(name_l,acked);
create table if not exists ge_ally(tag text primary key, name text not null, founder text not null, descr text default '', members jsonb not null default '[]', apps jsonb not null default '[]', created bigint not null);
create table if not exists ge_chat(id bigserial primary key, ch text not null, name text not null, txt text not null, t bigint not null);
create index if not exists ge_chat_ch on ge_chat(ch,id);
alter table ge_fleet enable row level security; alter table ge_event enable row level security; alter table ge_ally enable row level security; alter table ge_chat enable row level security;
-- Review A4/F10: vollständiges Schema (ge_gift mit tatsächlich abgefragten Spalten), Indizes, Revisions-/Lease-Spalten, Cron
create table if not exists ge_gift(id bigserial primary key, name_l text not null references ge_acct(name_l) on delete cascade, dm integer not null default 0, msg text default '', sender text default 'Admin', created bigint not null, claimed bigint);
create index if not exists ge_gift_name on ge_gift(name_l);
alter table ge_gift enable row level security;
alter table ge_acct add column if not exists token_t bigint;
create unique index if not exists ge_acct_home_u on ge_acct(home);
alter table ge_fleet add column if not exists busy_at bigint;
alter table ge_fleet add column if not exists cid text;
create unique index if not exists ge_fleet_cid_u on ge_fleet(from_l, cid) where cid is not null;
create index if not exists ge_event_created on ge_event(name_l, id);
-- Stündlicher Rang-Schnappschuss (URL an das eigene Projekt anpassen):
-- select cron.schedule('ge-tick','5 * * * *',$$select net.http_post(url:='https://<ref>.supabase.co/functions/v1/ge/api/tick', headers:='{"content-type":"application/json"}'::jsonb, body:='{}'::jsonb)$$);
