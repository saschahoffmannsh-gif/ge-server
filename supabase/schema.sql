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
-- v64 Ränge R1–R5
update ge_ally set members=(select coalesce(jsonb_agg(case when m->>'rank'='founder' or m->>'n'=founder then jsonb_set(m,'{rank}','"r5"') when m->>'rank'='officer' then jsonb_set(m,'{rank}','"r4"') when m->>'rank' in ('r1','r2','r3','r4','r5') then m else jsonb_set(m,'{rank}','"r1"') end),'[]'::jsonb) from jsonb_array_elements(members) m), cfg=(cfg-'ranks')||jsonb_build_object('rp','{"r4":["acc","kick","rank","msg","treas","shop"],"r3":["acc","msg"],"r2":[],"r1":[]}'::jsonb), ver=ver+1 where cfg->'rp' is null returning tag,members,cfg;

-- ===================== ZIP155 (Punkte 1+2): Überfall-/Pushschutz, Hilfsbudget, Aufholbonus =====================
-- Additiv, idempotent. Regeln werden ausschließlich serverseitig über ge_meta 'rules155' aktiviert.
alter table ge_acct add column if not exists kind text not null default 'normal';
alter table ge_acct add column if not exists last_act bigint;
update ge_acct set kind='test' where name_l like 'zz%' and kind='normal';
-- Allianzverlauf: stabile Allianz-ID (cfg.id), ein offenes Intervall je Konto, Tombstones bei Auflösung
create table if not exists ge_ally_hist(id bigserial primary key, name_l text not null, ally_id text not null, tag text not null, joined_at bigint not null, left_at bigint, reason text);
create unique index if not exists ge_ally_hist_open on ge_ally_hist(name_l) where left_at is null;
create index if not exists ge_ally_hist_ally on ge_ally_hist(ally_id, name_l);
create table if not exists ge_ally_tomb(ally_id text primary key, tag text not null, name text not null, deleted_at bigint not null);
alter table ge_ally_hist enable row level security; alter table ge_ally_tomb enable row level security;
create or replace function ge_now_ms() returns bigint language sql as $$ select (extract(epoch from clock_timestamp())*1000)::bigint $$;
create or replace function ge_ally_hist_trg() returns trigger language plpgsql security definer set search_path=public as $$
declare nm text; t bigint := ge_now_ms(); aid text;
begin
 if tg_op in ('UPDATE','DELETE') then
  for nm in select lower(trim(m->>'n')) from jsonb_array_elements(old.members) m except select lower(trim(m->>'n')) from jsonb_array_elements(case when tg_op='DELETE' then '[]'::jsonb else new.members end) m loop
   update ge_ally_hist set left_at=t, reason=case when tg_op='DELETE' then 'disband' else 'left' end where name_l=nm and left_at is null and ally_id=coalesce(old.cfg->>'id',old.tag);
  end loop;
  if tg_op='DELETE' then insert into ge_ally_tomb(ally_id,tag,name,deleted_at) values(coalesce(old.cfg->>'id',old.tag),old.tag,old.name,t) on conflict(ally_id) do nothing; return old; end if;
 end if;
 aid := coalesce(new.cfg->>'id', new.tag);
 for nm in select lower(trim(m->>'n')) from jsonb_array_elements(new.members) m except select lower(trim(m->>'n')) from jsonb_array_elements(case when tg_op='INSERT' then '[]'::jsonb else old.members end) m loop
  if exists(select 1 from ge_ally_hist where name_l=nm and left_at is null) then raise exception 'GE:Spieler ist bereits in einer Allianz' using errcode='23505'; end if;
  insert into ge_ally_hist(name_l,ally_id,tag,joined_at) values(nm,aid,new.tag,t);
 end loop;
 return new;
end $$;
drop trigger if exists ge_ally_hist_t on ge_ally;
create trigger ge_ally_hist_t after insert or update of members or delete on ge_ally for each row execute function ge_ally_hist_trg();
-- Migration: aktuelle Mitgliedschaften ab Migrationszeitpunkt (keine erfundene Vorgeschichte)
insert into ge_ally_hist(name_l,ally_id,tag,joined_at,reason)
 select lower(trim(m->>'n')), coalesce(a.cfg->>'id',a.tag), a.tag, ge_now_ms(), 'migration' from ge_ally a cross join lateral jsonb_array_elements(a.members) m
 where not exists(select 1 from ge_ally_hist h where h.name_l=lower(trim(m->>'n')) and h.left_at is null);
-- Angriffsbuch und Hilfsbuch
create table if not exists ge_atk(id bigserial primary key, fleet_id bigint unique not null, cid text, from_l text not null, to_l text not null, coord text not null, allys text[] not null default '{}', status text not null, reserved_at bigint not null, combat_at bigint, released_at bigint, reason text, grandfathered boolean not null default false);
create index if not exists ge_atk_pl on ge_atk(from_l,to_l,coord,status); create index if not exists ge_atk_al on ge_atk using gin(allys);
create table if not exists ge_aid(id bigserial primary key, fleet_id bigint unique, src text not null, from_l text, to_l text not null, coord text, m bigint not null default 0, k bigint not null default 0, g bigint not null default 0, d_from numeric, d_to numeric, ref jsonb, status text not null, reserved_at bigint not null, delivered_at bigint, released_at bigint, reason text, grandfathered boolean not null default false);
create index if not exists ge_aid_to on ge_aid(to_l,status);
create table if not exists ge_aidref(name_l text primary key, m numeric not null, k numeric not null, g numeric not null, t bigint not null);
create table if not exists ge_cu_ref(valid_from bigint primary key, valid_to bigint, calculated_at bigint not null, active boolean not null, reason text, r numeric, n int, ids jsonb, params jsonb);
alter table ge_atk enable row level security; alter table ge_aid enable row level security; alter table ge_aidref enable row level security; alter table ge_cu_ref enable row level security;
-- Bestandsübernahme fliegender Flotten (Bestandsschutz, genau einmal)
insert into ge_atk(fleet_id,cid,from_l,to_l,coord,allys,status,reserved_at,grandfathered,reason)
 select f.id,f.cid,f.from_l,f.to_l,concat(f.data->'to'->>'g',':',f.data->'to'->>'s',':',f.data->'to'->>'p'),
  coalesce((select array_agg(distinct h.ally_id) from ge_ally_hist h where h.name_l=f.from_l and h.left_at is null),'{}'),'reserved',ge_now_ms(),true,'migration_grandfathered'
 from ge_fleet f where f.mission='attack' and f.to_l is not null and f.status in ('out','busy') on conflict(fleet_id) do nothing;
insert into ge_aid(fleet_id,src,from_l,to_l,coord,m,k,g,status,reserved_at,grandfathered,reason)
 select f.id,'fleet',f.from_l,f.to_l,concat(f.data->'to'->>'g',':',f.data->'to'->>'s',':',f.data->'to'->>'p'),
  coalesce((f.data->'cargo'->>'m')::numeric,0)::bigint,coalesce((f.data->'cargo'->>'k')::numeric,0)::bigint,coalesce((f.data->'cargo'->>'g')::numeric,0)::bigint,'reserved',ge_now_ms(),true,'migration_grandfathered'
 from ge_fleet f where f.mission='transport' and f.to_l is not null and f.to_l<>f.from_l and f.status in ('out','busy') on conflict(fleet_id) do nothing;
insert into ge_meta(k,v) values('rules155', jsonb_build_object('v',1,'protect',true,'aid',true,'catchup',true,'activated',ge_now_ms())) on conflict(k) do nothing;

-- Schutzprüfung zwischen zwei Konten (Allianz aktuell / 48-h-Neutralität / 5×) unter derselben Sperre wie Starts und Commits
create or replace function ge_pair_block(p_a text,p_b text,p_now bigint) returns text language plpgsql security definer set search_path=public as $$
declare da numeric; dbv numeric; ends bigint;
begin
 if exists(select 1 from ge_ally_hist x join ge_ally_hist y on x.ally_id=y.ally_id where x.name_l=p_a and y.name_l=p_b and x.left_at is null and y.left_at is null) then return 'Ziel ist in deiner Allianz'; end if;
 select max(least(coalesce(x.left_at,9e15::bigint),coalesce(y.left_at,9e15::bigint))) into ends from ge_ally_hist x join ge_ally_hist y on x.ally_id=y.ally_id
  where x.name_l=p_a and y.name_l=p_b and x.joined_at<coalesce(y.left_at,9e15::bigint) and y.joined_at<coalesce(x.left_at,9e15::bigint);
 if ends is not null and ends<=p_now and p_now-ends<172800000 then return 'Neutralitätsfrist nach gemeinsamer Allianz (48 h) bis '||to_char(to_timestamp((ends+172800000)/1000.0) at time zone 'Europe/Berlin','DD.MM. HH24:MI'); end if;
 select greatest(1,coalesce((data->>'devMax')::numeric,0)) into da from ge_pub where name_l=p_a; select greatest(1,coalesce((data->>'devMax')::numeric,0)) into dbv from ge_pub where name_l=p_b;
 if greatest(coalesce(da,1),coalesce(dbv,1))/least(coalesce(da,1),coalesce(dbv,1))>5 then return 'Entwicklungsabstand zu groß (max. 5×)'; end if;
 return null;
end $$;
create or replace function ge_atk_counts(p_from text,p_to text,p_coord text,p_now bigint) returns jsonb language sql security definer set search_path=public as $$
 with live as (select * from ge_atk where from_l=p_from or to_l=p_to)
 select jsonb_build_object(
  'planet',(select count(*) from live where from_l=p_from and to_l=p_to and coord=p_coord and (status='reserved' or (status='fought' and combat_at>p_now-86400000))),
  'acct',(select count(*) from live where from_l=p_from and to_l=p_to and (status='reserved' or (status='fought' and combat_at>p_now-86400000))),
  'allys',coalesce((select jsonb_object_agg(al,(select count(*) from ge_atk z where z.to_l=p_to and al=any(z.allys) and (z.status='reserved' or (z.status='fought' and z.combat_at>p_now-86400000)))) from (select distinct ally_id al from ge_ally_hist where name_l=p_from and (left_at is null or left_at>p_now-172800000)) q),'{}'::jsonb),
  'next',(select min(combat_at)+86400000 from live where from_l=p_from and to_l=p_to and status='fought' and combat_at>p_now-86400000))
$$;
create or replace function ge_aid_state(p_to text,p_now bigint) returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('ref',(select jsonb_build_object('m',m,'k',k,'g',g,'t',t) from ge_aidref where name_l=p_to),
  'used',(select jsonb_build_object('m',coalesce(sum(m),0),'k',coalesce(sum(k),0),'g',coalesce(sum(g),0)) from ge_aid where to_l=p_to and (status='reserved' or (status='delivered' and delivered_at>p_now-86400000))),
  'next',(select min(delivered_at)+86400000 from ge_aid where to_l=p_to and status='delivered' and delivered_at>p_now-86400000))
$$;
-- Hilfsreservierung (gemeinsam für Flotten und Sofortwege); wirft GE:-Fehler bei Ablehnung
create or replace function ge_aid_reserve(p jsonb,p_fleet bigint) returns void language plpgsql security definer set search_path=public as $$
-- v2 (Sascha 16.10.): je Lieferung höchstens 20 % des Bestands des Startplaneten je Rohstoff (Bestand vor dem Versand, s0),
-- und je Spenderkonto nur eine Lieferung alle 48 h (reserviert oder zugestellt; zurückgerufene/abgelehnte zählen nicht). Kein Empfängerbudget, keine Richtungsprüfung.
declare nowv bigint := (p->>'now')::bigint; req jsonb := p->'res'; s0 jsonb := p->'s0'; lastv bigint; r text;
begin
 if p->>'from_l' is null then return; end if; -- Tresor & Co.: keine Begrenzung
 if s0 is null or jsonb_typeof(s0)<>'object' then raise exception 'GE:Bitte Spiel neu laden (Lieferung ohne Bestandsangabe)' using errcode='P0001'; end if;
 foreach r in array array['m','k','g'] loop
  if coalesce((req->>r)::numeric,0)>floor(greatest(0,coalesce((s0->>r)::numeric,0))*0.2) then raise exception 'GE:Höchstens 20 %% deines Bestands je Rohstoff pro Lieferung' using errcode='P0001'; end if;
 end loop;
 select max(reserved_at) into lastv from ge_aid where from_l=p->>'from_l' and src='fleet' and status in ('reserved','delivered') and reserved_at>nowv-172800000;
 if lastv is not null then raise exception 'GE:Nur eine Lieferung alle 48 h – wieder möglich ab %',to_char(to_timestamp((lastv+172800000)/1000.0) at time zone 'Europe/Berlin','DD.MM. HH24:MI') using errcode='P0001'; end if;
 insert into ge_aid(fleet_id,src,from_l,to_l,coord,m,k,g,ref,status,reserved_at)
  values(p_fleet,'fleet',p->>'from_l',p->>'to_l',p->>'coord',(req->>'m')::bigint,(req->>'k')::bigint,(req->>'g')::bigint,jsonb_build_object('s0',s0,'pct',0.2),'reserved',nowv);
end $$;
create or replace function ge_aid_next(p_from text,p_now bigint) returns bigint language sql security definer set search_path=public as $$
 select max(reserved_at)+172800000 from ge_aid where from_l=p_from and src='fleet' and status in ('reserved','delivered') and reserved_at>p_now-172800000 $$;
revoke all on function ge_aid_next(text,bigint) from public,anon,authenticated; grant execute on function ge_aid_next(text,bigint) to service_role;

drop function if exists ge_start_fleet(text,bigint,text,text,text,text,jsonb,bigint);
create or replace function ge_start_fleet(p_name text,p_base bigint,p_cid text,p_target text,p_npc text,p_mission text,p_data jsonb,p_arrive bigint,p_rules jsonb default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare i bigint;r bigint;nowv bigint;why text;c jsonb;al text;coordv text;
begin
 perform pg_advisory_xact_lock(71941659);
 select id into i from ge_fleet where from_l=p_name and cid=p_cid;if i is not null then return i;end if;
 select rev into r from ge_save where name_l=p_name for update;if r is null or r<>p_base then raise exception 'state conflict' using errcode='40001';end if;
 nowv:=coalesce((p_rules->>'now')::bigint,ge_now_ms());coordv:=concat(p_data->'to'->>'g',':',p_data->'to'->>'s',':',p_data->'to'->>'p');
 if p_rules is not null and p_target is not null and p_mission in ('attack','spy') and coalesce((p_rules->>'protect')::boolean,false) then
  why:=ge_pair_block(p_name,p_target,nowv);if why is not null then raise exception 'GE:%',why using errcode='P0001';end if;
  if p_mission='attack' then
   c:=ge_atk_counts(p_name,p_target,coordv,nowv);
   if (c->>'planet')::int>=3 then raise exception 'GE:Höchstens 3 Angriffe auf denselben Planeten in 24 h' using errcode='P0001';end if;
   if (c->>'acct')::int>=6 then raise exception 'GE:Höchstens 6 Angriffe auf dasselbe Konto in 24 h' using errcode='P0001';end if;
   for al in select key from jsonb_each_text(c->'allys') where value::int>=10 loop raise exception 'GE:Deine Allianz (auch frühere der letzten 48 h) hat dieses Konto bereits 10× in 24 h angegriffen' using errcode='P0001';end loop;
  end if;
 end if;
 if p_rules is not null and p_target is not null and p_mission='transport' and p_target<>p_name and coalesce((p_rules->>'aidOn')::boolean,false) and (p_rules->>'ally')::boolean is true then
  if not exists(select 1 from ge_ally_hist x join ge_ally_hist y on x.ally_id=y.ally_id where x.name_l=p_name and y.name_l=p_target and x.left_at is null and y.left_at is null) then raise exception 'GE:Allianzlieferung nur an Mitglieder deiner Allianz' using errcode='P0001';end if;
 end if;
 insert into ge_fleet(from_l,to_l,to_npc,mission,data,arrive,cid)values(p_name,p_target,p_npc,p_mission,p_data,p_arrive,p_cid)returning id into i;
 if p_rules is not null and p_target is not null and p_mission='attack' and coalesce((p_rules->>'protect')::boolean,false) then
  insert into ge_atk(fleet_id,cid,from_l,to_l,coord,allys,status,reserved_at) values(i,p_cid,p_name,p_target,coordv,coalesce((select array_agg(key) from jsonb_each(c->'allys')),'{}'),'reserved',nowv);
 end if;
 if p_rules is not null and p_target is not null and p_mission='transport' and p_target<>p_name and coalesce((p_rules->>'aidOn')::boolean,false) then
  perform ge_aid_reserve(jsonb_build_object('now',nowv,'from_l',p_name,'to_l',p_target,'coord',coordv,'res',p_data->'cargo','s0',p_data->'s0','src','fleet'),i);
 end if;
 return i;
end $$;
revoke all on function ge_start_fleet(text,bigint,text,text,text,text,jsonb,bigint,jsonb) from public,anon,authenticated;
grant execute on function ge_start_fleet(text,bigint,text,text,text,text,jsonb,bigint,jsonb) to service_role;

-- Commit mit Buchungsübergängen (p_ledger): {t:'atk'|'aid', fleet_id, set:'fought'|'released'|'delivered', at, reason} | {t:'aidnow', ...} | {t:'pair', a, b}
drop function if exists ge_commit_game(jsonb,jsonb,jsonb,jsonb,jsonb);
create or replace function ge_commit_game(p_states jsonb default '[]', p_fleet jsonb default null,
 p_events jsonb default '[]', p_meta jsonb default '[]', p_debris jsonb default '[]', p_ledger jsonb default '[]')
returns jsonb language plpgsql security definer set search_path=public as $$
declare x jsonb; old jsonb; rev0 bigint; fr ge_fleet%rowtype; outv jsonb := '{}'; why text;
begin
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
 -- Kampf nur, wenn die Paarprüfung im selben Commit weiter gilt (z. B. gleichzeitiger Allianzeintritt)
 for x in select value from jsonb_array_elements(p_ledger) where value->>'t'='pair' loop
  why:=ge_pair_block(x->>'a',x->>'b',(x->>'at')::bigint);if why is not null then raise exception 'pair changed: %',why using errcode='40001';end if;
 end loop;
 for x in select value from jsonb_array_elements(p_ledger) where value->>'t'='aidnow' loop perform ge_aid_reserve(x,null); end loop;
 for x in select value from jsonb_array_elements(p_states) loop
  delete from ge_position where name_l=x->>'name_l';
  insert into ge_position(coord,name_l) select q#>>'{}',x->>'name_l' from jsonb_array_elements(x->'positions') q;
  update ge_save set z=x->>'z',t=(x->>'t')::bigint,rev=rev+1,updated=now() where name_l=x->>'name_l' returning rev into rev0;
  if x ? 'pub' then insert into ge_pub(name_l,data,t) values(x->>'name_l',x->'pub',(x->>'t')::bigint) on conflict(name_l) do update set data=jsonb_set(excluded.data,'{devMax}',to_jsonb(greatest(coalesce((ge_pub.data->>'devMax')::numeric,0),coalesce((excluded.data->>'devMax')::numeric,0)))),t=excluded.t;end if;
  if (x->>'act')::boolean is true then update ge_acct set last_act=(x->>'t')::bigint where name_l=x->>'name_l'; end if;
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
 -- Genau ein Übergang je Reservierung (nur aus 'reserved')
 for x in select value from jsonb_array_elements(p_ledger) where value->>'t' in ('atk','aid') loop
  if x->>'t'='atk' then
   update ge_atk set status=x->>'set',combat_at=case when x->>'set'='fought' then (x->>'at')::bigint end,released_at=case when x->>'set'='released' then (x->>'at')::bigint end,reason=coalesce(x->>'reason',reason) where fleet_id=(x->>'fleet_id')::bigint and status='reserved';
  else
   update ge_aid set status=x->>'set',delivered_at=case when x->>'set'='delivered' then (x->>'at')::bigint end,released_at=case when x->>'set'='released' then (x->>'at')::bigint end,reason=coalesce(x->>'reason',reason) where fleet_id=(x->>'fleet_id')::bigint and status='reserved';
  end if;
 end loop;
 return outv;
end $$;
revoke all on function ge_commit_game(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function ge_commit_game(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function ge_pair_block(text,text,bigint) from public,anon,authenticated; grant execute on function ge_pair_block(text,text,bigint) to service_role;
revoke all on function ge_atk_counts(text,text,text,bigint) from public,anon,authenticated; grant execute on function ge_atk_counts(text,text,text,bigint) to service_role;
revoke all on function ge_aid_state(text,bigint) from public,anon,authenticated; grant execute on function ge_aid_state(text,bigint) to service_role;
revoke all on function ge_aid_reserve(jsonb,bigint) from public,anon,authenticated; grant execute on function ge_aid_reserve(jsonb,bigint) to service_role;
-- Aufholreferenz: eine je Gültigkeitsbeginn (unique valid_from), Archiv wird nie überschrieben
create or replace function ge_cu_insert(p jsonb) returns boolean language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(71941659);
 if exists(select 1 from ge_cu_ref where valid_from=(p->>'valid_from')::bigint) then return false; end if;
 update ge_cu_ref set valid_to=(p->>'valid_from')::bigint where valid_to is null and valid_from<(p->>'valid_from')::bigint;
 insert into ge_cu_ref(valid_from,valid_to,calculated_at,active,reason,r,n,ids,params) values((p->>'valid_from')::bigint,null,(p->>'calculated_at')::bigint,(p->>'active')::boolean,p->>'reason',(p->>'r')::numeric,(p->>'n')::int,p->'ids',p->'params');
 return true;
end $$;
revoke all on function ge_cu_insert(jsonb) from public,anon,authenticated; grant execute on function ge_cu_insert(jsonb) to service_role;
