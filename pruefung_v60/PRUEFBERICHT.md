# Galaxy Empire – Prüfstand Revision 60

Stand: 16.10.2026. Grundlage ist das vollständige Eingangspaket ohne Grafiken. Revision 60 enthält den Laborfix, die zuvor festgelegten Anpassungen aus Revision 59 und die nachfolgend beschriebenen Integrationskorrekturen. Das Spiel wurde lokal verändert und geprüft. Es wurde nicht auf eine produktive Spielwelt aufgespielt.

## Ergebnis

**53 Testgruppen bestanden:** 27 Komponentenprüfungen, acht Prüfungen des HTTP-Handlers gegen das Transaktionsmodell und 18 zusätzliche Integrationsgruppen mit echter Deno-Laufzeit, Supabase-SDK, PostgreSQL/PGlite und Chromium. Die sechs Aufbauversuche über jeweils 180 Tage wurden erneut ausgeführt; alle Ressourcenbilanzen blieben innerhalb der Prüftoleranz von 0,01 Rohstoffen.

Die Deno-Typprüfung besteht. Client und Server verwenden bytegleiche Fassungen von `data.js`, `engine.js`, `campaign.js`, `planning.js` und `actions.js`.

Die Tests belegen die beschriebenen Abläufe. Sie beweisen weder endgültiges Langzeitbalancing noch die Betriebsfähigkeit einer konkreten produktiven Supabase-Installation.

## Gefundene und behobene Integrationsfehler

| Priorität | Befund und Beleg | Korrektur |
|---|---|---|
| Hoch | Ein auf das Serverergebnis wartender Flug erhielt `Infinity` als Ankunft. JSON speichert dies als `null`; der nächste Tick behandelte `null` erneut als fällige Ankunft. | Wartende Serverflotten haben einen expliziten Wartezustand ohne lokalen Ereignistermin. Ein JSON-Rundlauf löst keine zweite Ankunft aus. |
| Hoch | Bei leerem ursprünglichem Aktionspaket wurde die bestätigte Sequenznummer erst nach der asynchronen Komprimierung gelesen. Ein inzwischen erteilter Auftrag konnte dadurch als bereits bestätigt entfernt werden. | Paket und Sequenzgrenze werden gemeinsam vor der Komprimierung erfasst. Der Chromium-Test hält die Komprimierung an, erteilt einen Produktionsauftrag und prüft beide Speicherungen. |
| Hoch | Eine verlorene Bestätigungsantwort ließ eine bezahlte Servermission ohne lokale Server-ID zurück. Der bisherige Client konnte sie später eigenständig zurückschicken. | Ausstehende Bestätigungen werden erneut abgefragt. Eine im Test nach erfolgreichem Datenbankeintrag verworfene Antwort führt beim nächsten Abgleich zu derselben Mission und keiner zweiten Abbuchung. |
| Hoch | Eine zurückgerufene, noch im Spielstand vorhandene Mission konnte nachträglich registriert werden. Ein verspäteter Rückruf konnte außerdem eine bereits fällige bestätigte Mission betreffen. | Registrierung akzeptiert nur Hinflug oder ausstehende Auflösung. Rückruf berücksichtigt den bestätigten Status und die Fälligkeit. |
| Hoch | Beim Fortschreiben zweier Kampfkonten konnten beide unabhängig dieselbe Kopie eines gemeinsamen Trümmerfeldes bergen. Nur eine dieser Weltänderungen wäre gespeichert worden. | Gemeinsame Ereignisse beider beteiligten Laufzeiten werden nach Zeitstempel auf einem fortgeschriebenen Weltbestand verarbeitet. Der Test mit zwei versetzten Recyclerankünften schreibt die Fracht ausschließlich der ersten Ankunft zu. |
| Mittel | Verlust und Fracht wurden bereits serverseitig verbucht; die Ereignis-ID war danach als gesehen markiert. Der Client konnte dadurch den zugehörigen Bericht überspringen. Andere Antwortwege erzeugten Berichte erneut. | Ereignis, Bericht und dauerhafte Ergebnis-ID werden gemeinsam und einmalig verarbeitet. SQL-Tests prüfen einen Transportbericht und einen Kampfbericht trotz wiederholter Auflösung. |
| Mittel | Das neue Positionsregister enthielt bestehende Konten und veröffentlichte Kolonien zunächst nicht. Eine neue Heimatwelt war vor der ersten Veröffentlichung im Slot-Kontext unsichtbar. | Schema trägt belegte Positionen nach und bricht bei widersprüchlicher Eigentümerschaft ab. Unveröffentlichte Heimatwelten werden aus den Kontodaten reserviert. |
| Mittel | Der kanonische Startstand enthielt weiterhin „Kommandant“. Der im Client aktivierte optionale PvE-Modus war keine übertragene Aktion. | Kontoname wird serverseitig gesetzt; der PvE-Schalter durchläuft das Aktionsprotokoll. Das einmal gesetzte PvE-Kennzeichen bleibt bestehen. |
| Mittel | Ohne ausgelassene Grafikdateien scheiterte der Ersatzbildaufruf an einem gleichnamigen globalen Bezeichner. Beim Start mit gespeichertem Bauauftrag fehlten außerdem B3-Metadaten. | Expliziter Zugriff auf den Grafikhelfer und DOM-/Bild-Fallback ohne Sprite-Metadaten. Browserstart und erneutes Laden bestehen ohne JavaScript-Seitenfehler. |
| Mittel | Beim erstmaligen Aufbau eines NPC-Spielers teilten aktueller Vorrat und Referenzvorrat Objektreferenzen. Kosten konnten dadurch auch die Referenz verändern. | Initialer NPC-Bestand wird vollständig kopiert. Änderungen des gemeinsamen NPC-Bestands werden in die Welttransaktion aufgenommen; auch ein vorhandener leerer Weltbestand behält seinen korrekten Vergleichswert. |
| Mittel | Eine fehlerhaft geformte Aktionsliste konnte vor der eigentlichen Prüfung eine Serverausnahme auslösen. | Form, Länge, Sequenznummer und Zeit werden vor der Auswertung geprüft; Testantwort ist eine kontrollierte Ablehnung mit HTTP 409. |

## Laborwirkung und vereinbarte Regeln

Die Laborwirkung bleibt wie in Revision 59 korrigiert: Der Forschungszeitdeckel beträgt den bisherigen Deckel multipliziert mit `min(1, 15 / (1 + Laborstufe))`. Das Zeitminimum bleibt 15 Sekunden. Bereits bezahlte Aufträge behalten ihre gebuchte Dauer.

| Waffentechnik 20, Tempo 10 | Forschungsdauer |
|---|---:|
| Labor 14 | 9,4868 Tage |
| Labor 20 | 6,7763 Tage |

Die bereits festgelegten Kostenkurven, Voraussetzungen, Stufenkappen und Nebelregeln wurden in dieser Fortsetzung nicht neu ausbalanciert. Es bleiben höchstens 25 kontoweite Nebelstarts in rollierenden realen 24 Stunden und 30 reale Minuten reguläre Haltezeit. Schiffsfunde bleiben Flottenbestand und werden in den Aufbauauswertungen getrennt von verfügbaren Rohstoffen ausgewiesen.

Die Regressionen enthalten unter anderem 1.480 Kostenvektoren für Stufen 1–40, Training samt Rückruf, Wochenziele, Itemlaufzeiten, Offline-Ereignisgrenzen, NPC-Ersatz, Schutzfenster, exakte Kampfverluste und Sternentore. Der ausführliche frühere Regelprüfstand bleibt in `PRUEFSTATUS.json` erhalten.

## Durchgängiger Ablauf und Nachweise

| Grenze | Ergebnis | Nachweis |
|---|---|---|
| Browser → Anmeldung | Bestanden | Tatsächliches Anmeldeformular in Chromium, danach Wechsel zum Mehrspielerstand. |
| Client → API | Bestanden | Echter Deno-HTTP-Server; Aktionsübermittlung, kanonischer Abgleich und erneutes Laden. |
| API → Datenbank | Bestanden | Echtes Supabase-SDK 2.118.0 gegen lokalen REST-Testadapter; sämtliche verwendeten Spiel-RPCs werden als PostgreSQL-Funktionen ausgeführt. |
| Datenbank → Antwort | Bestanden | Revisionskonflikte, vollständiger Rollback, verweigerter RPC-Aufruf als `anon`, eindeutige Missionen und Ereignisse. |
| Antwort → Client | Bestanden | Neuer Auftrag während Komprimierung bleibt erhalten; verlorene Flottenbestätigungsantwort wird ohne erneuten Start aufgeholt. |

Zusätzliche SQL-/HTTP-Fälle: jeweils 20 parallele Speicherungen, Anmeldeversuche, Flottenbestätigungen, Transportauflösungen, Kampfauflösungen und Geschenkansprüche. Bei den Anmeldeversuchen erreichen fünf die PIN-Prüfung; die weiteren 15 werden begrenzt. Ein abgelaufener Auflösungs-Lease wird übernommen. Ein Geschenk schreibt ausschließlich den hinterlegten DM-Betrag gut. Der friedliche Steinanspruch ist wieder abrufbar und anschließend sieben Tage gesperrt.

Testquellen und protokollierte Resultate liegen in `tests/`. Die Integration verwendet ausschließlich lokale Testkonten und fest definierte Testbestände. Die zusätzlichen Bestände dienen den Konflikt- und Kampffällen; die sechs Aufbauversuche beginnen dagegen beim tatsächlichen Startbestand.

## Erneute Aufbauversuche

Je Profil ein Lauf ohne und ein Lauf mit ausdrücklich aktivierter Vorausplanung, Seed 123, 180 Tage. Auswertung an Tag 1, 7, 30, 90 und 180. Ressourcen, lokale Vorräte, Bezahlung, Voraussetzungen, Baukapazitäten und Flüge werden durch die echten Spielregeln begrenzt.

| Profil | Grundausbildung ohne Vorausplanung | Mit Vorausplanung |
|---|---:|---:|
| Gelegenheit | 72,09 Stunden | 24,01 Stunden |
| Aktiv | 28,00 Stunden | 10,09 Stunden |
| Optimierungsheuristik | 9,31 Stunden | 4,01 Stunden |

Alle sechs Strategien erreichen in diesen Läufen sieben Planeten. Das ist eine Entscheidung der verwendeten Strategien; die Regelgrenze bei Astrophysik 14 beträgt acht. Friedliche Projekte und PvP sind in diesen Aufbauläufen keine zusätzlichen Einkommensquellen. Sie werden separat funktional geprüft. Die Optimierungsheuristik ist kein Beweis der besten möglichen Strategie.

## Grenzen und verbleibende Entscheidungen

Die SQL-Ausführung verwendet PostgreSQL 18.6 in PGlite 0.5.10 mit einem lokalen REST-Testadapter. Dies ist eine echte PostgreSQL-Ausführung, aber keine verwaltete Supabase-Instanz und kein Mehrverbindungs-/Mehrknoten-Lasttest. `pg_cron`, `pg_net`, produktive Zeitplanung, Gateway und das Zusammenspiel der produktiven Rollen sind hier nicht vollständig ausgeführt worden. Die Positionsmigration wurde an Testdaten geprüft, nicht an der bestehenden Produktionsdatenbank.

Die Browserfälle decken die genannten Abläufe ab. Sie ersetzen keinen vollständigen Oberflächentest auf Mobilgeräten. Das Eingangspaket enthält absichtlich keine Bild-, Audio- und Sprite-Dateien; deren Vollständigkeit und Darstellung sind damit nicht geprüft.

Weiterhin offen bleiben die bereits benannten Designfragen: späte absolute Lagergrenzen bei Naniten 31, Terraformer 33 und Hyperantrieb 40; Technokratenwirkung bei weiterhin gedeckelten Forschungszeiten; Endspielziele nach Minenstufe 40. Dafür liegen keine festgelegten Ersatzwerte vor. Sechs Läufe mit einem Seed schließen dominante Strategien, Mehrspielerprobleme oder langfristige Inflation nicht umfassend aus.
