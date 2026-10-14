// NPC-Spieler (Stufe 1): starten bei 0 und spielen wie Menschen – deterministisch aus Seed + Zeit, ohne Speicherbedarf.
// Typen: casual (2 kurze Sitzungen/Tag), active (4 Sitzungen), pausing (aktiv mit mehrtägigen Pausen), aggressive (baut Flotte).
const H = 3600e3, DAY = 864e5;
export function h32(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const PRE = ['Dark','Star','Nova','Iron','Shadow','Frost','Void','Sky','Storm','Night','Solar','Astro','Nebel','Stern','Eis','Sturm','Blitz','Mond','Kosmo','Grim','Lunar'];
const SUF = ['Wolf','Rider','Hunter','Lord','Blade','Fox','Hawk','Knight','Pilot','Fürst','Jäger','Falke','Reiter','Raven','Titan','Viper'];
const FIRST = ['Markus','Julia','Tobias','Lisa','Jonas','Lena','Felix','Mia','Lukas','Sarah','Nico','Anna','Tim','Laura','Ben','Marie'];
const TAGS = [['Sternenbund','STB'],['Eiserne Faust','EF'],['Nova Pact','NOVA'],['Schattenrat','SR'],['Void Legion','VL']];
export const TYPES = {
  casual:     { sess: 2, len: 0.6, eff: 0.55, fleet: 0.10 },
  active:     { sess: 4, len: 0.9, eff: 0.85, fleet: 0.18 },
  pausing:    { sess: 3, len: 0.8, eff: 0.75, fleet: 0.12, pause: true },
  aggressive: { sess: 3, len: 0.9, eff: 0.75, fleet: 0.40 },
};
const COST = { m: [60, 15, 0, 1.5], k: [48, 24, 0, 1.6], g: [225, 75, 0, 1.5], s: [75, 30, 0, 1.5], r: [400, 120, 200, 2], l: [200, 400, 200, 2] };
const cost = (id, lv) => { const c = COST[id]; const f = Math.pow(c[3], lv - 1); return [Math.floor(c[0] * f), Math.floor(c[1] * f), Math.floor(c[2] * f)]; };
export function makeNPCs(seed, n, epoch) {
  const r = rng(seed); const out = []; const used = new Set();
  for (let i = 0; i < n; i++) {
    let name; do { const k = r(); name = k < .5 ? PRE[r() * PRE.length | 0] + SUF[r() * SUF.length | 0] + (r() < .5 ? (r() * 99 | 0) : '') : FIRST[r() * FIRST.length | 0] + (r() < .5 ? '_' : '.') + (70 + (r() * 35 | 0)) % 100; } while (used.has(name)); used.add(name);
    const x = r(); const type = x < .4 ? 'casual' : x < .65 ? 'active' : x < .85 ? 'pausing' : 'aggressive';
    const join = epoch + Math.floor(r() * 14 * DAY);         // gestaffelter Einstieg in den ersten 2 Wochen
    const tag = r() < .45 ? TAGS[r() * TAGS.length | 0][1] : null;
    let s, p; do { s = 1 + (r() * 120 | 0); p = 4 + (r() * 9 | 0); } while (used.has(s + ':' + p)); used.add(s + ':' + p);
    out.push({ id: 'n' + i, n: name, type, join, tag, home: [1, s, p], off: r() * 24, skill: 0.8 + r() * 0.4 });
  }
  return out;
}
export const allyNames = Object.fromEntries(TAGS.map(([n, t]) => [t, n]));
function online(x, hAbs) { // ist der NPC in dieser Stunde aktiv?
  const T = TYPES[x.type]; const day = Math.floor(hAbs / 24); const hod = (hAbs % 24 + 24 - x.off) % 24;
  if (T.pause) { const blk = Math.floor(day / 21); const pr = rng(h32(x.id + ':p' + blk))(); if (pr < 0.55 && day % 21 >= 12) return 0; }
  if (hod < 7 || hod >= 23) return 0;                         // Nachtruhe
  const slot = Math.floor((hod - 7) / (16 / T.sess)); const rr = rng(h32(x.id + ':' + day + ':' + slot))();
  const start = (hod - 7) % (16 / T.sess); return start < T.len * (0.6 + rr * 0.8) ? 1 : 0;
}
// Zustand zum Zeitpunkt t (inkrementell mit Cache)
export function stateAt(x, t, speed, cache) {
  let st = cache && cache.get(x.id);
  if (!st || st.t > t) st = { t: x.join, m: 500, k: 500, g: 0, L: { m: 0, k: 0, g: 0, s: 0, r: 0, l: 0 }, busy: 0, pts: { b: 0, t: 0, f: 0, d: 0 } };
  if (t < x.join) return { ...st, pts: { b: 0, t: 0, f: 0, d: 0 }, L: { ...st.L } };
  const T = TYPES[x.type];
  while (st.t + H <= t) {
    st.t += H; const L = st.L; const hAbs = Math.floor(st.t / H);
    const pm = (30 + 30 * L.m * Math.pow(1.1, L.m)) * speed, pk = (15 + 20 * L.k * Math.pow(1.1, L.k)) * speed, pg = 10 * L.g * Math.pow(1.1, L.g) * speed;
    const eOk = 20 * L.s * Math.pow(1.1, L.s) >= (10 * L.m * Math.pow(1.1, L.m) + 10 * L.k * Math.pow(1.1, L.k) + 20 * L.g * Math.pow(1.1, L.g)) * 0.8 ? 1 : 0.6;
    const cap = 100000 * Math.pow(1.6, Math.min(10, L.m / 3));
    st.m = Math.min(cap, st.m + pm * eOk); st.k = Math.min(cap, st.k + pk * eOk); st.g = Math.min(cap, st.g + pg * eOk);
    if (!online(x, hAbs) || st.t < st.busy) continue;
    // nächster Bau: günstigster sinnvoller Schritt
    const want = []; const need = 10 * L.m * Math.pow(1.1, L.m) + 10 * L.k * Math.pow(1.1, L.k) + 20 * L.g * Math.pow(1.1, L.g);
    if (20 * L.s * Math.pow(1.1, L.s) < need * 1.05) want.push('s');
    want.push('m'); if (L.k < L.m - 1) want.push('k'); if (L.g < L.m - 3) want.push('g');
    if (L.r < Math.floor(L.m / 2.5) && L.m >= 4) want.push('r'); if (L.l < Math.floor(L.m / 2) && L.m >= 3) want.push('l');
    let best = null, bv = 1e30; for (const id of want) { const c = cost(id, L[id] + 1); const v = c[0] + c[1] * 1.3 + c[2] * 1.6; if (v < bv) { bv = v; best = id; } }
    const c = cost(best, L[best] + 1);
    if (st.m >= c[0] && st.k >= c[1] && st.g >= c[2]) {
      st.m -= c[0]; st.k -= c[1]; st.g -= c[2]; L[best]++; st.pts.b += (c[0] + c[1] + c[2]) / 1000;
      const hrs = (c[0] + c[1]) / (2500 * (1 + L.r)) * 6 / speed / (T.eff * x.skill);
      st.busy = st.t + Math.max(0.1, hrs) * H;
    }
    // Forschung + Flotte: Überschuss anteilig (schwächer als Spieler: nur ein Teil des Überschusses)
    const spare = Math.max(0, st.m + st.k + st.g - cap * 0.5) * 0.25 * T.eff;
    if (spare > 0 && L.l > 0) { const f = spare * T.fleet, rs = spare * 0.35; st.pts.f += f / 1000; st.pts.t += rs / 1000; st.pts.d += spare * 0.05 / 1000; const tot = f + rs + spare * 0.05; const q = tot / (st.m + st.k + st.g); st.m *= 1 - q; st.k *= 1 - q; st.g *= 1 - q; }
  }
  if (cache) cache.set(x.id, { ...st, L: { ...st.L }, pts: { ...st.pts } });
  return st;
}
export function summary(x, st) { const p = st.pts; return { id: x.id, n: x.n, type: x.type, tag: x.tag, home: x.home, npc: 1, pts: { b: Math.floor(p.b), t: Math.floor(p.t), f: Math.floor(p.f), d: Math.floor(p.d) }, lv: { ...st.L }, joined: st.t >= x.join }; }
