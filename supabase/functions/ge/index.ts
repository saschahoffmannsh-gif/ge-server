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
async function sha(s: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const tokenNew = () => [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
const must = <T>(r: { data: T; error: any }) => { if (r.error) throw new Error(r.error.message); return r.data; };

async function auth(req: Request) {
  const t = (req.headers.get("x-ge-token") || req.headers.get("authorization") || "").replace(/^Bearer /, ""); if (!t) return null;
  const r = must(await db.from("ge_acct").select("*").eq("token", t).maybeSingle()); return r as any;
}
async function freeHome(): Promise<number[]> {
  const taken = new Set(NPCS.map((x) => x.home.join(":")));
  for (const a of must(await db.from("ge_acct").select("home")) as any[]) taken.add(a.home.join(":"));
  for (const p of must(await db.from("ge_pub").select("data")) as any[]) for (const q of p.data.planets || []) taken.add(`${q.g}:${q.s}:${q.p}`);
  for (let i = 0; i < 500; i++) { const s = 1 + Math.floor(Math.random() * 30), p = 4 + Math.floor(Math.random() * 9); if (!taken.has(`1:${s}:${p}`)) return [1, s, p]; }
  return [1, 31 + Math.floor(Math.random() * 400), 7];
}
const pubAcct = (a: any) => ({ name: a.name, home: a.home, speed: CFG.speed, epoch: CFG.epoch, seed: CFG.seed });
async function meta(k: string) { const r = must(await db.from("ge_meta").select("v").eq("k", k).maybeSingle()) as any; return r ? r.v : null; }

async function universe(t = Date.now()) {
  const players = (must(await db.from("ge_pub").select("data")) as any[]).map((x) => { const { snap: _s, tech: _t, ...rest } = x.data; return rest; });
  const npcs = NPCS.filter((x) => t >= x.join).map((x) => summary(x, stateAt(x, t, CFG.speed, npcCache)));
  const snap = new Map<string, number>((await meta("snap")) || []);
  const ranking = [...players.map((p) => ({ id: "p:" + norm(p.name), n: p.name, tag: p.tag || null, home: p.home, pts: p.pts, npc: 0, seen: p.t })),
    ...npcs.map((x) => ({ id: x.id, n: x.n, tag: x.tag, home: x.home, pts: x.pts, npc: 1, type: x.type }))]
    .map((x: any) => ({ ...x, tot: (x.pts.b || 0) + (x.pts.t || 0) + (x.pts.f || 0) + (x.pts.d || 0) }))
    .sort((a, b) => b.tot - a.tot);
  ranking.forEach((x: any, i) => { x.rank = i + 1; x.prev = snap.get(x.id) ?? null; });
  return { t, speed: CFG.speed, epoch: CFG.epoch, version: VERSION, players, npcs, ranking, allyNames };
}

// ---------- Hilfen Stufe 2/3 ----------
async function event(name_l: string, data: unknown) { must(await db.from("ge_event").insert({ name_l, data })); }
async function chatSys(ch: string, txt: string) { must(await db.from("ge_chat").insert({ ch, name: "System", txt, t: Date.now() })); }
async function myAlly(name: string) { const rows = must(await db.from("ge_ally").select("*")) as any[]; return rows.find((r) => r.members.some((m: any) => m.n === name)) || null; }
async function personal(a: any) {
  const inc = must(await db.from("ge_fleet").select("id,mission,data,arrive,from_l").eq("to_l", a.name_l).eq("status", "out")) as any[];
  const ev = must(await db.from("ge_event").select("id,data,created").eq("name_l", a.name_l).eq("acked", false).order("id").limit(50)) as any[];
  const al = await myAlly(a.name);
  return { incoming: inc.map((f) => ({ id: f.id, mission: f.mission, from: f.data.from, to: f.data.to, arrive: f.arrive, n: Object.values(f.data.ships || {}).reduce((x: number, y: any) => x + (+y || 0), 0) })),
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
  const tl = Math.floor(st.L.l * 0.8); return { x, st, r: { m: st.m, k: st.k, g: st.g }, ships, def, tech: { weapons: tl, shielding: tl, armour: tl, espionage: Math.floor(st.L.l / 2) } };
}
async function patchSnap(l: string, to: any, fn: (sn: any) => void) { const p = must(await db.from("ge_pub").select("data").eq("name_l", l).single()) as any; const sn = (p.data.snap || []).find((q: any) => q.g === to.g && q.s === to.s && q.p === to.p && !q.moon); if (!sn) return; sn.r = sn.r || {}; sn.ships = sn.ships || {}; sn.def = sn.def || {}; fn(sn); must(await db.from("ge_pub").update({ data: p.data }).eq("name_l", l)); }
async function resolve(row: any): Promise<any> {
  const claim = must(await db.from("ge_fleet").update({ status: "busy" }).eq("id", row.id).eq("status", "out").select("id")) as any[];
  if (!claim.length) { const r = must(await db.from("ge_fleet").select("result,status").eq("id", row.id).single()) as any; return r.result; }
  const d = row.data; const to = d.to; let result: any;
  try {
    let def: any, defName = "", defL: string | null = null;
    if (row.to_npc) { const T = npcTarget(row.to_npc); const hits = ((await meta("npchits")) || {})[row.to_npc]; if (hits) { const f = Math.max(0, 1 - (Date.now() - hits.t) / (12 * 3600e3 / CFG.speed)); for (const r of ["m", "k", "g"]) T.r[r as "m"] = Math.max(0, T.r[r as "m"] - (hits[r] || 0) * f); } def = T; defName = T.x.n; }
    else { defL = row.to_l; const p = must(await db.from("ge_pub").select("data").eq("name_l", row.to_l).single()) as any; const sn = (p.data.snap || []).find((q: any) => q.g === to.g && q.s === to.s && q.p === to.p && !q.moon);
      if (!sn) throw new Error("Planet nicht mehr vorhanden"); def = { r: { ...sn.r }, ships: { ...sn.ships }, def: { ...sn.def }, tech: p.data.tech || {} }; defName = p.data.name; }
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
      const B = E.simulate({ units: d.ships, tech: d.tech }, { units: { ...def.ships, ...def.def }, tech: def.tech });
      const sp = E.splitUnits(B.endD); const rebuilt: any = {}; for (const k in B.lossD) if (GE.DEF[k]) { const rb = Math.round(B.lossD[k] * 0.7); if (rb) rebuilt[k] = rb; }
      let loot = { m: 0, k: 0, g: 0 };
      if (B.winner === "a") { const used = (d.cargo.m || 0) + (d.cargo.k || 0) + (d.cargo.g || 0); loot = E.lootCalc(def.r, Math.max(0, E.cargoCap(B.endA) - used)); }
      const lossShips: any = {}, lossDef: any = {}; for (const k in B.lossD) { if (GE.DEF[k]) { const l = B.lossD[k] - (rebuilt[k] || 0); if (l > 0) lossDef[k] = l; } else lossShips[k] = B.lossD[k]; }
      const battleA = E.packBattle(B, d.from, defName + (row.to_npc ? "" : " 👤"), { loot, rebuilt, coord: to, attackerIsMe: true });
      const battleD = E.packBattle(B, d.from + " 👤", defName + " (Du)", { loot, rebuilt, coord: to, attackerIsMe: false });
      if (defL) { await patchSnap(defL, to, (sn: any) => { for (const k in lossShips) sn.ships[k] = Math.max(0, (sn.ships[k] || 0) - lossShips[k]); for (const k in lossDef) sn.def[k] = Math.max(0, (sn.def[k] || 0) - lossDef[k]); for (const r of ["m", "k", "g"]) sn.r[r] = Math.max(0, (sn.r[r] || 0) - ((loot as any)[r] || 0)); }); }
      if (defL) await event(defL, { kind: "attacked", from: d.from, to, lossShips, lossDef, loot, debris: B.debris, battle: battleD, winner: B.winner });
      else { const H = (await meta("npchits")) || {}; const o = H[row.to_npc] || { m: 0, k: 0, g: 0, t: Date.now() }; const f = Math.max(0, 1 - (Date.now() - o.t) / (12 * 3600e3 / CFG.speed));
        H[row.to_npc] = { m: (o.m || 0) * f + loot.m, k: (o.k || 0) * f + loot.k, g: (o.g || 0) * f + loot.g, t: Date.now() }; must(await db.from("ge_meta").upsert({ k: "npchits", v: H })); }
      result = { kind: "attack", endShips: B.endA, loot, debris: B.debris, battle: battleA, winner: B.winner, defName };
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
      const b = await req.json(); const n = norm(b.name);
      if (!/^[a-z0-9äöüß_.\- ]{3,16}$/i.test(b.name || "")) return err("Name: 3–16 Zeichen (Buchstaben, Zahlen, _ . -)");
      if (!/^\d{4,8}$/.test(String(b.pin || ""))) return err("PIN: 4–8 Ziffern");
      if (String(b.invite || "").trim().toUpperCase() !== CFG.invite.toUpperCase()) return err("Einladungscode ungültig", 403);
      if (NPCS.some((x) => norm(x.n) === n)) return err("Name bereits vergeben", 409);
      const salt = tokenNew(); const a = { name_l: n, name: String(b.name).trim(), salt, hash: await sha(salt + b.pin), token: tokenNew(), home: await freeHome(), created: Date.now() };
      const r = await db.from("ge_acct").insert(a); if (r.error) return err(r.error.code === "23505" ? "Name bereits vergeben" : r.error.message, 409);
      return J({ token: a.token, ...pubAcct(a), hasSave: false });
    }
    if (P === "/api/login" && req.method === "POST") {
      const b = await req.json(); const a = must(await db.from("ge_acct").select("*").eq("name_l", norm(b.name)).maybeSingle()) as any;
      if (!a || (await sha(a.salt + b.pin)) !== a.hash) return err("Name oder PIN falsch", 401);
      const s = must(await db.from("ge_save").select("t").eq("name_l", a.name_l).maybeSingle()) as any;
      return J({ token: a.token, ...pubAcct(a), hasSave: !!s, saveT: s?.t ?? null });
    }
    if (P === "/api/universe") return J(await universe());
    const a = await auth(req); if (!a) return err("Nicht angemeldet", 401);
    if (P === "/api/me") { const s = must(await db.from("ge_save").select("t").eq("name_l", a.name_l).maybeSingle()) as any; return J({ ...pubAcct(a), hasSave: !!s, saveT: s?.t ?? null }); }
    if (P === "/api/save" && req.method === "GET") { const s = must(await db.from("ge_save").select("z,t").eq("name_l", a.name_l).maybeSingle()) as any; return s ? J(s) : err("Kein Spielstand", 404); }
    if (P === "/api/save" && req.method === "POST") {
      const b = await req.json(); if (typeof b.z !== "string" || b.z.length > 5_000_000) return err("Ungültiger Spielstand");
      must(await db.from("ge_save").upsert({ name_l: a.name_l, z: b.z, t: +b.t || Date.now() })); return J({ ok: true });
    }
    if (P === "/api/pub" && req.method === "POST") {
      const b = await req.json(); const num = (x: unknown) => Math.max(0, Math.floor(+(x as number) || 0));
      const planets = (Array.isArray(b.planets) ? b.planets : []).slice(0, 20).map((p: any) => ({ g: num(p.g), s: num(p.s), p: num(p.p), name: String(p.name || "").slice(0, 20), type: String(p.type || "").slice(0, 20), moon: !!p.moon }));
      const pub = { name: a.name, tag: b.tag ? String(b.tag).slice(0, 5) : null, ally: b.ally ? String(b.ally).slice(0, 30) : null, home: planets[0] ? [planets[0].g, planets[0].s, planets[0].p] : a.home,
        pts: { b: num(b.pts?.b), t: num(b.pts?.t), f: num(b.pts?.f), d: num(b.pts?.d) }, planets, t: Date.now() };
      const snap = Array.isArray(b.snap) ? b.snap.slice(0, 20) : [];
      must(await db.from("ge_pub").upsert({ name_l: a.name_l, data: { ...pub, snap, tech: b.tech || {} }, t: pub.t }));
      await resolveDue({ to_l: a.name_l });
      const u: any = await universe(); u.players = u.players.map((p: any) => { const { snap: _s, tech: _t, ...rest } = p; return rest; });
      return J({ ...u, ...(await personal(a)) });
    }
    // ---------- Stufe 2: Flotten zwischen Spielern / NPC-Spielern ----------
    if (P === "/api/fleet" && req.method === "POST") {
      const b = await req.json(); if (!["attack", "spy", "transport"].includes(b.mission)) return err("Mission nicht möglich");
      let to_l = null, to_npc = null;
      if (b.target?.npc) { if (!NPCS.some((x) => x.id === b.target.npc)) return err("Ziel unbekannt"); to_npc = b.target.npc; if (b.mission === "transport") return err("Transport nur zu echten Spielern"); }
      else { to_l = norm(b.target?.name); if (to_l === a.name_l) return err("Eigenes Ziel"); const t = must(await db.from("ge_acct").select("name_l").eq("name_l", to_l).maybeSingle()); if (!t) return err("Ziel unbekannt"); }
      const data = { from: a.name, fromC: b.fromC, to: b.to, ships: b.ships || {}, cargo: b.cargo || { m: 0, k: 0, g: 0 }, tech: b.tech || {}, esp: +b.esp || 0, depart: +b.depart, cid: b.cid };
      const r = must(await db.from("ge_fleet").insert({ from_l: a.name_l, to_l, to_npc, mission: b.mission, data, arrive: Math.floor(+b.arrive) }).select("id").single()) as any;
      return J({ id: r.id });
    }
    if (P === "/api/fleet/resolve" && req.method === "POST") {
      const b = await req.json(); const row = must(await db.from("ge_fleet").select("*").eq("id", +b.id).eq("from_l", a.name_l).maybeSingle()) as any;
      if (!row) return err("Flotte unbekannt", 404);
      if (row.status === "done") return J({ result: row.result });
      if (Date.now() < row.arrive - 3000) return J({ wait: row.arrive - Date.now() });
      const res = await resolve(row); return J({ result: res });
    }
    if (P === "/api/fleet/recall" && req.method === "POST") { const b = await req.json(); must(await db.from("ge_fleet").update({ status: "recalled" }).eq("id", +b.id).eq("from_l", a.name_l).eq("status", "out")); return J({ ok: true }); }
    if (P === "/api/ack" && req.method === "POST") { const b = await req.json(); const ids = (b.ids || []).map((x: any) => +x).filter((x: number) => x > 0); if (ids.length) must(await db.from("ge_event").update({ acked: true }).in("id", ids).eq("name_l", a.name_l)); return J({ ok: true }); }
    // ---------- Stufe 3: Allianzen + Chat ----------
    if (P === "/api/ally/list") return J({ allies: must(await db.from("ge_ally").select("tag,name,founder,descr,members,apps,created")) });
    if (P === "/api/ally/create" && req.method === "POST") {
      const b = await req.json(); const tag = String(b.tag || "").trim().toUpperCase(); const name = String(b.name || "").trim();
      if (!/^[A-Z0-9]{2,5}$/.test(tag) || name.length < 3 || name.length > 30) return err("Name (3–30) und Kürzel (2–5 Buchstaben/Ziffern) angeben");
      if (await myAlly(a.name)) return err("Du bist bereits in einer Allianz");
      const r = await db.from("ge_ally").insert({ tag, name, founder: a.name, descr: String(b.descr || "").slice(0, 300), members: [{ n: a.name, rank: "founder", t: Date.now() }], apps: [], created: Date.now() });
      if (r.error) return err(r.error.code === "23505" ? "Kürzel vergeben" : r.error.message, 409);
      await chatSys("ally:" + tag, `${a.name} hat die Allianz gegründet.`); return J({ ok: true, tag });
    }
    if (P === "/api/ally/apply" && req.method === "POST") {
      const b = await req.json(); const al = must(await db.from("ge_ally").select("*").eq("tag", String(b.tag).toUpperCase()).maybeSingle()) as any; if (!al) return err("Allianz unbekannt");
      if (await myAlly(a.name)) return err("Du bist bereits in einer Allianz");
      const apps = (al.apps || []).filter((x: any) => x.n !== a.name).concat([{ n: a.name, msg: String(b.msg || "").slice(0, 200), t: Date.now() }]);
      must(await db.from("ge_ally").update({ apps }).eq("tag", al.tag));
      for (const m of al.members) if (m.rank === "founder" || m.rank === "officer") await event(norm(m.n), { kind: "allyapp", tag: al.tag, from: a.name, msg: String(b.msg || "").slice(0, 200) });
      return J({ ok: true });
    }
    if (P === "/api/ally/decide" && req.method === "POST") {
      const b = await req.json(); const al = await myAlly(a.name); if (!al) return err("Keine Allianz");
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
      const b = await req.json(); const al = await myAlly(a.name); if (!al || al.founder !== a.name) return err("Nur der Gründer", 403);
      const members = al.members.map((m: any) => m.n === b.name && m.rank !== "founder" ? { ...m, rank: b.rank === "officer" ? "officer" : "member" } : m);
      must(await db.from("ge_ally").update({ members }).eq("tag", al.tag)); return J({ ok: true });
    }
    if (P === "/api/ally/kick" && req.method === "POST") {
      const b = await req.json(); const al = await myAlly(a.name); const me = al && al.members.find((m: any) => m.n === a.name);
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
    if (P === "/api/ally/descr" && req.method === "POST") { const b = await req.json(); const al = await myAlly(a.name); if (!al || al.founder !== a.name) return err("Nur der Gründer", 403); must(await db.from("ge_ally").update({ descr: String(b.descr || "").slice(0, 300) }).eq("tag", al.tag)); return J({ ok: true }); }
    if (P === "/api/chat" && req.method === "GET") {
      const u = new URL(req.url); const ch = u.searchParams.get("ch") || "global"; const since = +(u.searchParams.get("since") || 0);
      if (ch.startsWith("ally:")) { const al = await myAlly(a.name); if (!al || "ally:" + al.tag !== ch) return err("Kein Zugriff", 403); }
      const rows = must(await db.from("ge_chat").select("id,name,txt,t").eq("ch", ch).gt("id", since).order("id", { ascending: false }).limit(60)) as any[];
      return J({ msgs: rows.reverse() });
    }
    if (P === "/api/chat" && req.method === "POST") {
      const b = await req.json(); const ch = String(b.ch || "global"); const txt = String(b.txt || "").trim().slice(0, 300); if (!txt) return err("Leer");
      if (ch.startsWith("ally:")) { const al = await myAlly(a.name); if (!al || "ally:" + al.tag !== ch) return err("Kein Zugriff", 403); } else if (ch !== "global") return err("Kanal unbekannt");
      must(await db.from("ge_chat").insert({ ch, name: a.name, txt, t: Date.now() })); return J({ ok: true });
    }
    return err("Unbekannt", 404);
  } catch (e) { return err("Serverfehler: " + (e as Error).message, 500); }
});
