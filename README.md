# ge-server
Multiplayer-Server für Galaxy Empire.

Aktiv: Supabase Edge Function `supabase/functions/ge` (Tabellen in `supabase/schema.sql`, stündlicher pg_cron-Job ge-tick).
Deploy: `supabase functions deploy ge --project-ref <ref> --no-verify-jwt --use-api`

`main.ts` ist ein veralteter Deno-KV-Prototyp **ohne** Validator/Galactonit/Nebel/PvP-Prüfungen und nicht Teil des unterstützten Produktionsumfangs (keine gleiche API).
Prüfung: `deno task check` (Typprüfung der Function); Spiel-Regressionstests liegen im Client-Repo-Umfeld (Validator-/Nebel-/Galactonit-Tests).

## Review V2 (2026-10-15)
- Registrierung legt den Startzustand serverseitig an (F02); `/pub` wird aus dem akzeptierten Spielstand abgeleitet (F07).
- Speichern: Revisionsprüfung (`base`), optimistische Sperre, belegte Zuflüsse/DM-Quellen, keine Pauschaltoleranzen (F01/F03–F05/F12).
- Flotten: Besitz/Fracht/Flugzeit gegen den Spielstand, eindeutige `cid`, Technik/Boni vom Server (F06/F20); Lease statt Dauer-`busy` (A3).
- Auth: PBKDF2-Hash, 5 Fehlversuche/15 min mit gestaffelter Sperre, ablaufende Sitzungen, 64-KiB-Aktions- und 2-MiB-Snapshotgrenze (F23).
- Schema/Cron: `supabase/schema.sql` (inkl. `ge_gift`, Indizes, Lease-/cid-/token_t-Spalten, Cron-Vorlage).
