// Galaxy Empire – Mehrspieler Stufe 1 als Supabase Edge Function (Postgres-Tabellen ge_*).
// Routen: /api/health, /api/register, /api/login, /api/universe, /api/me, /api/save (GET/POST), /api/pub, /api/tick
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { makeNPCs, stateAt, summary, allyNames } from "./npc.js";
(globalThis as any).window = globalThis; await import("./data.js"); await import("./engine.js");(globalThis as any).headless=true;await import("./campaign.js");await import("./planning.js");await import("./actions.js");await import("./protocol.js");
const E: any = (globalThis as any).ENGINE; const GE: any = (globalThis as any).GE;

const CFG = {
  invite: Deno.env.get("GE_INVITE") ?? "GALAXY",
  speed: +(Deno.env.get("GE_SPEED") ?? 10),
  epoch: +(Deno.env.get("GE_EPOCH") ?? Date.UTC(2026, 9, 14)),
  npcs: +(Deno.env.get("GE_NPCS") ?? 60),
  seed: +(Deno.env.get("GE_SEED") ?? 4242),
};
const VERSION = 2;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const NPCS = makeNPCs(CFG.seed, CFG.npcs, CFG.epoch);
const npcCache = new Map();
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,authorization,apikey,x-client-info", "access-control-allow-methods": "GET,POST,OPTIONS" };
const J = (o: unknown, s = 200) => Response.json(o, { status: s, headers: cors });
const err = (m: string, s = 400) => J({ error: m }, s);
const norm = (n: string) => String(n || "").trim().toLowerCase();
// Review F23: langsamer gesalzener Passworthash (PBKDF2-SHA256, 210.000 Iterationen); Altbestand (SHA-256) wird beim Login umgestellt
const PBKDF2_IT = 210000, TOKEN_MS = 30 * 864e5, FAIL_MAX = 5, FAIL_WIN = 15 * 60e3, ACTION_MAX = 64 * 1024, SNAP_MAX = 2 * 1024 * 1024;
async function pbkdf2(salt: string, pin: string) { const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(pin)), "PBKDF2", false, ["deriveBits"]);
  const b = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: PBKDF2_IT }, k, 256);
  return "pbkdf2$" + PBKDF2_IT + "$" + [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function pinOk(a: any, pin: string) { if (String(a.hash).startsWith("pbkdf2$")) return (await pbkdf2(a.salt, pin)) === a.hash; return (await sha(a.salt + pin)) === a.hash; }
// Rate-Limit: 5 Fehlversuche je Konto in 15 Minuten, danach gestaffelte Sperre (keine dauerhafte Fremdsperre)
async function failState(n: string) { const v = ((await meta("lf:" + n)) || { f: [] }) as any; const now = Date.now(); v.f = (v.f || []).filter((t: number) => now - t < 4 * FAIL_WIN); return v; }
function lockedFor(v: any) { const now = Date.now(); const recent = v.f.filter((t: number) => now - t < FAIL_WIN); if (recent.length < FAIL_MAX) return 0;
  const over = v.f.length - FAIL_MAX; const wait = FAIL_WIN * Math.min(4, 1 + Math.max(0, over) / FAIL_MAX); return Math.max(0, Math.max(...v.f) + wait - now); }
async function sha(s: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const tokenNew = () => [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
const must = <T>(r: { data: T; error: any }) => { if (r.error) throw new Error(r.error.message); return r.data; };

async function auth(req: Request) {
  const t = (req.headers.get("x-ge-token") || req.headers.get("authorization") || "").replace(/^Bearer /, ""); if (!t) return null;
  const r = must(await db.from("ge_acct").select("*").eq("token", t).maybeSingle()) as any; if (!r) return null;
  if (r.token_t && Date.now() - +r.token_t > TOKEN_MS) return null; // Review F23: Sitzungen laufen nach 30 Tagen Inaktivität ab (gleitend)
  if (!r.token_t || Date.now() - +r.token_t > 864e5) { r.token_t = Date.now(); await db.from("ge_acct").update({ token_t: r.token_t }).eq("name_l", r.name_l); }
  return r as any;
}
async function freeHome(): Promise<number[]> {const E=(globalThis as any).ENGINE.fork();
  const taken = new Set(NPCS.map((x) => x.home.join(":")));
  for (const a of must(await db.from("ge_acct").select("home")) as any[]) taken.add(a.home.join(":"));
  for (const p of must(await db.from("ge_pub").select("data")) as any[]) for (const q of p.data.planets || []) taken.add(`${q.g}:${q.s}:${q.p}`);
  // Review F09: freie Heimat aus einer endlichen gültigen Menge (ohne NPC-Plätze des Systems), Suchraum definiert erweitern; Client übernimmt sie unverändert
  E.newGame({ seed: CFG.seed, speed: CFG.speed });
  for (const span of [30, 120, 499]) { const cand: number[][] = [];
    for (let s = 1; s <= span; s++) { const np = E.npcAt(1, s); for (let p = 4; p <= 12; p++) if (!np.includes(p) && !taken.has(`1:${s}:${p}`)) cand.push([1, s, p]); }
    if (cand.length) return cand[Math.floor(Math.random() * cand.length)]; }
  throw new Error("Keine freie Heimatposition");
}
const pubAcct = (a: any) => ({ name: a.name, home: a.home, speed: CFG.speed, epoch: CFG.epoch, seed: CFG.seed, created: a.created });
async function meta(k: string) { const r = must(await db.from("ge_meta").select("v").eq("k", k).maybeSingle()) as any; return r ? r.v : null; }

async function universe(t = Date.now()) {
  const players = (must(await db.from("ge_pub").select("data")) as any[]).map((x) => { const { snap: _s, tech: _t, ...rest } = x.data; return rest; });
  const npcs = NPCS.filter((x) => t >= x.join).map((x) => summary(x, stateAt(x, t, CFG.speed, npcCache)));
  const snap = new Map<string, number>((await meta("snap")) || []);
  const ranking = [...players.map((p) => ({ id: "p:" + norm(p.name), n: p.name, tag: p.tag || null, home: p.home, pts: p.pts, npc: 0, seen: p.t, pve: p.pve ? 1 : 0 })),
    ...npcs.map((x) => ({ id: x.id, n: x.n, tag: x.tag, home: x.home, pts: x.pts, npc: 1, type: x.type }))]
    .map((x: any) => ({ ...x, tot: (x.pts.b || 0) + (x.pts.t || 0) + (x.pts.f || 0) + (x.pts.d || 0) }))
    .sort((a, b) => b.tot - a.tot);
  ranking.forEach((x: any, i) => { x.rank = i + 1; x.prev = snap.get(x.id) ?? null; });
  return { t, speed: CFG.speed, epoch: CFG.epoch, version: VERSION, players, npcs, ranking, allyNames, reserved:NPCS.filter(x=>t<x.join).map(x=>x.home) };
}

// ---------- Hilfen Stufe 2/3 ----------
async function event(name_l: string, data: unknown) { must(await db.from("ge_event").insert({ name_l, data })); }
async function chatSys(ch: string, txt: string) { must(await db.from("ge_chat").insert({ ch, name: "System", txt, t: Date.now() })); }
async function gzip(txt: string) { const buf = new Uint8Array(await new Response(new Blob([new TextEncoder().encode(txt)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(bin); }
// Review F23: Eingabegrenzen – JSON-Aktion max. 64 KiB (Spielstand eigene Grenze), dekomprimierter Snapshot max. 2 MiB
async function jbody(req:Request,max=ACTION_MAX){if(!req.body)return{};const reader=req.body.getReader(),decoder=new TextDecoder();let size=0,text='';try{for(;;){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw new Error('Anfrage zu groß');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}return text?JSON.parse(text):{};}

async function loadSave(l: string): Promise<any | null> { const s = must(await db.from("ge_save").select("z,t").eq("name_l", l).maybeSingle()) as any; if (!s) return null; try { return JSON.parse(await gunzip(s.z)); } catch (_e) { return null; } }
const capLv = (id: string, lv: number) => Math.min(+lv || 0, E.bCapLv(id));
async function gunzip(b64: string) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const reader=new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();const chunks:Uint8Array[]=[];let size=0;try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>SNAP_MAX)throw new Error("Spielstand zu groß (max. 2 MiB)");chunks.push(value);}}finally{await reader.cancel();}const out=new Uint8Array(size);let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return new TextDecoder().decode(out); }
// v41 Chat: Säubern, Längen-Limit, Rate-Limit (DB-basiert, gilt über alle Instanzen)
async function record(l:string){return must(await db.from("ge_save").select("z,t,rev").eq("name_l",l).single()) as any;}
async function contextFor(l:string){const events:any={},results:any={},gifts:any={},fleet:any={};
 for(const e of must(await db.from("ge_event").select("id,data").eq("name_l",l)) as any[])events[e.data.key||e.id]=e.data;
 for(const f of must(await db.from("ge_fleet").select("id,cid,data,status,result,arrive").eq("from_l",l)) as any[]){fleet[f.cid]=f;if(f.status==='done')results[f.id]=f.result;}
 for(const g of must(await db.from("ge_gift").select("id,dm").eq("name_l",l).not("claimed","is",null)) as any[])gifts[g.id]=g.dm;
 const acctRows=must(await db.from('ge_acct').select('name_l,name,home,created')) as any[];const slots:any={};for(const a of acctRows)if(a.name_l!==l)slots[a.home.join(':')]={kind:'player',real:1,player:a.name,prot:Date.now()<protEnd(a.created,null)};for(const p of must(await db.from("ge_pub").select("name_l,data")) as any[])if(p.name_l!==l)for(const q of p.data.planets||[])if(!q.moon)slots[`${q.g}:${q.s}:${q.p}`]={kind:'player',real:1,player:p.data.name,prot:Date.now()<protEnd(acctRows.find(a=>a.name_l===p.name_l)?.created||0,p.data.tutEnd)};
 for(const n of NPCS)slots[n.home.join(':')]=Date.now()>=n.join?{kind:'player',npcid:n.id,npcp:n.type,player:n.n}:{kind:'reserved',npcid:'reserved'};
 const incoming=must(await db.from('ge_fleet').select('*').eq('to_l',l).eq('status','out')) as any[];const debris:any={};for(const d of must(await db.from('ge_debris').select('*')) as any[])debris[d.coord]=d.data;
 const npcBefore=await meta('npcworld');return{events,results,gifts,fleet,slots,debris,incoming,gal:(await meta('gal:'+l))||{},npc:npcBefore||{},npcBefore};
}
function hydrate(st:any,ctx:any){st.debris=JSON.parse(JSON.stringify(ctx.debris));st.npc=JSON.parse(JSON.stringify(ctx.npc));for(const f of st.fleets||[]){const r=ctx.fleet[f.id];if(r){f.pvp=f.pvp||{};f.pvp.sid=r.id;}}return st;}
function publication(st:any,a:any,old:any){const E=(globalThis as any).ENGINE.fork();E.load(st);const pts=E.calcPoints(st);let df=0;for(const id of st.order)for(const [k,n]of Object.entries(st.planets[id].def||{})){const c=GE.DEF[k].c;df+=(n as number)*(c[0]+c[1]+c[2])/1000;}const ps=st.order.map((i:string)=>st.planets[i]);
 return{name:a.name,home:a.home,tag:old?.tag||null,ally:old?.ally||null,pts:{b:pts.b,t:pts.t,f:Math.max(0,pts.f-Math.floor(df)),d:Math.floor(df)},planets:ps.map((p:any)=>({g:p.g,s:p.s,p:p.p,name:p.name,type:p.type,moon:!!p.moon})),snap:ps.filter((p:any)=>!p.moon).map((p:any)=>({g:p.g,s:p.s,p:p.p,r:p.r,ships:p.ships,def:p.def,core:p.core,radar:E.bEff(p,'radar')})),tech:{...st.tech},t:st.t,tutEnd:st.flags.tutEnd||null,prot:Date.now()<protEnd(a.created,st.flags.tutEnd),devMax:Math.max(old?.devMax||0,pts.dev),pve:!!st.flags.pveMode};}
async function stateWrite(a:any,prev:any,st:any){for(const id of st.order)for(const r of ['m','k','g'])if(!Number.isFinite(st.planets[id].r[r])||st.planets[id].r[r]<0||st.planets[id].r[r]>Number.MAX_SAFE_INTEGER)throw new Error('Unsicherer Rohstoffbestand');const old=(must(await db.from('ge_pub').select('data').eq('name_l',a.name_l).maybeSingle()) as any)?.data;return{name_l:a.name_l,base:prev.rev,z:await gzip(JSON.stringify(st)),t:st.t,positions:st.order.map((i:string)=>st.planets[i]).filter((p:any)=>!p.moon).map((p:any)=>`${p.g}:${p.s}:${p.p}`),pub:publication(st,a,old)};}
function debrisWrites(before:any,after:any){const out:any[]=[];for(const coord of new Set([...Object.keys(before),...Object.keys(after)])){if(JSON.stringify(before[coord]||null)!==JSON.stringify(after[coord]||null))out.push({coord,before:before[coord]||null,value:after[coord]||null});}return out;}
function clean(t: string) { return String(t || "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200); }
async function rateOk(name: string) { const since = Date.now() - 60e3; const rows = must(await db.from("ge_chat").select("t").eq("name", name).gt("t", since).order("t", { ascending: false }).limit(8)) as any[];
  if (rows.length && Date.now() - rows[0].t < 2500) return "Zu schnell – kurz warten"; if (rows.length >= 8) return "Zu viele Nachrichten – bitte 1 Minute warten"; return null; }
async function strength(names: string[]) { const out: Record<string, number> = {}; if (!names.length) return out;
  const rows = must(await db.from("ge_pub").select("data").in("name_l", [...new Set(names.map(norm))])) as any[];
  for (const r of rows) { const p = r.data.pts || {}; out[r.data.name] = Math.floor((p.b || 0) + (p.t || 0) + (p.f || 0) + (p.d || 0)); } return out; }
const dmCh = (x: string, y: string) => "dm:" + [norm(x), norm(y)].sort().join("|");
async function markRead(me: string, ch: string, id: number) { const k = "dmr:" + me; const v = ((await meta(k)) || {}) as Record<string, number>; if ((v[ch] || 0) >= id) return; v[ch] = id; must(await db.from("ge_meta").upsert({ k, v })); }
async function myAlly(name: string) { const rows = must(await db.from("ge_ally").select("*")) as any[]; return rows.find((r) => r.members.some((m: any) => m.n === name)) || null; }
async function personal(a: any) {
  const inc = must(await db.from("ge_fleet").select("id,mission,data,arrive,from_l").eq("to_l", a.name_l).eq("status", "out")) as any[];
  const myPub = (must(await db.from("ge_pub").select("data").eq("name_l", a.name_l).maybeSingle()) as any)?.data || {};
  // Review V2 Radar: Warnung immer (ohne Radar nur grobe Zeit), L1 präzise Ankunft, L2 Mission, L3 grobe Anzahl, L4 Klassen, L5 Anzahl soweit der Spionagevergleich es erlaubt
  const radarAt = (to: any) => { const sn = (myPub.snap || []).find((q: any) => q.g === to?.g && q.s === to?.s && q.p === to?.p); return Math.min(5, +(sn?.radar) || 0); };
  const myEsp = +(myPub.tech?.espionage) || 0;
  const ev = must(await db.from("ge_event").select("id,data,created").eq("name_l", a.name_l).eq("acked", false).order("id").limit(50)) as any[];
  const al = await myAlly(a.name);
  return { incoming: inc.map((f) => { const lv = radarAt(f.data.to); const n = Object.values(f.data.ships || {}).reduce((x: number, y: any) => x + (+y || 0), 0) as number; const o: any = { id: f.id, to: f.data.to, radar: lv };
      o.arrive = lv >= 1 ? f.arrive : Math.ceil(f.arrive / 900e3) * 900e3; if (lv < 1) o.approx = 1; // Warnung immer; präzise Ankunft erst ab Radar 1
      if (lv >= 2) { o.mission = f.mission; o.from = f.data.from; } if (lv >= 3) o.nRough = n < 10 ? "<10" : n < 100 ? "10–99" : n < 1000 ? "100–999" : "≥1000";
      if (lv >= 4) o.classes = Object.keys(f.data.ships || {}); if (lv >= 5 && myEsp >= (+(f.data.esp) || 0)) { o.n = n; o.ships = f.data.ships; } return o; }),
    events: ev.map((e) => ({ id: e.id, ...e.data })), ally: al ? { tag: al.tag, name: al.name, founder: al.founder, descr: al.descr, members: al.members, apps: al.apps } : null };
}
async function resolveDue(f: { to_l: string }) { const rows = must(await db.from("ge_fleet").select("*").eq("to_l", f.to_l).or(`status.eq.out,and(status.eq.busy,busy_at.lt.${Date.now()-120000})`).lte("arrive", Date.now())) as any[]; for (const r of rows) await resolve(r); }
const val = (o: any, T: any) => { let v = 0; for (const k in o) { const d = T[k]; if (d) v += o[k] * (d.c[0] + d.c[1] + d.c[2]); } return v; };
function npcTarget(id: string) { // NPC-Spieler: Rohstoffe aus dem Wirtschaftsmodell, Flotte/Verteidigung aus ihren Punkten
  const x = NPCS.find((n) => n.id === id)!; const st = stateAt(x, Date.now(), CFG.speed, npcCache);
  const F = st.pts.f * 1000, D = st.pts.d * 1000; const ships: any = {}, def: any = {};
  const mixS = x.type === "aggressive" ? [["lf", .35], ["hf", .25], ["cr", .3], ["bs", .1]] : [["lf", .6], ["hf", .25], ["cr", .15]];
  for (const [k, w] of mixS as [string, number][]) { const c = GE.SHIP[k].c; const n = Math.floor(F * w / (c[0] + c[1] + c[2])); if (n > 0) ships[k] = n; }
  for (const [k, w] of [["rl", .5], ["ll", .35], ["hl", .15]] as [string, number][]) { const c = GE.DEF[k].c; const n = Math.floor((D + 4000) * w / (c[0] + c[1] + c[2])); if (n > 0) def[k] = n; }
  const tl = Math.floor(st.L.l * 0.8); return { x, st, r: { m: st.m, k: st.k, g: st.g }, ships, def, tl, tech: { weapons: tl, shielding: tl, armour: tl, espionage: Math.floor(st.L.l / 2) } };
}
async function patchPlanets(l: string, to: any) { const p = must(await db.from("ge_pub").select("data").eq("name_l", l).single()) as any; const pl = p.data.planets || (p.data.planets = []);
  if (!pl.some((q: any) => q.moon && q.g === to.g && q.s === to.s && q.p === to.p)) { pl.push({ g: to.g, s: to.s, p: to.p, name: "Mond", type: "moon", moon: true }); must(await db.from("ge_pub").update({ data: p.data }).eq("name_l", l)); } }
async function patchSnap(l: string, to: any, fn: (sn: any) => void) { const p = must(await db.from("ge_pub").select("data").eq("name_l", l).single()) as any; const sn = (p.data.snap || []).find((q: any) => q.g === to.g && q.s === to.s && q.p === to.p && !q.moon); if (!sn) return; sn.r = sn.r || {}; sn.ships = sn.ships || {}; sn.def = sn.def || {}; fn(sn); must(await db.from("ge_pub").update({ data: p.data }).eq("name_l", l)); }
// Progression v1: Punkte serverseitig aus dem zuletzt akzeptierten Spielstand; Anfängerschutz 7 Tage + max. 5× Entwicklungsabstand
const PROT_MS = 7 * 24 * 3600e3, DEV_RATIO = 5;
// Review V2: Schutzende = max(Erstellung + 7 Tage, min(Erstellung + 14 Tage, Grundtutorialende + 24 h)); kontobasiert
const protEnd = (created: number, tutEnd: number | null) => Math.max(created + PROT_MS, Math.min(created + 2 * PROT_MS, tutEnd ? tutEnd + 864e5 : Infinity));
async function savePoints(l: string) {const E=(globalThis as any).ENGINE.fork(); const s = must(await db.from("ge_save").select("z").eq("name_l", l).maybeSingle()) as any; if (!s) return null;
  try { const st = JSON.parse(await gunzip(s.z)); const d = E.devPoints(st); let f = 0, df = 0; const add = (o: any, T: any) => { let v = 0; for (const k in o || {}) { const u = T[k]; if (u) v += (+o[k] || 0) * (u.c[0] + u.c[1] + u.c[2]) / 1000; } return v; };
    for (const id of st.order || []) { const p = st.planets[id]; if (!p) continue; f += add(p.ships, GE.SHIP); df += add(p.def, GE.DEF); } for (const fl of st.fleets || []) if (!fl.npc) f += add(fl.ships, GE.SHIP);
    return { b: Math.floor(d.b), t: Math.floor(d.t), f: Math.floor(f), d: Math.floor(df) }; } catch (_e) { return null; } }
async function pvpBlock(fromL: string, toL: string): Promise<string | null> {
  const acc = must(await db.from("ge_acct").select("name_l,created").in("name_l", [fromL, toL])) as any[]; const now = Date.now();
  const A = acc.find((x) => x.name_l === fromL), B = acc.find((x) => x.name_l === toL); if (!A || !B) return "Ziel unbekannt";
  const pubs = must(await db.from("ge_pub").select("name_l,data").in("name_l", [fromL, toL])) as any[];
  const te = (l: string) => { const p = pubs.find((x) => x.name_l === l); return p?.data?.tutEnd ? +p.data.tutEnd : null; };
  if (now < protEnd(+A.created || 0, te(fromL))) return "Du stehst noch unter Anfängerschutz – keine Angriffe/Spionage auf Spieler";
  if (now < protEnd(+B.created || 0, te(toL))) return "Ziel steht unter Anfängerschutz";
  const dv = (l: string) => { const p = pubs.find((x) => x.name_l === l); return Math.max(1, +(p?.data?.devMax) || 0); };
  const a = dv(fromL), b = dv(toL); if (Math.max(a, b) / Math.min(a, b) > DEV_RATIO) return "Entwicklungsabstand zu groß (max. 5×)";
  return null; }
function stableRandom(seed:number){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
async function resolve(row:any):Promise<any>{
 const lease=Date.now();const claimed=must(await db.from('ge_fleet').update({status:'busy',busy_at:lease}).eq('id',row.id).or(`status.eq.out,and(status.eq.busy,busy_at.lt.${lease-120000})`).select('*')) as any[];
 if(!claimed.length){const r=must(await db.from('ge_fleet').select('result,status').eq('id',row.id).single()) as any;return r.result;}row=claimed[0];
 for(let attempt=0;attempt<4;attempt++){
  const ar=await record(row.from_l),ac=await contextFor(row.from_l);let as=JSON.parse(await gunzip(ar.z));hydrate(as,ac);
  const A=(globalThis as any).makeRuntime(as,ac);as=A.state();const resolveAt=Date.now();A.clock=()=>resolveAt;const attacker=must(await db.from('ge_acct').select('*').eq('name_l',row.from_l).single()) as any;
  const af=as.fleets.find((f:any)=>String(f.id)===String(row.cid));if(!af)throw new Error('Bestätigte Flotte fehlt');af.pvp=af.pvp||{};af.pvp.sid=row.id;
  let D:any=null,ds:any=null,dr:any=null,dc:any=null,defender:any=null,dp:any=null,def:any=null,defName='',botBefore:any=null,botKey='';const metaWrites:any[]=[],events:any[]=[];let result:any;
  if(row.to_l){dr=await record(row.to_l);ds=JSON.parse(await gunzip(dr.z));dc=await contextFor(row.to_l);hydrate(ds,dc);D=(globalThis as any).makeRuntime(ds,dc);ds=D.state();D.clock=()=>A.now();(globalThis as any).advanceRuntimes([A,D],A.now());defender=must(await db.from('ge_acct').select('*').eq('name_l',row.to_l).single()) as any;dp=ds.order.map((i:string)=>ds.planets[i]).find((p:any)=>p.g===row.data.to.g&&p.s===row.data.to.s&&p.p===row.data.to.p&&!p.moon);if(!dp)throw new Error('Ziel fehlt');def={r:dp.r,ships:dp.ships,def:dp.def,tech:ds.tech,bonus:D.combatBonus(dp),eng:D.cmdActive('engineer')};defName=defender.name;}
  else{A.tick();const T:any=npcTarget(row.to_npc);botKey='bot:'+row.to_npc;botBefore=await meta(botKey);const bot=JSON.parse(JSON.stringify(botBefore||{r:T.r,ships:T.ships,def:T.def,full:{r:T.r,ships:T.ships,def:T.def},t:A.now()}));
   // Persistent, prepaid one-unit rebuilding with real elapsed yard time.
   const grow=(t:number)=>{const dt=Math.max(0,t-bot.t)/(12*3600e3/CFG.speed);for(const r of ['m','k','g'])bot.r[r]=Math.min(T.r[r],bot.r[r]+T.r[r]*dt);bot.t=t;};
   const queue=(t:number)=>{for(const kind of ['ships','def'])for(const [id,n]of Object.entries(T[kind]))if((bot[kind][id]||0)<(n as number)){const c=(GE.SHIP[id]||GE.DEF[id]).c;if(!['m','k','g'].every((r,i)=>bot.r[r]>=c[i]))continue;['m','k','g'].forEach((r,i)=>bot.r[r]-=c[i]);bot.q={kind,id,end:t+A.uTime({b:{shipyard:Math.max(2,T.st.L.l)}},kind==='def'?'def':'ship',id)*1000};return;}};
   let guard=0;while(bot.q&&bot.q.end<=A.now()&&guard++<100000){const q=bot.q;grow(q.end);bot[q.kind][q.id]=(bot[q.kind][q.id]||0)+1;delete bot.q;queue(q.end);}grow(A.now());if(!bot.q)queue(A.now());def={...bot,tech:T.tech};defName=T.x.n;
  }
  let blocked:string|null=null;if(row.to_l&&row.mission!=='transport')blocked=await pvpBlock(row.from_l,row.to_l);
  const key='fleet:'+row.id+':'+(row.to_l||row.to_npc),d=row.data;
  // Stable per-mission randomness survives lease expiry and transaction retries.
  const seed=parseInt((await sha('battle:'+row.id+':'+JSON.stringify(d))).slice(0,8),16),rng=stableRandom(seed);A.rng=rng;if(D)D.rng=rng;
  if(blocked)result={kind:'fail',msg:blocked};
  else if(row.mission==='transport'){const ev={key,kind:'transport',from:d.from,to:d.to,res:d.cargo};D.externalEvents[key]=ev;D.receiveEvent(key);events.push({name_l:row.to_l,key,data:ev});result={kind:'transport',defName,to:d.to,delivered:d.cargo};}
  else if(row.mission==='spy'){const n=d.ships.pr||0,esp=(def.tech.espionage||0)+(D&&D.cmdActive('technocrat')?2:0),score=n+2*((d.esp||0)-esp),spy:any={target:{...d.to,name:defName,kind:'player',player:defName},score,r:{...def.r}};
   if(score>=2)spy.ships={...def.ships};if(score>=3)spy.def={...def.def};if(score>=5)spy.tech={...def.tech};const enemy=Object.values(def.ships).reduce((a:number,n:any)=>a+n,0) as number,ch=Math.min(.8,enemy*.02/Math.max(1,n)*Math.max(.3,1-.1*((d.esp||0)-esp)));spy.counter=Math.round(ch*100);spy.lost=rng()<ch;result={kind:'spy',spy,lostProbes:spy.lost};}
  else{const B=A.simulate({units:d.ships,tech:d.tech,bonus:d.bonus},{units:{...def.ships,...def.def},tech:def.tech,bonus:def.bonus},{raw:true});
   const rebuilt=A.rebuildDef(B.lossD,def.eng),sp=A.splitUnits(B.endD),loot=B.winner==='a'?A.lootCalc(def.r,Math.max(0,A.cargoCap(B.endA)-(d.cargo.m+d.cargo.k+d.cargo.g))):{m:0,k:0,g:0};
   if(row.to_npc){const left=A.npcLeft(),pv=A.pve();for(const r of ['m','k','g']){loot[r]=Math.min(loot[r],left[r]);pv.npc[r]+=loot[r];}}
   const lossShips:any={},lossDef:any={};for(const k in B.lossD){if(GE.DEF[k])lossDef[k]=B.lossD[k]-(rebuilt[k]||0);else lossShips[k]=B.lossD[k];}
   let moon=false,galA=0,galD=0;let galWhy='';if(D){moon=!dp.moonId&&rng()*100<B.moonChance;const pk='galpair:'+ [row.from_l,row.to_l].sort().join('|'),pair=await meta(pk);
    if(!pair||A.now()-pair.t>=A.GAL.PAIR){const g=A.galRoll(B,moon,rng);galA=g.a;galD=g.d;if(galA){metaWrites.push({k:pk,before:pair,value:{t:A.now(),f:row.id}});for(const [l,k,n]of [[row.from_l,'a'+row.id,galA],[row.to_l,'d'+row.id,galD]]as any[]){const mk='gal:'+l,old=await meta(mk);metaWrites.push({k:mk,before:old,value:{...(old||{}),[k]:n}});}}}else galWhy='Paar-Sperre aktiv';}
   const extra={loot,rebuilt,coord:d.to,pvp:!!D,moon,galWhy},ba=A.packBattle(B,d.from,defName,{...extra,attackerIsMe:true,gal:galA}),bd=A.packBattle(B,d.from,defName,{...extra,attackerIsMe:false,gal:galD});
   if(D){const ev={key,kind:'attacked',from:d.from,to:d.to,lossShips,lossDef,loot,battle:bd,winner:B.winner,moon,gal:galD,galKey:'d'+row.id};D.externalEvents[key]=ev;D.receiveEvent(key);events.push({name_l:row.to_l,key,data:ev});}
   else{def.ships=sp.ships;def.def={...sp.def};for(const k in rebuilt)def.def[k]=(def.def[k]||0)+rebuilt[k];for(const r of ['m','k','g'])def.r[r]-=loot[r];delete def.tech;metaWrites.push({k:botKey,before:botBefore,value:def});}
   const coord=`${d.to.g}:${d.to.s}:${d.to.p}`;const deb=as.debris[coord]||(as.debris[coord]={m:0,k:0,nm:0,nk:0});deb.m+=B.debris.m;deb.k+=B.debris.k;if(row.to_npc)for(const [r,i]of [['m',0],['k',1]]as any[])for(const k in B.lossD)if(GE.SHIP[k])deb['n'+r]=(deb['n'+r]||0)+Math.round(B.lossD[k]*GE.SHIP[k].c[i]*.3);
   result={kind:'attack',endShips:B.endA,loot,battle:ba,debris:B.debris,winner:B.winner,defName,moon,gal:galA,galKey:'a'+row.id};
  }
  A.externalResults[row.id]=result;A.receiveFleet(af.id,row.id);if(D){ds.debris=JSON.parse(JSON.stringify(as.debris));ds.npc=JSON.parse(JSON.stringify(as.npc));}if(JSON.stringify(ac.npc)!==JSON.stringify(as.npc))metaWrites.push({k:'npcworld',before:ac.npcBefore,value:as.npc});const states=[await stateWrite(attacker,ar,as)];if(D)states.push(await stateWrite(defender,dr,ds));
  const tx=await db.rpc('ge_commit_game',{p_states:states,p_fleet:{id:row.id,status:'busy',lease,result},p_events:events,p_meta:metaWrites,p_debris:debrisWrites(ac.debris,as.debris)});
  if(!tx.error)return result;if(tx.error.code!=='40001')throw new Error(tx.error.message);
 }
 throw new Error('Gleichzeitiger Kampf – später erneut versuchen');
}

Deno.serve(async (req) => {const E=(globalThis as any).ENGINE.fork();
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const P = new URL(req.url).pathname.replace(/^.*?\/api\//, "/api/");
  try {
    if (P === "/api/health") return J({ ok: true, service: "ge-supabase", version: VERSION, speed: CFG.speed, lastTick: await meta("snapT") });
    if (P === "/api/tick") { // stündlich per pg_cron: Rang-Schnappschuss
      const due=must(await db.from('ge_fleet').select('*').or(`status.eq.out,and(status.eq.busy,busy_at.lt.${Date.now()-120000})`).lte('arrive',Date.now()).limit(50)) as any[];for(const f of due)await resolve(f);
      const u = await universe(); must(await db.from("ge_meta").upsert([{ k: "snap", v: u.ranking.map((x: any) => [x.id, x.tot]) }, { k: "snapT", v: u.t }]));
      return J({ ok: true, n: u.ranking.length });
    }
    if (P === "/api/register" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const n = norm(b.name);
      if (!/^[a-z0-9äöüß_.\- ]{3,16}$/i.test(b.name || "")) return err("Name: 3–16 Zeichen (Buchstaben, Zahlen, _ . -)");
      if (!/^\d{4,8}$/.test(String(b.pin || ""))) return err("PIN: 4–8 Ziffern");
      if (String(b.invite || "").trim().toUpperCase() !== CFG.invite.toUpperCase()) return err("Einladungscode ungültig", 403);
      if (NPCS.some((x) => norm(x.n) === n)) return err("Name bereits vergeben", 409);
      const salt = tokenNew(); const a = { name_l: n, name: String(b.name).trim(), salt, hash: await pbkdf2(salt, String(b.pin)), token: tokenNew(), token_t: Date.now(), home: await freeHome(), created: Date.now() };
      const st=E.newGame({speed:CFG.speed,seed:CFG.seed}),hp=st.planets[st.home];hp.g=a.home[0];hp.s=a.home[1];hp.p=a.home[2];hp.temp=40;st.created=a.created;st.t=a.created;st.cmdName=a.name;st.mp=1;st.srv=1;st.rand=crypto.getRandomValues(new Uint32Array(1))[0];
      const r=await db.rpc('ge_register_game',{p_account:a,p_z:await gzip(JSON.stringify(st)),p_t:st.t});if(r.error)return err(r.error.code==='23505'?'Name oder Heimatposition bereits vergeben':r.error.message,409);
      return J({ token: a.token, ...pubAcct(a), hasSave: true });
    }
    if (P === "/api/login" && req.method === "POST") {
      const b = await jbody(req); const nl = norm(b.name); const fs = await failState(nl); const lk = lockedFor(fs);
      if (lk > 0) return err(`Zu viele Fehlversuche – bitte ${Math.ceil(lk / 60e3)} Minuten warten`, 429);
      if(!must(await db.rpc('ge_login_attempt',{p_name:nl,p_t:Date.now()})))return err('Zu viele Anmeldeversuche – bitte später erneut versuchen',429);
      const a = must(await db.from("ge_acct").select("*").eq("name_l", nl).maybeSingle()) as any;
      if (!a || !(await pinOk(a, String(b.pin || "")))) { return err("Name oder PIN falsch", 401); }
      { const up: any = { token_t: Date.now() }; if (!String(a.hash).startsWith("pbkdf2$")) up.hash = await pbkdf2(a.salt, String(b.pin)); if (a.token_t && Date.now() - +a.token_t > TOKEN_MS) { up.token = tokenNew(); a.token = up.token; }
        must(await db.from("ge_acct").update(up).eq("name_l", a.name_l)); must(await db.from("ge_meta").delete().eq("k", "lf:" + nl)); }
      const s = must(await db.from("ge_save").select("t").eq("name_l", a.name_l).maybeSingle()) as any;
      return J({ token: a.token, ...pubAcct(a), hasSave: !!s, saveT: s?.t ?? null });
    }
    if (P === "/api/universe") return J(await universe());
    // Admin: Geschenk anlegen (nur mit GE_ADMIN_KEY)
    if (P === "/api/admin/gift" && req.method === "POST") {
      const key = Deno.env.get("GE_ADMIN_KEY") || ""; if (!key || req.headers.get("x-ge-admin") !== key) return err("Kein Zugriff", 403);
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const n = norm(b.name); const acct = must(await db.from("ge_acct").select("name_l").eq("name_l", n).maybeSingle()); if (!acct) return err("Konto unbekannt", 404);
      const dm = Math.max(0, Math.min(100000, Math.floor(+b.dm || 0))); const r = must(await db.from("ge_gift").insert({ name_l: n, dm, msg: String(b.msg || "").slice(0, 300), sender: String(b.sender || "Admin").slice(0, 40), created: Date.now() }).select("id").single()) as any;
      return J({ ok: true, id: r.id });
    }
    const a = await auth(req); if (!a) return err("Nicht angemeldet", 401);
    if (P === "/api/me") { const s = must(await db.from("ge_save").select("t").eq("name_l", a.name_l).maybeSingle()) as any; return J({ ...pubAcct(a), hasSave: !!s, saveT: s?.t ?? null }); }
    if (P === "/api/gifts") { const rows = must(await db.from("ge_gift").select("id,dm,msg,sender,created,claimed").eq("name_l", a.name_l).order("id")) as any[]; return J({ gifts: rows }); }
    if (P === "/api/gift/claim" && req.method === "POST") { const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const id = +b.id;
      const g = must(await db.from("ge_gift").select("id,dm,claimed").eq("id", id).eq("name_l", a.name_l).maybeSingle()) as any; if (!g) return err("Geschenk unbekannt", 404);
      const up = must(await db.from("ge_gift").update({ claimed: Date.now() }).eq("id", id).eq("name_l", a.name_l).is("claimed", null).select("id")) as any[];
      return J({ ok: true, id, dm: g.dm, first: up.length > 0 }); }
    if (P === "/api/save" && req.method === "GET") { const s = must(await db.from("ge_save").select("z,t,rev").eq("name_l", a.name_l).maybeSingle()) as any; return s ? J(s) : err("Kein Spielstand", 404); }
    if(P==='/api/save'&&req.method==='POST'){
      await resolveDue({to_l:a.name_l});
      const b=await jbody(req,6_000_000);if((+b.cv||0)<60)return J({error:'Neue App-Version erforderlich',code:'reject'},409);
      if(typeof b.z!=='string'||b.z.length>5_000_000)return err('Ungültiger Spielstand');
      let nx:any;try{nx=JSON.parse(await gunzip(b.z));}catch(_){return err('Spielstand unlesbar');}
      const prev=await record(a.name_l);if(!Number.isSafeInteger(b.base)||b.base!==prev.rev)return J({error:'Spielstand veraltet',code:'reject'},409);
      const st=JSON.parse(await gunzip(prev.z)),ctx=await contextFor(a.name_l);const membership=await myAlly(a.name);st.ally=membership?{name:membership.name,tag:membership.tag,mp:1}:null;if((nx.rid||null)!==(st.rid||null))return J({error:'Andere Konto-Version',code:'reject'},409);
      const actions=b.actions||[];if(!Array.isArray(actions)||actions.length>1000||actions.some((x:any)=>!x||!Number.isSafeInteger(x.seq)||!Number.isFinite(x.t)))return J({error:'Ungültige Aktionsliste',code:'reject'},409);const maxT=Math.max(st.t,+nx.t||0,...actions.map((x:any)=>+x.t||0));if(maxT>Date.now()+5000)return J({error:'Spielstand aus der Zukunft',code:'reject'},409);
      const originalNpc=ctx.npc;hydrate(st,ctx);st.speed=CFG.speed;st.created=a.created;st.cmdName=a.name;st.mp=1;
      // These flags are UI acknowledgements, never acquisition assertions.
      for(const k of ['rankSeen','galinfo','named','exported'])if(nx.flags?.[k])st.flags[k]=1;if(st.camp&&nx.camp)st.camp.skip=nx.camp.skip?1:0;
      let next:any;try{next=(globalThis as any).commandState(st,actions,maxT,ctx);}catch(e){return J({error:'Aktion abgelehnt: '+(e as Error).message,code:'reject'},409);}
      const write=await stateWrite(a,prev,next),metaWrites:any[]=[];if(JSON.stringify(originalNpc)!==JSON.stringify(next.npc))metaWrites.push({k:'npcworld',before:ctx.npcBefore,value:next.npc});
      const r=await db.rpc('ge_commit_game',{p_states:[write],p_fleet:actions.filter((x:any)=>x.type==='recall').map((x:any)=>ctx.fleet[x.args[0]]).filter((x:any)=>x&&x.status==='out').map((x:any)=>({id:x.id,status:'out',lease:null,nextStatus:'recalled'})),p_meta:metaWrites,p_debris:debrisWrites(ctx.debris,next.debris)});if(r.error)return J({error:'Gleichzeitige Aktion – aktueller Stand wird geladen',code:'reject'},409);
      return J({ok:true,z:write.z,t:next.t,rev:r.data[a.name_l],serverNow:Date.now()});
    }
    if(P==='/api/pub'&&req.method==='POST'){
      await resolveDue({to_l:a.name_l});const r=await record(a.name_l),st=JSON.parse(await gunzip(r.z));const old=(must(await db.from('ge_pub').select('data').eq('name_l',a.name_l).maybeSingle())as any)?.data;const pub=publication(st,a,old);const al=await myAlly(a.name);pub.tag=al?.tag||null;pub.ally=al?.name||null;
      must(await db.rpc('ge_publish',{p_name:a.name_l,p_base:r.rev,p_data:pub}));return J({...await universe(),...await personal(a),created:a.created});
    }
    // ---------- Stufe 2: Flotten zwischen Spielern / NPC-Spielern ----------
    if(P==='/api/fleet'&&req.method==='POST'){
      const b=await jbody(req),cid=String(b.cid||'');if(!/^\d{1,16}$/.test(cid))return err('Aktions-ID fehlt');
      const ex=must(await db.from('ge_fleet').select('id').eq('from_l',a.name_l).eq('cid',cid).maybeSingle()) as any;if(ex)return J({id:ex.id,dup:true});
      const prev=await record(a.name_l),st=JSON.parse(await gunzip(prev.z)),f=st.fleets.find((f:any)=>String(f.id)===cid&&!f.npc&&f.pvp&&['out','pvp'].includes(f.phase));if(!f||!['attack','spy','transport'].includes(f.mission))return err('Keine bestätigte Mission',403);
      const ctx=await contextFor(a.name_l),sl=ctx.slots[`${f.to.g}:${f.to.s}:${f.to.p}`];if(!sl)return err('Ziel nicht vorhanden');let to_l:any=null,to_npc:any=null;
      if(sl.real){to_l=norm(sl.player);if(f.mission!=='transport'){const b=await pvpBlock(a.name_l,to_l);if(b)return err(b,403);}}else{to_npc=sl.npcid;if(f.mission==='transport')return err('Transport nur zu Spielern');}
      const runtime=(globalThis as any).makeRuntime(st,ctx),pl=st.planets[f.from];
      const data={from:a.name,fromC:f.fromC,to:f.to,ships:f.ships,cargo:f.cargo,tech:runtime.techOf(),esp:(st.tech.espionage||0)+(runtime.cmdActive('technocrat')?2:0),depart:f.depart,cid,pct:f.pct,dur:f.dur,bonus:f.bonus||runtime.combatBonus(pl)};
      const r=await db.rpc('ge_start_fleet',{p_name:a.name_l,p_base:prev.rev,p_cid:cid,p_target:to_l,p_npc:to_npc,p_mission:f.mission,p_data:data,p_arrive:Math.round(f.depart+f.dur)});if(r.error)return err('Mission konnte nicht bestätigt werden: '+r.error.message,409);return J({id:r.data});
    }
    // Review V2 §7: friedliche Kernroute – 1 Stein je 7 reale Tage, frühestens nach 7 Kontotagen; Erfüllung aus dem akzeptierten Spielstand
    if(P==='/api/gal/peace'&&req.method==='POST'){
      const now=Date.now(),st=await loadSave(a.name_l);if(!st)return err('Kein Spielstand');E.load(st);
      const pk='peace:'+a.name_l,pmRaw=await meta(pk),pm=pmRaw||{n:0,last:0},gk='gal:'+a.name_l,gvRaw=await meta(gk),gv={...(gvRaw||{})};
      const outstanding='p'+((st.peace?.n||0)+1);if(pm.n>(st.peace?.n||0)&&gv[outstanding]===1)return J({key:outstanding,n:1});
      if(now-a.created<E.GAL.PEACE_MS||now-(pm.last||0)<E.GAL.PEACE_MS)return err('Höchstens 1 Stein je 7 Tage, erster nach Tag 7',403);
      if(!E.peaceInfo().done)return err('Projekt noch nicht erfüllt',409);const key='p'+(pm.n+1);gv[key]=1;
      const tx=await db.rpc('ge_commit_game',{p_meta:[{k:gk,before:gvRaw,value:gv},{k:pk,before:pmRaw,value:{n:pm.n+1,last:now}}]});if(tx.error)return err('Gleichzeitiger Anspruch – erneut abrufen',409);return J({key,n:1});
    }
    if (P === "/api/fleet/resolve" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const row = must(await db.from("ge_fleet").select("*").eq("id", +b.id).eq("from_l", a.name_l).maybeSingle()) as any;
      if (!row) return err("Flotte unbekannt", 404);
      if(row.status==="done")return J({result:row.result,save:await record(a.name_l)});
      if (Date.now() < row.arrive) return J({ wait: row.arrive - Date.now() });
      const res=await resolve(row);return J({result:res,save:await record(a.name_l)});
    }
    if(P==='/api/fleet/recall')return err('Rückruf über bestätigte Spielaktion',409);
    if (P === "/api/ack" && req.method === "POST") { const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const ids = (b.ids || []).map((x: any) => +x).filter((x: number) => x > 0); if (ids.length) must(await db.from("ge_event").update({ acked: true }).in("id", ids).eq("name_l", a.name_l)); return J({ ok: true }); }
    // ---------- Stufe 3: Allianzen + Chat ----------
    if (P === "/api/ally/list") return J({ allies: must(await db.from("ge_ally").select("tag,name,founder,descr,members,apps,created")) });
    if (P === "/api/ally/create" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const tag = String(b.tag || "").trim().toUpperCase(); const name = String(b.name || "").trim();
      if (!/^[A-Z0-9]{2,5}$/.test(tag) || name.length < 3 || name.length > 30) return err("Name (3–30) und Kürzel (2–5 Buchstaben/Ziffern) angeben");
      if (await myAlly(a.name)) return err("Du bist bereits in einer Allianz");
      const r = await db.from("ge_ally").insert({ tag, name, founder: a.name, descr: String(b.descr || "").slice(0, 300), members: [{ n: a.name, rank: "founder", t: Date.now() }], apps: [], created: Date.now() });
      if (r.error) return err(r.error.code === "23505" ? "Kürzel vergeben" : r.error.message, 409);
      await chatSys("ally:" + tag, `${a.name} hat die Allianz gegründet.`); return J({ ok: true, tag });
    }
    if (P === "/api/ally/apply" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const al = must(await db.from("ge_ally").select("*").eq("tag", String(b.tag).toUpperCase()).maybeSingle()) as any; if (!al) return err("Allianz unbekannt");
      if (await myAlly(a.name)) return err("Du bist bereits in einer Allianz");
      const apps = (al.apps || []).filter((x: any) => x.n !== a.name).concat([{ n: a.name, msg: String(b.msg || "").slice(0, 200), t: Date.now() }]);
      must(await db.from("ge_ally").update({ apps }).eq("tag", al.tag));
      for (const m of al.members) if (m.rank === "founder" || m.rank === "officer") await event(norm(m.n), { kind: "allyapp", tag: al.tag, from: a.name, msg: String(b.msg || "").slice(0, 200) });
      return J({ ok: true });
    }
    if (P === "/api/ally/decide" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const al = await myAlly(a.name); if (!al) return err("Keine Allianz");
      const me = al.members.find((m: any) => m.n === a.name); if (!me || !["founder", "officer"].includes(me.rank)) return err("Keine Berechtigung", 403);
      const ap = (al.apps || []).find((x: any) => x.n === b.name); if (!ap) return err("Bewerbung nicht gefunden");
      const apps = al.apps.filter((x: any) => x.n !== b.name); let members = al.members;
      if (b.accept) { if (await myAlly(b.name)) return err("Spieler ist schon in einer Allianz"); members = members.concat([{ n: b.name, rank: "member", t: Date.now() }]); }
      must(await db.from("ge_ally").update({ apps, members }).eq("tag", al.tag));
      await event(norm(b.name), { kind: "allydecision", tag: al.tag, name: al.name, accept: !!b.accept });
      if (b.accept) await chatSys("ally:" + al.tag, `${b.name} ist der Allianz beigetreten.`);
      return J({ ok: true });
    }
    if (P === "/api/ally/rank" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const al = await myAlly(a.name); if (!al || al.founder !== a.name) return err("Nur der Gründer", 403);
      const members = al.members.map((m: any) => m.n === b.name && m.rank !== "founder" ? { ...m, rank: b.rank === "officer" ? "officer" : "member" } : m);
      must(await db.from("ge_ally").update({ members }).eq("tag", al.tag)); return J({ ok: true });
    }
    if (P === "/api/ally/kick" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const al = await myAlly(a.name); const me = al && al.members.find((m: any) => m.n === a.name);
      if (!me || !["founder", "officer"].includes(me.rank) || b.name === al.founder) return err("Keine Berechtigung", 403);
      must(await db.from("ge_ally").update({ members: al.members.filter((m: any) => m.n !== b.name) }).eq("tag", al.tag));
      await event(norm(b.name), { kind: "allykick", tag: al.tag }); await chatSys("ally:" + al.tag, `${b.name} wurde aus der Allianz entfernt.`); return J({ ok: true });
    }
    if (P === "/api/ally/leave" && req.method === "POST") {
      const al = await myAlly(a.name); if (!al) return err("Keine Allianz");
      const members = al.members.filter((m: any) => m.n !== a.name);
      if (!members.length) must(await db.from("ge_ally").delete().eq("tag", al.tag));
      else { if (al.founder === a.name) { members.sort((x: any, y: any) => (x.rank === "officer" ? -1 : 0) - (y.rank === "officer" ? -1 : 0)); members[0].rank = "founder"; }
        must(await db.from("ge_ally").update({ members, founder: members.find((m: any) => m.rank === "founder").n }).eq("tag", al.tag)); await chatSys("ally:" + al.tag, `${a.name} hat die Allianz verlassen.`); }
      return J({ ok: true });
    }
    if (P === "/api/ally/descr" && req.method === "POST") { const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const al = await myAlly(a.name); if (!al || al.founder !== a.name) return err("Nur der Gründer", 403); must(await db.from("ge_ally").update({ descr: String(b.descr || "").slice(0, 300) }).eq("tag", al.tag)); return J({ ok: true }); }
    if (P === "/api/chat" && req.method === "GET") {
      const u = new URL(req.url); const ch = u.searchParams.get("ch") || "global"; const since = +(u.searchParams.get("since") || 0);
      if (ch.startsWith("ally:")) { const al = await myAlly(a.name); if (!al || "ally:" + al.tag !== ch) return err("Kein Zugriff", 403); } else if (ch !== "global") return err("Kein Zugriff", 403);
      const rows = must(await db.from("ge_chat").select("id,name,txt,t").eq("ch", ch).gt("id", since).order("id", { ascending: false }).limit(60)) as any[];
      const msgs = rows.reverse(); return J({ msgs, pw: await strength(msgs.map((m: any) => m.name).filter((n: string) => n !== "System")) });
    }
    if (P === "/api/chat" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const ch = String(b.ch || "global"); const txt = clean(b.txt); if (!txt) return err("Leer");
      { const rl = await rateOk(a.name); if (rl) return err(rl, 429); }
      if (ch.startsWith("ally:")) { const al = await myAlly(a.name); if (!al || "ally:" + al.tag !== ch) return err("Kein Zugriff", 403); } else if (ch !== "global") return err("Kanal unbekannt");
      must(await db.from("ge_chat").insert({ ch, name: a.name, txt, t: Date.now() })); return J({ ok: true });
    }
    // ---------- v41: Privatchat (nur echte Spieler; Bots/NPC können weder empfangen noch antworten) ----------
    if (P === "/api/dm" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const to = norm(b.to); const txt = clean(b.txt); if (!txt) return err("Leer"); if (to === a.name_l) return err("Nicht an dich selbst");
      const r = must(await db.from("ge_acct").select("name").eq("name_l", to).maybeSingle()) as any; if (!r) return err("Dieser Spieler ist ein Bot und kann keine Nachrichten empfangen", 404);
      { const rl = await rateOk(a.name); if (rl) return err(rl, 429); }
      const row = must(await db.from("ge_chat").insert({ ch: dmCh(a.name, r.name), name: a.name, txt, t: Date.now() }).select("id").single()) as any;
      await markRead(a.name_l, dmCh(a.name, r.name), row.id); return J({ ok: true, id: row.id });
    }
    if (P === "/api/dm" && req.method === "GET") {
      const u = new URL(req.url); const w = norm(u.searchParams.get("with") || ""); const since = +(u.searchParams.get("since") || 0);
      const r = must(await db.from("ge_acct").select("name").eq("name_l", w).maybeSingle()) as any; if (!r) return J({ msgs: [], bot: true });
      const ch = dmCh(a.name, r.name); const rows = (must(await db.from("ge_chat").select("id,name,txt,t").eq("ch", ch).gt("id", since).order("id", { ascending: false }).limit(80)) as any[]).reverse();
      if (rows.length) await markRead(a.name_l, ch, rows[rows.length - 1].id); return J({ msgs: rows, name: r.name });
    }
    if (P === "/api/inbox") {
      const me = a.name_l; const q = async (pat: string) => must(await db.from("ge_chat").select("id,ch,name,txt,t").like("ch", pat).order("id", { ascending: false }).limit(300)) as any[];
      const esc = (x: string) => x.replace(/[%_\\]/g, (c) => "\\" + c); const rows = [...await q(`dm:${esc(me)}|%`), ...await q(`dm:%|${esc(me)}`)].filter((m) => m.ch.slice(3).split("|").includes(me)).sort((x, y) => y.id - x.id);
      const rd = ((await meta("dmr:" + me)) || {}) as Record<string, number>; const conv = new Map<string, any>();
      for (const m of rows) { const other = m.ch.slice(3).split("|").find((x: string) => x !== me) || me; let c = conv.get(other); if (!c) { c = { with_l: other, last: { name: m.name, txt: m.txt, t: m.t }, unread: 0 }; conv.set(other, c); }
        if (m.id > (rd[m.ch] || 0) && norm(m.name) !== me) c.unread++; }
      const list = [...conv.values()]; const names = must(await db.from("ge_acct").select("name,name_l").in("name_l", list.map((c) => c.with_l).concat([""]))) as any[];
      for (const c of list) c.with = (names.find((n) => n.name_l === c.with_l) || {}).name || c.with_l;
      const pw = await strength(list.map((c) => c.with)); for (const c of list) c.pw = pw[c.with] || 0;
      return J({ convs: list, unread: list.reduce((x, c) => x + c.unread, 0) });
    }
    if (P === "/api/profile") {
      const n = norm(new URL(req.url).searchParams.get("name") || ""); const acct = must(await db.from("ge_acct").select("name,home,created").eq("name_l", n).maybeSingle()) as any;
      if (!acct) { const npc = NPCS.find((x: any) => norm(x.n) === n); if (!npc) return err("Unbekannt", 404); const sm = summary(npc, stateAt(npc, Date.now(), CFG.speed, npcCache)) as any;
        return J({ name: sm.n, real: false, tag: sm.tag || null, home: sm.home, pts: sm.pts }); }
      const pub = must(await db.from("ge_pub").select("data").eq("name_l", n).maybeSingle()) as any; const d = pub ? pub.data : {};
      return J({ name: acct.name, real: true, tag: d.tag || null, ally: d.ally || null, home: d.home || acct.home, pts: d.pts || {}, planets: (d.planets || []).filter((p: any) => !p.moon).length, seen: d.t || null, since: acct.created });
    }
    return err("Unbekannt", 404);
  } catch (e) { return err("Serverfehler: " + (e as Error).message, 500); }
});
