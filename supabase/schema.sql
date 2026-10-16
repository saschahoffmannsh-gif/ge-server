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


-- Command protocol v60: revisions, world ownership and atomic commits.
alter table ge_save add column if not exists rev bigint not null default 1;
alter table ge_event add column if not exists event_key text;
create unique index if not exists ge_event_key_u on ge_event(event_key) where event_key is not null;
create table if not exists ge_position(coord text primary key, name_l text not null references ge_acct(name_l) on delete cascade);
create table if not exists ge_debris(coord text primary key, data jsonb not null);
alter table ge_position enable row level security;
alter table ge_debris enable row level security;

-- Existing accounts reserve their homes and published colonies before new
-- registrations or colonization can claim those coordinates.
do $$
begin
 if exists(select coord from (
  select array_to_string(home,':') coord,name_l from ge_acct
  union select concat(p->>'g',':',p->>'s',':',p->>'p'),name_l from ge_pub cross join lateral jsonb_array_elements(data->'planets') p where not coalesce((p->>'moon')::boolean,false)
  union select coord,name_l from ge_position
 ) q group by coord having count(distinct name_l)>1) then
  raise exception 'Mehrere Konten belegen dieselbe Koordinate; Migration abgebrochen';
 end if;
 insert into ge_position(coord,name_l)
 select array_to_string(home,':'),name_l from ge_acct
 union select concat(p->>'g',':',p->>'s',':',p->>'p'),name_l from ge_pub cross join lateral jsonb_array_elements(data->'planets') p where not coalesce((p->>'moon')::boolean,false)
 on conflict(coord)do nothing;
end $$;

create or replace function ge_commit_game(p_states jsonb default '[]', p_fleet jsonb default null,
 p_events jsonb default '[]', p_meta jsonb default '[]', p_debris jsonb default '[]')
returns jsonb language plpgsql security definer set search_path=public as $$
declare x jsonb; old jsonb; rev0 bigint; fr ge_fleet%rowtype; outv jsonb := '{}';
begin
 -- One short database transaction serializes conflicting world commits. Edge
 -- computations run outside the lock and must present every input revision.
 perform pg_advisory_xact_lock(71941659);
 for x in select value from jsonb_array_elements(p_states) order by value->>'name_l' loop
  select rev into rev0 from ge_save where name_l=x->>'name_l' for update;
  if rev0 is null or rev0<>(x->>'base')::bigint then raise exception 'state conflict' using errcode='40001';end if;
 end loop;
 for x in select value from jsonb_array_elements(p_meta) loop
  select v into old from ge_meta where k=x->>'k' for update;
  if coalesce(old,'null'::jsonb)<>coalesce(x->'before','null'::jsonb) then raise exception 'ledger conflict' using errcode='40001';end if;
 end loop;
 for x in select value from jsonb_array_elements(p_debris) loop
  select data into old from ge_debris where coord=x->>'coord' for update;
  if coalesce(old,'null'::jsonb)<>coalesce(x->'before','null'::jsonb) then raise exception 'debris conflict' using errcode='40001';end if;
 end loop;
 for x in select value from jsonb_array_elements(case when p_fleet is null then '[]'::jsonb when jsonb_typeof(p_fleet)='array' then p_fleet else jsonb_build_array(p_fleet) end) loop
  select * into fr from ge_fleet where id=(x->>'id')::bigint for update;
  if fr.id is null or fr.status<>x->>'status' or fr.busy_at is distinct from (x->>'lease')::bigint then raise exception 'fleet conflict' using errcode='40001';end if;
 end loop;
 for x in select value from jsonb_array_elements(p_states) loop
  delete from ge_position where name_l=x->>'name_l';
  insert into ge_position(coord,name_l) select q#>>'{}',x->>'name_l' from jsonb_array_elements(x->'positions') q;
  update ge_save set z=x->>'z',t=(x->>'t')::bigint,rev=rev+1,updated=now() where name_l=x->>'name_l' returning rev into rev0;
  if x ? 'pub' then insert into ge_pub(name_l,data,t) values(x->>'name_l',x->'pub',(x->>'t')::bigint) on conflict(name_l) do update set data=excluded.data,t=excluded.t;end if;
  outv=jsonb_set(outv,array[x->>'name_l'],to_jsonb(rev0));
 end loop;
 for x in select value from jsonb_array_elements(p_meta) loop
  insert into ge_meta(k,v)values(x->>'k',x->'value')on conflict(k)do update set v=excluded.v;
 end loop;
 for x in select value from jsonb_array_elements(p_debris) loop
  if x->'value' is null or x->'value'='null'::jsonb then delete from ge_debris where coord=x->>'coord';
  else insert into ge_debris(coord,data)values(x->>'coord',x->'value')on conflict(coord)do update set data=excluded.data;end if;
 end loop;
 for x in select value from jsonb_array_elements(p_events) loop
  insert into ge_event(name_l,data,event_key)values(x->>'name_l',x->'data',x->>'key')on conflict(event_key)where event_key is not null do nothing;
 end loop;
 for x in select value from jsonb_array_elements(case when p_fleet is null then '[]'::jsonb when jsonb_typeof(p_fleet)='array' then p_fleet else jsonb_build_array(p_fleet) end) loop update ge_fleet set status=coalesce(x->>'nextStatus','done'),result=x->'result' where id=(x->>'id')::bigint;end loop;
 return outv;
end $$;
revoke all on function ge_commit_game(jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function ge_commit_game(jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;

create or replace function ge_register_game(p_account jsonb,p_z text,p_t bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(71941659);
 insert into ge_acct(name_l,name,salt,hash,token,token_t,home,created)
 values(p_account->>'name_l',p_account->>'name',p_account->>'salt',p_account->>'hash',p_account->>'token',(p_account->>'token_t')::bigint,array(select jsonb_array_elements_text(p_account->'home')::int),(p_account->>'created')::bigint);
 insert into ge_position(coord,name_l)values(array_to_string(array(select jsonb_array_elements_text(p_account->'home')),':'),p_account->>'name_l');
 insert into ge_save(name_l,z,t)values(p_account->>'name_l',p_z,p_t);
end $$;
revoke all on function ge_register_game(jsonb,text,bigint) from public,anon,authenticated;
grant execute on function ge_register_game(jsonb,text,bigint) to service_role;

create or replace function ge_start_fleet(p_name text,p_base bigint,p_cid text,p_target text,p_npc text,p_mission text,p_data jsonb,p_arrive bigint)
returns bigint language plpgsql security definer set search_path=public as $$
declare i bigint;r bigint;
begin
 perform pg_advisory_xact_lock(71941659);
 select id into i from ge_fleet where from_l=p_name and cid=p_cid;if i is not null then return i;end if;
 select rev into r from ge_save where name_l=p_name for update;if r is null or r<>p_base then raise exception 'state conflict' using errcode='40001';end if;
 insert into ge_fleet(from_l,to_l,to_npc,mission,data,arrive,cid)values(p_name,p_target,p_npc,p_mission,p_data,p_arrive,p_cid)returning id into i;return i;
end $$;
revoke all on function ge_start_fleet(text,bigint,text,text,text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function ge_start_fleet(text,bigint,text,text,text,text,jsonb,bigint) to service_role;
create or replace function ge_publish(p_name text,p_base bigint,p_data jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(71941659);
 if not exists(select 1 from ge_save where name_l=p_name and rev=p_base)then return false;end if;
 insert into ge_pub(name_l,data,t)values(p_name,p_data,(p_data->>'t')::bigint)on conflict(name_l)do update set data=excluded.data,t=excluded.t;return true;
end $$;
revoke all on function ge_publish(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function ge_publish(text,bigint,jsonb) to service_role;

-- Reserve login attempts before running PBKDF2, also across concurrent requests.
create or replace function ge_login_attempt(p_name text,p_t bigint)returns boolean
language plpgsql security definer set search_path=public as $$
declare a jsonb;recent int;last_t bigint;n int;wait_ms numeric;
begin
 perform pg_advisory_xact_lock(71941659);
 select coalesce(jsonb_agg(t),'[]'::jsonb) into a from ge_meta m cross join lateral jsonb_array_elements(m.v->'f') t where m.k='lf:'||p_name and (t#>>'{}')::bigint>p_t-3600000;
 select count(*),max((t#>>'{}')::bigint) into recent,last_t from jsonb_array_elements(a)t where (t#>>'{}')::bigint>p_t-900000;
 n=jsonb_array_length(a);wait_ms=900000*least(4,1+greatest(0,n-5)::numeric/5);
 if recent>=5 and p_t<last_t+wait_ms then return false;end if;
 insert into ge_meta(k,v)values('lf:'||p_name,jsonb_build_object('f',a||jsonb_build_array(p_t)))on conflict(k)do update set v=excluded.v;return true;
end $$;
revoke all on function ge_login_attempt(text,bigint) from public,anon,authenticated;
grant execute on function ge_login_attempt(text,bigint) to service_role;

-- v62 Allianz: Einstellungen/Ränge/Wappen (cfg), optimistische Version (ver); Tresor liegt in ge_meta 'treas:<cfg.id>'
alter table ge_ally add column if not exists cfg jsonb not null default '{}';
alter table ge_ally add column if not exists ver bigint not null default 0;
update ge_ally set cfg = jsonb_build_object('id', substr(replace(gen_random_uuid()::text,'-',''),1,16), 'mode','apply',
  'ranks', '[{"id":"officer","n":"Offizier","p":["acc","kick","msg"]},{"id":"member","n":"Mitglied","p":[]}]'::jsonb,
  'logo', '{"sh":0,"s":0,"c":0,"c2":7}'::jsonb) where not (cfg ? 'id');
