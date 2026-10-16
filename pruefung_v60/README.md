# Galaxy Empire – vollständiger Code, Revision 60 (16.10.2026)

Vollständiger Spielcode ohne Grafiken, Audio, Video und ohne Animations-/Sprite-Code.

## Aufbau
- `client/` – Web-App (index.html, style.css, manifest.webmanifest, sw.js, js/).
- `server/` – Supabase-Edge-Funktion `ge` (Deno/TypeScript) + `supabase/schema.sql` (Tabellen ge_acct, ge_save, ge_pub, ge_fleet, ge_event, ge_gift, ge_meta, ge_chat, ge_ally).

## Wo stehen Regeln und Balancing?
- `client/js/data.js` – alle Werte: Gebäude, Forschung, Schiffe, Verteidigung (Kosten, Faktoren, Voraussetzungen), Stufenregeln, Items, Galactonit-Kerne (GE.CORES), Aufgaben.
- `client/js/engine.js` – Spielmechanik: Produktion/Energie/Lager, Bau-/Forschungszeiten, Kampfsimulation, Kostensegmente (BigInt, max. Stufe 40), Stufenkappen, Item-Laufzeiten (24 h / max. 72 h), exakte Kampfsimulation und Kampfboni (E.combatBonus), Verteidigungsaufbau, Trümmerfeld (30 %), Mond-Chance, Galactonit (Trümmerschwelle 100k, Kernrisiko, friedliche Route), Sternentor (nur Schiffe, Abklingzeit), Trainingsexpedition, Nebel v2 (25 Starts/24 h, Ereignistabelle, Fund-/Verlustformeln), NPC-Budgets, DM- und Rohstoff-Ledger (dmSrc/rIn), Migration und den Altvalidator `E.validateSave`. Die aktive Save-API verwendet serverseitige Aktionswiedergabe (`actions.js`, `protocol.js`).
- `client/js/campaign.js` – Grundausbildung und Kampagnenpfade (Kampf/Nebel/Kolonie/Wirtschaft), Subventionen, Kapitelbelohnungen, Wochenziele (bezahlter Fortschritt).
- `client/js/net.js` – Mehrspieler-Anbindung (Saves mit Base-Revision, PvP-Flotten, Event-Dedupe, Radar-Anzeige, PvE-Kennzeichen).
- `server/supabase/functions/ge/index.ts` – Server: Konten (PBKDF2, Rate-Limit, Token-Ablauf), Save-Validierung mit optimistischem Schreiben, /pub aus dem Save, Flottenprüfung, Radar-Leiter, /api/gal/peace, PvP-Auflösung, Galactonit-Ledger, Paar-Sperre, Anfängerschutz, Admin-Geschenke.
- `server/supabase/functions/ge/engine.js` und `data.js` sind byte-identisch mit der Client-Version; `npc.js` / `lib/npc.js` = NPC-Spieler-Wirtschaftsmodell.
- UI: ui1/ui2/ui3.js, base2.js, gx*.js, rank.js, chat.js, ally.js, reward.js, replay.js.

## Weggelassen
- Alle Bild-, Audio- und Videodateien (assets/, Icons).
- Animations-/Sprite-Code und -Metadaten: b2meta.js, b3meta.js, b3parts.js, b4meta.js, b5anim.js, b5dish.js, b5fx.js, b5meta.js, b5parts.js, env2.js, envdata.js, tfx.js, bfx.js, water.js, ambient.js. index.html referenziert sie weiterhin; ohne sie verwendet die Basis einen DOM-/Bild-Fallback. Die Originalgrafiken sind im Paket nicht enthalten.
- Geheimnisse: keine Tokens, kein Admin-Key, keine .env. Der Server liest SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY und GE_ADMIN_KEY aus Umgebungsvariablen.

## Deploy
`npx supabase functions deploy ge --no-verify-jwt --project-ref <ref>`; Client = statisches Hosting (GitHub Pages).

Die Ergänzungen enthalten Laborwirkung, die 15-teilige Grundausbildung mit optionaler Vorausplanung, Item-Zeitabschnitte, reguläre Wochenziele sowie serverseitige Aktionswiedergabe und atomare Datenbankoperationen. Prüfstand und Testgrenzen stehen in PRUEFSTATUS.json.

Revision 60 ergänzt die Integrationskorrekturen für Speichervorgänge, Serverflotten, gemeinsame Trümmerbestände, Berichte und Koordinatenmigration. `PRUEFBERICHT.md` und `PRUEFSTATUS.json` enthalten Nachweise und Grenzen; die Testquellen und protokollierten Ergebnisse stehen in `tests/`.
