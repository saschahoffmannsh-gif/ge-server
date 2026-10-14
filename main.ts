// Galaxy Empire – Multiplayer-Server (Platzhalter). Deno Deploy + Deno KV.
const kv = await Deno.openKv();
Deno.cron("tick", "*/5 * * * *", async () => { await kv.set(["meta", "lastTick"], Date.now()); });
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,authorization", "access-control-allow-methods": "GET,POST,OPTIONS" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const u = new URL(req.url);
  if (u.pathname === "/api/health") {
    const t = (await kv.get(["meta", "lastTick"])).value;
    return Response.json({ ok: true, service: "ge-server", version: 0, lastTick: t }, { headers: cors });
  }
  return new Response("Galaxy Empire Server – ok", { headers: cors });
});
