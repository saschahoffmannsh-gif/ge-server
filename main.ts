// Galaxy Empire – Multiplayer-Server, Stufe 1: Login (Name+PIN+Einladung), Spielstand-Sync, gemeinsame Karte, Rangliste, NPC-Spieler.
// Deno Deploy (console.deno.com) + Deno KV. Lokal: deno task dev
import { makeNPCs, stateAt, summary, allyNames } from "./lib/npc.js";

const CFG = {
  invite: Deno.env.get("INVITE") ?? "GALAXY",
  speed: +(Deno.env.get("SPEED") ?? 10),
  epoch: +(Deno.env.get("EPOCH") ?? Date.UTC(2026, 9, 14)),
  npcs: +(Deno.env.get("NPCS") ?? 60),
  seed: +(Deno.env.get("SEED") ?? 4242),
};
const VERSION = 1;
const kv = await Deno.openKv(Deno.env.get("KV_PATH") || undefined);
const NPCS = makeNPCs(CFG.seed, CFG.npcs, CFG.epoch);
const npcCache = new Map();

Deno.cron("tick", "*/10 * * * *", async () => {
  // Rang-Schnappschuss (für Auf-/Abstiegspfeile) einmal pro Stunde
  const t = Date.now(); const last = (await kv.get<number>(["meta", "snapT"])).value ?? 0;
  if (t - last < 3600e3) return;
  const u = await universe(t); await kv.set(["meta", "snap"], u.ranking.map((x) => [x.id, x.tot]));
  await kv.set(["meta", "snapT"], t);
});

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,authorization", "access-control-allow-methods": "GET,POST,OPTIONS" };
const J = (o: unknown, s = 200) => Response.json(o, { status: s, headers: cors });
const err = (m: string, s = 400) => J({ error: m }, s);
const norm = (n: string) => String(n || "").trim().toLowerCase();
async function sha(s: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const tokenNew = () => [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");

type Acct = { name: string; salt: string; hash: string; token: string; home: number[]; created: number };
async function auth(req: Request): Promise<Acct | null> {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /, ""); if (!t) return null;
  const n = (await kv.get<string>(["tok", t])).value; if (!n) return null;
  return (await kv.get<Acct>(["acct", n])).value;
}
async function freeHome(): Promise<number[]> {
  const taken = new Set(NPCS.map((x) => x.home.join(":")));
  for await (const e of kv.list<{ planets: { g: number; s: number; p: number }[] }>({ prefix: ["pub"] })) for (const p of e.value.planets || []) taken.add(`${p.g}:${p.s}:${p.p}`);
  for await (const e of kv.list<Acct>({ prefix: ["acct"] })) taken.add(e.value.home.join(":"));
  for (let i = 0; i < 500; i++) { const s = 1 + Math.floor(Math.random() * 30), p = 4 + Math.floor(Math.random() * 9); if (!taken.has(`1:${s}:${p}`)) return [1, s, p]; }
  return [1, 31 + Math.floor(Math.random() * 400), 7];
}
const pubAcct = (a: Acct) => ({ name: a.name, home: a.home, speed: CFG.speed, epoch: CFG.epoch, seed: CFG.seed });

// Spielstand in 60-KB-Teilen (KV-Wertlimit 64 KB)
const CH = 60000;
async function putSave(n: string, z: string, t: number) {
  const parts = Math.ceil(z.length / CH); const op = kv.atomic();
  for (let i = 0; i < parts; i++) op.set(["save", n, i], z.slice(i * CH, (i + 1) * CH));
  op.set(["savemeta", n], { parts, t, len: z.length }); await op.commit();
}
async function getSave(n: string) {
  const m = (await kv.get<{ parts: number; t: number }>(["savemeta", n])).value; if (!m) return null;
  let z = ""; for (let i = 0; i < m.parts; i++) z += (await kv.get<string>(["save", n, i])).value || "";
  return { z, t: m.t };
}

async function universe(t = Date.now()) {
  const players: any[] = [];
  for await (const e of kv.list<any>({ prefix: ["pub"] })) players.push(e.value);
  const npcs = NPCS.filter((x) => t >= x.join).map((x) => summary(x, stateAt(x, t, CFG.speed, npcCache)));
  const snap = new Map<string, number>(((await kv.get<[string, number][]>(["meta", "snap"])).value) || []);
  const ranking = [...players.map((p) => ({ id: "p:" + norm(p.name), n: p.name, tag: p.tag || null, home: p.home, pts: p.pts, npc: 0, seen: p.t })),
    ...npcs.map((x) => ({ id: x.id, n: x.n, tag: x.tag, home: x.home, pts: x.pts, npc: 1, type: x.type }))]
    .map((x: any) => ({ ...x, tot: (x.pts.b || 0) + (x.pts.t || 0) + (x.pts.f || 0) + (x.pts.d || 0) }))
    .sort((a, b) => b.tot - a.tot);
  ranking.forEach((x: any, i) => { x.rank = i + 1; x.prev = snap.get(x.id) ?? null; });
  return { t, speed: CFG.speed, epoch: CFG.epoch, version: VERSION, players, npcs, ranking, allyNames };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const u = new URL(req.url); const P = u.pathname;
  try {
    if (P === "/api/health") return J({ ok: true, service: "ge-server", version: VERSION, speed: CFG.speed, lastTick: (await kv.get(["meta", "snapT"])).value ?? null });
    if (P === "/api/register" && req.method === "POST") {
      const b = await req.json(); const n = norm(b.name);
      if (!/^[a-z0-9äöüß_.\- ]{3,16}$/i.test(b.name || "")) return err("Name: 3–16 Zeichen (Buchstaben, Zahlen, _ . -)");
      if (!/^\d{4,8}$/.test(String(b.pin || ""))) return err("PIN: 4–8 Ziffern");
      if (String(b.invite || "").trim().toUpperCase() !== CFG.invite.toUpperCase()) return err("Einladungscode ungültig", 403);
      if (NPCS.some((x) => norm(x.n) === n)) return err("Name bereits vergeben", 409);
      if ((await kv.get(["acct", n])).value) return err("Name bereits vergeben", 409);
      const salt = tokenNew(); const a: Acct = { name: String(b.name).trim(), salt, hash: await sha(salt + b.pin), token: tokenNew(), home: await freeHome(), created: Date.now() };
      const r = await kv.atomic().check({ key: ["acct", n], versionstamp: null }).set(["acct", n], a).set(["tok", a.token], n).commit();
      if (!r.ok) return err("Name bereits vergeben", 409);
      return J({ token: a.token, ...pubAcct(a), hasSave: false });
    }
    if (P === "/api/login" && req.method === "POST") {
      const b = await req.json(); const n = norm(b.name); const a = (await kv.get<Acct>(["acct", n])).value;
      if (!a || (await sha(a.salt + b.pin)) !== a.hash) return err("Name oder PIN falsch", 401);
      const m = (await kv.get(["savemeta", n])).value as any;
      return J({ token: a.token, ...pubAcct(a), hasSave: !!m, saveT: m?.t ?? null });
    }
    if (P === "/api/universe") return J(await universe());
    const a = await auth(req); if (!a) return err("Nicht angemeldet", 401);
    const n = norm(a.name);
    if (P === "/api/me") { const m = (await kv.get(["savemeta", n])).value as any; return J({ ...pubAcct(a), hasSave: !!m, saveT: m?.t ?? null }); }
    if (P === "/api/save" && req.method === "GET") { const s = await getSave(n); return s ? J(s) : err("Kein Spielstand", 404); }
    if (P === "/api/save" && req.method === "POST") {
      const b = await req.json(); if (typeof b.z !== "string" || b.z.length > 2_000_000) return err("Ungültiger Spielstand");
      await putSave(n, b.z, +b.t || Date.now()); return J({ ok: true });
    }
    if (P === "/api/pub" && req.method === "POST") {
      const b = await req.json(); const num = (x: unknown) => Math.max(0, Math.floor(+(x as number) || 0));
      const planets = (Array.isArray(b.planets) ? b.planets : []).slice(0, 20).map((p: any) => ({ g: num(p.g), s: num(p.s), p: num(p.p), name: String(p.name || "").slice(0, 20), type: String(p.type || "").slice(0, 20), moon: !!p.moon }));
      const pub = { name: a.name, tag: b.tag ? String(b.tag).slice(0, 5) : null, ally: b.ally ? String(b.ally).slice(0, 30) : null, home: a.home,
        pts: { b: num(b.pts?.b), t: num(b.pts?.t), f: num(b.pts?.f), d: num(b.pts?.d) }, planets, t: Date.now() };
      await kv.set(["pub", n], pub);
      return J(await universe());
    }
    return err("Unbekannt", 404);
  } catch (e) { return err("Serverfehler: " + (e as Error).message, 500); }
});
