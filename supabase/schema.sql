create table if not exists ge_acct(name_l text primary key, name text not null, salt text not null, hash text not null, token text unique not null, home int[] not null, created bigint not null);
create table if not exists ge_pub(name_l text primary key references ge_acct(name_l) on delete cascade, data jsonb not null, t bigint not null);
create table if not exists ge_save(name_l text primary key references ge_acct(name_l) on delete cascade, z text not null, t bigint not null, updated timestamptz default now());
create table if not exists ge_meta(k text primary key, v jsonb);
alter table ge_acct enable row level security; alter table ge_pub enable row level security; alter table ge_save enable row level security; alter table ge_meta enable row level security;
create extension if not exists pg_cron; create extension if not exists pg_net;
