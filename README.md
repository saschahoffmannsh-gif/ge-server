# ge-server
Multiplayer-Server für Galaxy Empire.

Aktiv: Supabase Edge Function `supabase/functions/ge` (Tabellen in `supabase/schema.sql`, stündlicher pg_cron-Job ge-tick).
Deploy: `supabase functions deploy ge --project-ref <ref> --no-verify-jwt --use-api`

`main.ts` = gleiche API für Deno/Deno KV (lokal: `deno task dev`).
