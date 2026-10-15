// Galaxy Empire – Mehrspieler Stufe 1 als Supabase Edge Function (Postgres-Tabellen ge_*).
// Routen: /api/health, /api/register, /api/login, /api/universe, /api/me, /api/save (GET/POST), /api/pub, /api/tick
import { createClient } from "npm:@supabase/supabase-js@2";
import { makeNPCs, stateAt, summary, allyNames } from "./npc.js";
(globalThis as any).window = globalThis; await import("./data.js"); await import("./engine.js");
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
async function freeHome(): Promise<number[]> {
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
  return { t, speed: CFG.speed, epoch: CFG.epoch, version: VERSION, players, npcs, ranking, allyNames };
}

// ---------- Hilfen Stufe 2/3 ----------
async function event(name_l: string, data: unknown) { must(await db.from("ge_event").insert({ name_l, data })); }
async function chatSys(ch: string, txt: string) { must(await db.from("ge_chat").insert({ ch, name: "System", txt, t: Date.now() })); }
async function gzip(txt: string) { const buf = new Uint8Array(await new Response(new Blob([new TextEncoder().encode(txt)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(bin); }
// Review F23: Eingabegrenzen – JSON-Aktion max. 64 KiB (Spielstand eigene Grenze), dekomprimierter Snapshot max. 2 MiB
async function jbody(req: Request, max = ACTION_MAX) { const t = await req.text(); if (t.length > max) throw new Error("Anfrage zu groß"); return t ? JSON.parse(t) : {}; }
async function loadSave(l: string): Promise<any | null> { const s = must(await db.from("ge_save").select("z,t").eq("name_l", l).maybeSingle()) as any; if (!s) return null; try { return JSON.parse(await gunzip(s.z)); } catch (_e) { return null; } }
const capLv = (id: string, lv: number) => Math.min(+lv || 0, E.bCapLv(id));
async function gunzip(b64: string) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const out = await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); if (out.length > SNAP_MAX) throw new Error("Spielstand zu groß (max. 2 MiB)"); return out; }
// v41 Chat: Säubern, Längen-Limit, Rate-Limit (DB-basiert, gilt über alle Instanzen)
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
async function resolveDue(f: { to_l: string }) { const rows = must(await db.from("ge_fleet").select("*").eq("to_l", f.to_l).eq("status", "out").lte("arrive", Date.now())) as any[]; for (const r of rows) await resolve(r); }
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
async function savePoints(l: string) { const s = must(await db.from("ge_save").select("z").eq("name_l", l).maybeSingle()) as any; if (!s) return null;
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
async function resolve(row: any): Promise<any> {
  // Review A3: Lease statt endgültigem "busy" – ein abgebrochener Abschluss wird nach 2 Minuten erneut versucht
  const nowL = Date.now(); const claim = must(await db.from("ge_fleet").update({ status: "busy", busy_at: nowL }).eq("id", row.id).or(`status.eq.out,and(status.eq.busy,busy_at.lt.${nowL - 120000})`).select("id")) as any[];
  if (!claim.length) { const r = must(await db.from("ge_fleet").select("result,status").eq("id", row.id).single()) as any; return r.result; }
  const d = row.data; const to = d.to; let result: any;
  try {
    let def: any, defName = "", defL: string | null = null, defCore: string | null = null, defHasMoon = false;
    if (row.to_npc) { const T: any = npcTarget(row.to_npc);
      // Review V2: Serverbots erhalten persistente Verluste
      { const NL = ((await meta("npcloss")) || {})[row.to_npc] || {}; for (const k in NL.ships || {}) T.ships[k] = Math.max(0, (T.ships[k] || 0) - NL.ships[k]); for (const k in NL.def || {}) T.def[k] = Math.max(0, (T.def[k] || 0) - NL.def[k]); } const hits = ((await meta("npchits")) || {})[row.to_npc]; if (hits) { const f = Math.max(0, 1 - (Date.now() - hits.t) / (12 * 3600e3 / CFG.speed)); for (const r of ["m", "k", "g"]) T.r[r as "m"] = Math.max(0, T.r[r as "m"] - (hits[r] || 0) * f); } def = T; defName = T.x.n; }
    else { defL = row.to_l; const p = must(await db.from("ge_pub").select("data").eq("name_l", row.to_l).single()) as any; const sn = (p.data.snap || []).find((q: any) => q.g === to.g && q.s === to.s && q.p === to.p && !q.moon);
      if (!sn) throw new Error("Planet nicht mehr vorhanden"); def = { r: { ...sn.r }, ships: { ...sn.ships }, def: { ...sn.def }, tech: p.data.tech || {} }; defName = p.data.name; defCore = sn.core || null;
      // Review F18/F20: Verteidiger-Bonus aus dem akzeptierten Spielstand (Kern, Pionier, Items), Ingenieur für den Wiederaufbau
      try { const dst = await loadSave(row.to_l); if (dst) { E.load(dst); const dp = dst.order.map((i: string) => dst.planets[i]).find((q: any) => q && !q.moon && q.g === to.g && q.s === to.s && q.p === to.p); if (dp) def.bonus = E.combatBonus(dp); def.eng = +((dst.cmd || {}).engineer || 0) > Date.now(); } } catch (_e) { /* Bonus fällt auf Kern zurück */ }
      defHasMoon = (p.data.planets || []).some((q: any) => q.moon && q.g === to.g && q.s === to.s && q.p === to.p); }
    if (defL && row.mission !== "transport") { const blk = await pvpBlock(row.from_l, defL); if (blk) throw new Error(blk); }
    if (row.mission === "transport") {
      await patchSnap(defL!, to, (sn: any) => { for (const r of ["m", "k", "g"]) sn.r[r] = (sn.r[r] || 0) + (+d.cargo[r] || 0); });
      await event(defL!, { kind: "transport", from: d.from, to, res: d.cargo });
      result = { kind: "transport", to, defName, delivered: d.cargo };
    } else if (row.mission === "spy") {
      const n = d.ships.pr || 0; const score = n + 2 * ((d.esp || 0) - (def.tech.espionage || 0));
      const data: any = { target: { ...to, name: defName, kind: "player", player: defName }, score, r: Object.fromEntries(Object.entries(def.r).map(([k, v]) => [k, Math.floor(v as number)])) };
      if (score >= 2) data.ships = def.ships; if (score >= 3) data.def = def.def; if (score >= 5) data.tech = def.tech;
      const enemy = Object.values(def.ships).reduce((x: number, y: any) => x + y, 0) as number; const ch = Math.min(0.8, enemy * 0.02 / Math.max(1, n));
      data.counter = Math.round(ch * 100); data.lost = Math.random() < ch;
      if (defL) await event(defL, { kind: "spied", from: d.from, to, lost: data.lost });
      result = { kind: "spy", spy: data, lostProbes: data.lost };
    } else {
      // Galactonit v2: Kern-Boni aus den veröffentlichten Planetendaten (Angreifer: Startplanet, Verteidiger: Zielplanet)
      const cb = (c: string | null, _dfd: boolean) => { const C = c && (GE as any).CORES[c]; const o: any = {}; if (!C) return o; for (const st of C.stats) if (st === "at" || st === "sh" || st === "hull") o[st] = C.v; return o; };
      let atkCore: string | null = null; if (defL && d.fromC) { const ap = must(await db.from("ge_pub").select("data").eq("name_l", row.from_l).maybeSingle()) as any; const asn = (ap?.data?.snap || []).find((q: any) => q.g === d.fromC.g && q.s === d.fromC.s && q.p === d.fromC.p); atkCore = asn?.core || null; }
      const B = E.simulate({ units: d.ships, tech: d.tech, bonus: d.bonus || cb(atkCore, false) }, { units: { ...def.ships, ...def.def }, tech: def.tech, bonus: def.bonus || cb(defCore, true) });
      // Mond + Galactonit-Wurf (nur echte Spieler, einmal je Kampf)
      let moon = false, galA = 0, galD = 0, galWhy = "";
      if (defL) { moon = !defHasMoon && Math.random() * 100 < B.moonChance;
        const pk = "galpair:" + [row.from_l, defL].sort().join("|"); const pr = (await meta(pk)) as any;
        if (E.galDebris(B) < E.GAL.MIN_LOSS) galWhy = "zu wenig Trümmer für Galactonit (< 100.000 Metall+Kristall)";
        else if (pr && Date.now() - (+pr.t || 0) < E.GAL.PAIR) galWhy = "Galactonit für dieses Spielerpaar erst wieder ab " + new Date((+pr.t) + E.GAL.PAIR).toISOString().slice(0, 16).replace("T", " ") + " UTC";
        else { const g = E.galRoll(B, moon); galA = g.a; galD = g.d; if (!galA) galWhy = "kein Galactonit gefunden";
          if (galA) { must(await db.from("ge_meta").upsert({ k: pk, v: { t: Date.now(), f: row.id } }));
            for (const [l, key, n] of [[row.from_l, "a" + row.id, galA], [defL, "d" + row.id, galD]] as [string, string, number][]) { const k = "gal:" + l; const v = ((await meta(k)) || {}) as any; v[key] = n; must(await db.from("ge_meta").upsert({ k, v })); } } }
        if (moon) await patchPlanets(defL, to); }
      const gx = { pvp: !!defL, moon, galWhy };
      const sp = E.splitUnits(B.endD); const rebuilt: any = E.rebuildDef(B.lossD, !!def.eng); // Review F18: stochastisch 70 % / Ingenieur 85 %
      let loot = { m: 0, k: 0, g: 0 };
      if (B.winner === "a") { const used = (d.cargo.m || 0) + (d.cargo.k || 0) + (d.cargo.g || 0); loot = E.lootCalc(def.r, Math.max(0, E.cargoCap(B.endA) - used)); }
      const lossShips: any = {}, lossDef: any = {}; for (const k in B.lossD) { if (GE.DEF[k]) { const l = B.lossD[k] - (rebuilt[k] || 0); if (l > 0) lossDef[k] = l; } else lossShips[k] = B.lossD[k]; }
      const battleA = E.packBattle(B, d.from, defName + (row.to_npc ? "" : " 👤"), { loot, rebuilt, coord: to, attackerIsMe: true, ...gx, gal: galA });
      const battleD = E.packBattle(B, d.from + " 👤", defName + " (Du)", { loot, rebuilt, coord: to, attackerIsMe: false, ...gx, gal: galD });
      if (defL) { await patchSnap(defL, to, (sn: any) => { for (const k in lossShips) sn.ships[k] = Math.max(0, (sn.ships[k] || 0) - lossShips[k]); for (const k in lossDef) sn.def[k] = Math.max(0, (sn.def[k] || 0) - lossDef[k]); for (const r of ["m", "k", "g"]) sn.r[r] = Math.max(0, (sn.r[r] || 0) - ((loot as any)[r] || 0)); }); }
      if (defL) await event(defL, { kind: "attacked", from: d.from, to, lossShips, lossDef, loot, debris: B.debris, battle: battleD, winner: B.winner, moon, gal: galD, galKey: galD ? "d" + row.id : null });
      else { { const NLall = ((await meta("npcloss")) || {}) as any; const NL = NLall[row.to_npc] || { ships: {}, def: {} }; for (const k in lossShips) NL.ships[k] = (NL.ships[k] || 0) + lossShips[k]; for (const k in lossDef) NL.def[k] = (NL.def[k] || 0) + lossDef[k]; NLall[row.to_npc] = NL; must(await db.from("ge_meta").upsert({ k: "npcloss", v: NLall })); }
        const H = (await meta("npchits")) || {}; const o = H[row.to_npc] || { m: 0, k: 0, g: 0, t: Date.now() }; const f = Math.max(0, 1 - (Date.now() - o.t) / (12 * 3600e3 / CFG.speed));
        H[row.to_npc] = { m: (o.m || 0) * f + loot.m, k: (o.k || 0) * f + loot.k, g: (o.g || 0) * f + loot.g, t: Date.now() }; must(await db.from("ge_meta").upsert({ k: "npchits", v: H })); }
      result = { kind: "attack", endShips: B.endA, loot, debris: B.debris, battle: battleA, winner: B.winner, defName, moon, gal: galA, galKey: galA ? "a" + row.id : null };
    }
  } catch (e) { result = { kind: "fail", msg: (e as Error).message }; }
  must(await db.from("ge_fleet").update({ status: "done", result }).eq("id", row.id));
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const P = new URL(req.url).pathname.replace(/^.*?\/api\//, "/api/");
  try {
    if (P === "/api/health") return J({ ok: true, service: "ge-supabase", version: VERSION, speed: CFG.speed, lastTick: await meta("snapT") });
    if (P === "/api/tick") { // stündlich per pg_cron: Rang-Schnappschuss
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
      const r = await db.from("ge_acct").insert(a); if (r.error) return err(r.error.code === "23505" ? "Name oder Heimatposition bereits vergeben" : r.error.message, 409);
      // Review F02: der Server erstellt den Startzustand; ein erster Client-Upload wird dagegen geprüft
      { const st = E.newGame({ speed: CFG.speed, seed: CFG.seed }); const hp = st.planets[st.home]; hp.g = a.home[0]; hp.s = a.home[1]; hp.p = a.home[2]; hp.temp = 40; st.seed = CFG.seed; st.created = a.created; st.t = a.created; st.srv = 1;
        must(await db.from("ge_save").insert({ name_l: n, z: await gzip(JSON.stringify(st)), t: st.t })); }
      return J({ token: a.token, ...pubAcct(a), hasSave: false });
    }
    if (P === "/api/login" && req.method === "POST") {
      const b = await jbody(req); const nl = norm(b.name); const fs = await failState(nl); const lk = lockedFor(fs);
      if (lk > 0) return err(`Zu viele Fehlversuche – bitte ${Math.ceil(lk / 60e3)} Minuten warten`, 429);
      const a = must(await db.from("ge_acct").select("*").eq("name_l", nl).maybeSingle()) as any;
      if (!a || !(await pinOk(a, String(b.pin || "")))) { fs.f.push(Date.now()); must(await db.from("ge_meta").upsert({ k: "lf:" + nl, v: fs })); return err("Name oder PIN falsch", 401); }
      { const up: any = { token_t: Date.now() }; if (!String(a.hash).startsWith("pbkdf2$")) up.hash = await pbkdf2(a.salt, String(b.pin)); if (a.token_t && Date.now() - +a.token_t > TOKEN_MS) { up.token = tokenNew(); a.token = up.token; }
        must(await db.from("ge_acct").update(up).eq("name_l", a.name_l)); if (fs.f.length) must(await db.from("ge_meta").delete().eq("k", "lf:" + nl)); }
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
    if (P === "/api/save" && req.method === "GET") { const s = must(await db.from("ge_save").select("z,t").eq("name_l", a.name_l).maybeSingle()) as any; return s ? J(s) : err("Kein Spielstand", 404); }
    if (P === "/api/save" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); if (typeof b.z !== "string" || b.z.length > 5_000_000) return err("Ungültiger Spielstand");
      // v41: Server rechnet nach – unmögliche Sprünge (Stufen-Regeln, Bauzeit, DM, Kosten) werden abgelehnt
      let nx: any; try { nx = JSON.parse(await gunzip(b.z)); } catch (_e) { return err("Spielstand unlesbar"); }
      // v42: alte Clients (ohne Stufen-Regeln, z. B. aus dem Cache) dürfen keine Spielstände mehr schreiben
      if ((+b.cv || 0) < 54) return J({ error: "Veraltete App-Version – bitte neu laden (die neue Version wird geladen)", code: "reject", reasons: ["client " + (b.cv || "alt")] }, 409);
      // v42: Konto-Reset – nur Spielstände mit der aktuellen Reset-Kennung (rid) werden angenommen; ältere lokale Kopien werden abgewiesen
      { const r = must(await db.from("ge_meta").select("v").eq("k", "rid:" + a.name_l).maybeSingle()) as any;
        if (r && r.v && nx.rid !== r.v.rid) return J({ error: "Dein Konto wurde zurückgesetzt – der neue Spielstand wird geladen", code: "reject", reasons: ["reset"] }, 409); }
      if (+nx.t > Date.now() + 5 * 60e3) return J({ error: "Spielstand aus der Zukunft", code: "reject" }, 409);
      const prev = must(await db.from("ge_save").select("z,t,updated").eq("name_l", a.name_l).maybeSingle()) as any;
      // Review F12: Revisionsprüfung – ein Stand, der nicht auf dem letzten akzeptierten aufbaut, wird abgewiesen
      if (prev && b.base != null && +b.base > 0 && +b.base !== +prev.t) return J({ error: "Spielstand veraltet (anderes Gerät/Tab) – aktueller Stand wird geladen", code: "reject", reasons: ["base " + b.base + " != " + prev.t] }, 409);
      if (!prev) { try { E.load(nx); const led = ((await meta("gal:" + a.name_l)) || {}) as any; const g = nx.gal || {}; const src = g.src || {};
          const badKey = Object.keys(src).some((k) => k === "tut" ? +src[k] > 1 : !(led[k] != null && +led[k] === +src[k]));
          if (badKey || (+g.base || 0) > 0 || (+g.st || 0) + 5 * (E.cores(nx) + (+g.lost || 0)) > E.galSum(g)) return J({ error: "Spielstand abgelehnt: Galactonit ohne Beleg", code: "reject", reasons: ["gal first save"] }, 409); } catch (_e) { /* ungültig → unten wie bisher */ } }
      if (prev) { try { const pv = JSON.parse(await gunzip(prev.z)); E.load(pv); E.load(nx); const dt = Date.now() - (Date.parse(prev.updated) || 0);
          // Admin-Geschenke: eingelöste Geschenke müssen im Stand bleiben (kein Überschreiben durch alte Kopien); neu enthaltene zählen als verdiente DM
          const gl = must(await db.from("ge_gift").select("id,dm").eq("name_l", a.name_l).not("claimed", "is", null)) as any[];
          const g1 = nx.gifts || {}, g0 = pv.gifts || {}; const miss = gl.filter((g) => !g1[g.id]);
          if (miss.length) return J({ error: "Geschenk fehlt im Spielstand – aktueller Stand wird geladen", code: "reject", reasons: ["gift " + miss.map((g) => g.id).join(",")] }, 409);
          const giftDM = gl.filter((g) => g1[g.id] && !g0[g.id]).reduce((x, g) => x + (+g.dm || 0), 0);
          const galLed = ((await meta("gal:" + a.name_l)) || {}) as any;
          // Review F01: belegte Zuflüsse aus Server-Ereignissen (Lieferungen) und Flottenergebnissen (Beute)
          const evRes: Record<string, number> = {}; const sum = (o: any) => (+(o?.m) || 0) + (+(o?.k) || 0) + (+(o?.g) || 0);
          for (const e of must(await db.from("ge_event").select("id,data").eq("name_l", a.name_l)) as any[]) if (e.data?.kind === "transport") evRes[String(e.id)] = sum(e.data.res);
          for (const f of must(await db.from("ge_fleet").select("id,result").eq("from_l", a.name_l).eq("status", "done")) as any[]) if (f.result?.loot) evRes["f" + f.id] = sum(f.result.loot);
          const errs: string[] = E.validateSave(pv, nx, dt, giftDM, galLed, evRes);
          if (errs.length) { console.log("save reject", a.name_l, errs.slice(0, 5)); return J({ error: "Spielstand abgelehnt: " + errs.slice(0, 3).join("; "), code: "reject", reasons: errs.slice(0, 20) }, 409); }
        } catch (e) { console.log("validate fail", (e as Error).message); return J({ error: "Spielstand konnte nicht geprüft werden", code: "reject", reasons: ["validate: " + (e as Error).message] }, 409); } }
      if (prev) { const up = must(await db.from("ge_save").update({ z: b.z, t: +b.t || Date.now(), updated: new Date().toISOString() }).eq("name_l", a.name_l).eq("t", prev.t).select("name_l")) as any[];
        if (!up.length) return J({ error: "Gleichzeitige Speicherung – aktueller Stand wird geladen", code: "reject", reasons: ["race"] }, 409); }
      else must(await db.from("ge_save").insert({ name_l: a.name_l, z: b.z, t: +b.t || Date.now(), updated: new Date().toISOString() }));
      return J({ ok: true });
    }
    if (P === "/api/pub" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const num = (x: unknown) => Math.max(0, Math.floor(+(x as number) || 0));
      const planets = (Array.isArray(b.planets) ? b.planets : []).slice(0, 20).map((p: any) => ({ g: num(p.g), s: num(p.s), p: num(p.p), name: String(p.name || "").slice(0, 20), type: String(p.type || "").slice(0, 20), moon: !!p.moon }));
      // Review F07: /pub ist eine abgeleitete Ansicht des zuletzt akzeptierten Spielstands – keine Client-Angaben zu Technik, Koordinaten, Flotte oder Kern
      const st = await loadSave(a.name_l); const al = await myAlly(a.name); let snap: any[] = []; let tech: any = {}; let tutEnd: number | null = null; let pve = false;
      if (st) { const ps = (st.order || []).map((i: string) => st.planets[i]).filter((q: any) => q);
        planets.length = 0; for (const q of ps.slice(0, 20)) planets.push({ g: num(q.g), s: num(q.s), p: num(q.p), name: String(q.name || "").slice(0, 20), type: String(q.type || "").slice(0, 20), moon: !!q.moon });
        snap = ps.filter((q: any) => !q.moon).slice(0, 20).map((q: any) => ({ g: q.g, s: q.s, p: q.p, r: { m: Math.floor(+q.r?.m || 0), k: Math.floor(+q.r?.k || 0), g: Math.floor(+q.r?.g || 0) }, ships: { ...(q.ships || {}) }, def: { ...(q.def || {}) }, core: q.core || null, radar: capLv("radar", (q.b || {}).radar || 0) }));
        const T = st.tech || {}; tech = { weapons: Math.min(40, +T.weapons || 0), shielding: Math.min(40, +T.shielding || 0), armour: Math.min(40, +T.armour || 0), espionage: Math.min(40, +T.espionage || 0) };
        tutEnd = st.flags?.tutEnd ? +st.flags.tutEnd : null; pve = !!st.flags?.pveMode; }
      else { planets.length = 0; planets.push({ g: a.home[0], s: a.home[1], p: a.home[2], name: "Heimatplanet", type: "heimatwelt", moon: false }); }
      const pub: any = { name: a.name, tag: al ? al.tag : null, ally: al ? al.name : null, home: planets[0] ? [planets[0].g, planets[0].s, planets[0].p] : a.home,
        pts: { b: 0, t: 0, f: 0, d: 0 }, planets, t: Date.now(), devMax: 0, tutEnd, pve, prot: Date.now() < protEnd(+a.created || 0, tutEnd) };
      { const sp = await savePoints(a.name_l); if (sp) pub.pts = sp; // Progression v1: Punkte vom Server berechnet (Client-Angaben nur, solange kein Spielstand existiert)
        const old = must(await db.from("ge_pub").select("data").eq("name_l", a.name_l).maybeSingle()) as any; pub.devMax = Math.max(+(old?.data?.devMax) || 0, pub.pts.b + pub.pts.t); }
      must(await db.from("ge_pub").upsert({ name_l: a.name_l, data: { ...pub, snap, tech }, t: pub.t }));
      await resolveDue({ to_l: a.name_l });
      const u: any = await universe(); u.players = u.players.map((p: any) => { const { snap: _s, tech: _t, ...rest } = p; return rest; });
      return J({ ...u, ...(await personal(a)), created: a.created });
    }
    // ---------- Stufe 2: Flotten zwischen Spielern / NPC-Spielern ----------
    if (P === "/api/fleet" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); if (!["attack", "spy", "transport"].includes(b.mission)) return err("Mission nicht möglich");
      let to_l = null, to_npc = null;
      if (b.target?.npc) { if (!NPCS.some((x) => x.id === b.target.npc)) return err("Ziel unbekannt"); to_npc = b.target.npc; if (b.mission === "transport") return err("Transport nur zu echten Spielern"); }
      else { to_l = norm(b.target?.name); if (to_l === a.name_l) return err("Eigenes Ziel"); const t = must(await db.from("ge_acct").select("name_l").eq("name_l", to_l).maybeSingle()); if (!t) return err("Ziel unbekannt");
        if (b.mission !== "transport") { const blk = await pvpBlock(a.name_l, to_l); if (blk) return err(blk, 403); } }
      // Review F06: Besitz, Fracht und Flugzeit gegen den akzeptierten Spielstand prüfen; cid eindeutig je Konto (Wiederholung → gleiche Flotte)
      const cid = b.cid != null ? String(b.cid).slice(0, 64) : null;
      if (cid) { const ex = must(await db.from("ge_fleet").select("id").eq("from_l", a.name_l).eq("cid", cid).maybeSingle()) as any; if (ex) return J({ id: ex.id, dup: true }); }
      const st = await loadSave(a.name_l); if (!st) return err("Kein Spielstand – bitte zuerst speichern");
      const fc = b.fromC || {}; const pl = (st.order || []).map((i: string) => st.planets[i]).find((q: any) => q && q.g === +fc.g && q.s === +fc.s && q.p === +fc.p && !!q.moon === !!fc.moon);
      if (!pl) return err("Startplanet gehört nicht zu deinem Konto", 403);
      const ships: any = {}; for (const k in b.ships || {}) { const n = Math.floor(+b.ships[k] || 0); if (n > 0) { if (!GE.SHIP[k]) return err("Unbekannte Einheit"); ships[k] = n; } }
      if (!Object.keys(ships).length) return err("Keine Schiffe");
      const avail: any = { ...(pl.ships || {}) }; for (const f of st.fleets || []) if (!f.npc && f.from === pl.id) for (const k in f.ships || {}) avail[k] = (avail[k] || 0) + (+f.ships[k] || 0);
      for (const k in ships) if (ships[k] > (avail[k] || 0)) return err("Mehr Schiffe als im Spielstand vorhanden", 403);
      const cargo = { m: Math.max(0, Math.floor(+b.cargo?.m || 0)), k: Math.max(0, Math.floor(+b.cargo?.k || 0)), g: Math.max(0, Math.floor(+b.cargo?.g || 0)) };
      if (cargo.m + cargo.k + cargo.g > E.cargoCap(ships)) return err("Ladung übersteigt Laderaum", 403);
      E.load(st); const dur = E.flightTime(pl, b.to, ships, 100) * 1000; const arrive = Math.floor(+b.arrive);
      if (!(arrive >= Date.now() + dur * 0.95 - 15000) || arrive > Date.now() + 30 * 864e5) return err("Flugzeit unplausibel", 403);
      const T = st.tech || {}; const tech = { weapons: Math.min(40, +T.weapons || 0), shielding: Math.min(40, +T.shielding || 0), armour: Math.min(40, +T.armour || 0) };
      const data = { from: a.name, fromC: { g: pl.g, s: pl.s, p: pl.p, moon: !!pl.moon }, to: b.to, ships, cargo, tech, esp: Math.min(40, +T.espionage || 0), depart: +b.depart, cid, bonus: E.combatBonus(pl) };
      const r = await db.from("ge_fleet").insert({ from_l: a.name_l, to_l, to_npc, mission: b.mission, data, arrive, cid }).select("id").single();
      if (r.error) { if (r.error.code === "23505" && cid) { const ex = must(await db.from("ge_fleet").select("id").eq("from_l", a.name_l).eq("cid", cid).maybeSingle()) as any; if (ex) return J({ id: ex.id, dup: true }); } throw new Error(r.error.message); }
      return J({ id: (r.data as any).id });
    }
    // Review V2 §7: friedliche Kernroute – 1 Stein je 7 reale Tage, frühestens nach 7 Kontotagen; Erfüllung aus dem akzeptierten Spielstand
    if (P === "/api/gal/peace" && req.method === "POST") {
      const now = Date.now(); if (now - (+a.created || 0) < E.GAL.PEACE_MS) return err("Frühestens nach 7 Kontotagen", 403);
      const pk = "peace:" + a.name_l; const pm = ((await meta(pk)) || { n: 0, last: 0 }) as any; if (now - (+pm.last || 0) < E.GAL.PEACE_MS) return err("Höchstens 1 Stein je 7 Tage", 403);
      const st = await loadSave(a.name_l); if (!st) return err("Kein Spielstand"); E.load(st); const I = E.peaceInfo(); if (!I.done) return err("Projekt im gespeicherten Stand noch nicht erfüllt – bitte kurz warten und erneut versuchen", 409);
      const key = "p" + ((+pm.n || 0) + 1); const gk = "gal:" + a.name_l; const gv = ((await meta(gk)) || {}) as any; if (gv[key] != null) return J({ key, n: gv[key] });
      gv[key] = 1; must(await db.from("ge_meta").upsert({ k: gk, v: gv })); must(await db.from("ge_meta").upsert({ k: pk, v: { n: (+pm.n || 0) + 1, last: now } }));
      return J({ key, n: 1 });
    }
    if (P === "/api/fleet/resolve" && req.method === "POST") {
      const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); const row = must(await db.from("ge_fleet").select("*").eq("id", +b.id).eq("from_l", a.name_l).maybeSingle()) as any;
      if (!row) return err("Flotte unbekannt", 404);
      if (row.status === "done") return J({ result: row.result });
      if (Date.now() < row.arrive - 3000) return J({ wait: row.arrive - Date.now() });
      const res = await resolve(row); return J({ result: res });
    }
    if (P === "/api/fleet/recall" && req.method === "POST") { const b = await jbody(req, (P as string) === "/api/save" ? 6_000_000 : ACTION_MAX); must(await db.from("ge_fleet").update({ status: "recalled" }).eq("id", +b.id).eq("from_l", a.name_l).eq("status", "out")); return J({ ok: true }); }
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
