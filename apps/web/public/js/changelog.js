// Änderungsprotokoll für die Seite „Changelog“ unter Administration, neueste Version zuerst. Ohne DOM, damit
// apps/api/test/changelog.test.js es prüfen kann (neueste Version = package.json, absteigend, Arten gültig).
// Vor 1.0.0 gab es keine eigenen Versionsnummern (package.json stand von Anfang an auf 1.0.0): Die Stände 0.x sind
// nachträglich nach den zusammengeführten Änderungen nummeriert.
// Beim Release: die Einträge aus UNRELEASED als neue Version oben in CHANGELOG eintragen und UNRELEASED leeren.
// Arten: new = Neu, changed = Geändert, fixed = Behoben, tech = Technik und Betrieb

export const UNRELEASED = [
  ['new', 'Zwei neue Designs unter Einstellungen → Darstellung: V3 „Modern“ mit schlichten dunklen Flächen und V4 „Modern Glass“ im selben Format als Glas über deinem Hintergrund (Bild und Regler wie in V2). In beiden steht die Navigation oben: Die Bereiche sind Pillen, die aktive gleitet beim Wechsel hinüber, die Seiten des Bereichs stehen als Chips darunter; ein Bereich merkt sich die zuletzt geöffnete Seite.'],
  ['changed', 'Der Design-Dialog erscheint nach dem Update für alle noch einmal, jetzt mit vier Designs. „Später“ behält dein bisheriges Design.'],
  ['changed', 'Das anpassbare Dashboard gibt es jetzt in V2, V3 und V4; in V3 und V4 begrüßt es dich mit Namen.'],
  ['tech', 'Migration 042: `users.ui_version` erlaubt `v3` und `v4`, `ui_choice_seen` für alle zurückgesetzt. Aussehen in `css/theme-v3.css` über `data-look="v3"` und `data-shell="top"` am Wurzelelement; V4 setzt zusätzlich `data-ui="v2"`. Die Navigation oben baut `buildTopnav` (`app.js`) aus der Seitenleiste.'],
];

export const CHANGELOG = [
  {
    version: '1.4.1', date: '2026-11-13', migrations: '', title: 'Spotify-Anmeldung verständlich',
    changes: [
      ['fixed', 'Spotify-Anmeldung: Geht bei der Rückkehr von Spotify etwas schief (Adresse direkt geöffnet, Anmeldung abgelaufen, von Spotify abgelehnt), landest du wieder auf der Musikseite mit einer verständlichen Erklärung statt einer rohen Fehlermeldung wie „Zustand fehlt“. Lange Hinweise bleiben länger stehen.'],
    ],
  },
  {
    version: '1.4.0', date: '2026-11-13', migrations: '033–041', title: 'Dienst, Rechnungen, Musik und Blitzer',
    changes: [
      ['new', 'Server-Management → Sicherheit & Einstellungen → „Funktionen“: Pinnwand, Dienstplan, Einsätze & Funk, Fahndungsboard, Bußgeldrechner, Bewerbungen, Personalakte, Abwesenheiten, Lager, Rechnungen, Kasse, Lohnzettel, Blitzer, Musik, Discord und die globale Suche lassen sich für alle ein- und ausschalten. Ausgeschaltet verschwinden sie aus Navigation und Seiten, die Schnittstelle lehnt sie ab; die Daten bleiben erhalten.'],
      ['new', 'Rechnungen und Angebote (Finanzen → Rechnungen): für Firmen im RP an Freitext-Empfänger, Personen oder Organisationen, mit Positionen (Menge × Preis, in Cent gerechnet), Datum, Zahlungsziel und Hinweis; Entwurf oder sofort gestellt, als PDF. „Bezahlt“ bucht die Einnahme auf ein Konto der Organisation (Quelle „Rechnung“). Angebote werden mit einem Klick zur Rechnung. Stornieren und Löschen mit „Verwalten“.'],
      ['new', 'Kasse (Finanzen → Kasse): Eine Kasse gehört zu einem Konto der Organisation. Bar einnehmen und ausgeben, Buchungen je Tag ansehen und den Tag abschließen: Das gezählte Bargeld wird mit dem Kontostand verglichen, eine Differenz als Kassenfehlbetrag oder -überschuss gebucht.'],
      ['new', 'Lohnzettel als PDF (Stundenzettel → „Lohnzettel“): alle Gehaltsbuchungen des Monats mit Festgehalt, Bonusstunden und Bonus samt Summen.'],
      ['tech', 'Migration 041: `invoices` (Nummern `R-Jahr-NNNN` und `A-Jahr-NNNN`), `cash_registers` (ein Konto höchstens eine Kasse), `cash_closings`; Buchungsquellen `invoice` und `cash`. Rechenregeln in `src/invoices.js`, PDF-Grundgerüst in `src/pdf-doc.js`.'],
      ['new', 'Einsätze & Funk (Dienst → Einsätze & Funk): Einheiten mit Rufname, Besatzung und Fuhrpark-Fahrzeug, Status 1 bis 6 per Knopfdruck (die Besatzung setzt ihren eigenen). Einsätze mit Stichwort, Ort, Priorität und Lage; alarmierte Einheiten gehen auf Status 3, beim Freigeben oder Abschließen auf 1. Verlauf mit Lagemeldungen, Funkbuch mit allen Statuswechseln und Funksprüchen. „In Fallakte“ übernimmt einen Einsatz samt Einheiten und Verlauf als Eintrag in eine bestehende oder neue Fallakte. Die Lage aktualisiert sich alle 15 Sekunden.'],
      ['new', 'Fahndungsboard (Dienst → Fahndungsboard): alle aktiven Fahndungen als große Karten mit Foto, Name, Kennzeichen, Grund und Akte, filterbar nach Bereich und Suche, mit Vollbild für einen zweiten Bildschirm; aktualisiert sich jede Minute.'],
      ['new', 'Bußgeldrechner (Dienst → Bußgeldrechner): Tatbestände aus dem Strafkatalog ankreuzen, Anzahl wählen, Summe aus Geldstrafe, Haft und Punkten sehen, als Text kopieren oder mit einem Klick als Anklagepunkte zu einer beteiligten Person in eine Fallakte übertragen.'],
      ['tech', 'Migration 040: `dispatch_units`, `incidents` (Nummer `E-Jahr-NNNN`), `incident_units` (eine Einheit höchstens in einem laufenden Einsatz), `dispatch_log`. `GET /warrants` liefert zusätzlich `person_has_photo`.'],
      ['new', 'Dienstplan (Dienst → Dienstplan): Schichten je Organisation aus Vorlagen (Früh, Spät, Nacht – frei änderbar) für einen Zeitraum planen oder einzeln anlegen, mit Plätzen. Mitglieder tragen sich selbst ein, bieten Schichten zum Tausch an, übernehmen angebotene Schichten und melden sich krank (der Platz wird frei, die Planung bekommt eine Glocke). Die Planung teilt ein und sieht Abwesenheiten im Plan. Tab „Im Dienst“: laufende Schichten und wer gerade eingestempelt ist.'],
      ['new', 'Bewerbungen (Dienst → Personal): Mitglieder mit Recht legen Bewerber an (Kontakt, Gesprächstermin, Text, Notizen). Ist ein Benutzerkonto verknüpft, wird die Person beim Annehmen direkt Mitglied mit dem gewählten Rang (gleiche Regeln wie unter „Organisationen“) und bekommt den Eintrag „Eingestellt“.'],
      ['new', 'Personalakte (Dienst → Personal): Verlauf je Mitglied mit Beförderungen, Degradierungen, Belobigungen, Verwarnungen und Vermerken. Eine Beförderung kann den Rang sofort ändern; vorher und nachher stehen im Eintrag. Die eigene Akte sieht jedes Mitglied.'],
      ['new', 'Lager (Dienst → Lager): Ausrüstung wie Funkgeräte, Waffen und Westen mit Kategorie und Seriennummer (mehrere auf einmal mit fortlaufender Nummer), Ausgabe an Mitglieder mit Rückgabedatum, Rücknahme (auch als verloren oder in Wartung) und Verlauf. Jedes Mitglied sieht oben seine eigene Ausrüstung.'],
      ['tech', 'Migration 039: `shift_templates`, `shifts`, `shift_assignments`, `applications`, `application_notes`, `personnel_entries`, `equipment_items`, `equipment_issues`. Neue Glocken-Arten Dienstplan, Personalakte, Ausrüstung.'],
      ['new', 'Pinnwand (Dienst → Pinnwand): Ankündigungen an die ganze Organisation oder an einzelne Ränge (samt allen höheren), mit Markdown, Anheften, Glocke für alle Empfänger und „Gelesen von“ für die Schreibenden. Dazu Umfragen mit einer oder mehreren Antworten, anonym (nur Zahlen) oder namentlich, optional mit Ende; das Ergebnis siehst du nach deiner Stimme.'],
      ['new', 'Abwesenheiten (Dienst → Personal): Urlaub, krank, inaktiv oder sonstiges melden; jedes Mitglied meldet seine eigenen, die Leitung sieht alle und trägt auch für andere ein. Die Leitung bekommt eine Glocke.'],
      ['new', 'Discord: Unter „Organisationen → Discord“ hinterlegt die Leitung einen Discord-Webhook und wählt, was gemeldet wird (Ankündigungen, Umfragen, Abwesenheiten, Fahndungen, erledigte Fuhrpark-Runden, später Dienstplan, Einsätze, Bewerbungen und Rechnungen). Mit Testnachricht; @everyone und Erwähnungen werden nie ausgelöst, „krank“ erscheint dort nur als „abwesend“.'],
      ['new', 'Globale Suche oben in der Leiste (Strg+K): durchsucht Personen, Akten, Fahrzeuge, Fuhrpark, Notizen, Dokumentationen, Ankündigungen und Blitzer gleichzeitig, jeweils nur, was du sehen darfst. Pfeiltasten und Enter öffnen einen Treffer.'],
      ['tech', 'Migration 038: neue Funktionen für Organisationen (Pinnwand & Umfragen, Dienstplan, Abwesenheiten, Einsätze & Funk, Bewerbungen, Personalakte, Lager & Ausrüstung, Rechnungen, Kasse) mit Standardstufen für neue und bestehende Organisationen und passenden Rollenrechten; Tabellen `notices`, `notice_reads`, `polls`, `poll_votes`, `absences`, `team_discord` (Webhook verschlüsselt).'],
      ['new', 'Musik: Neue Seite unter „Zusammenarbeit → Musik“. Spotify steuern mit deinem eigenen Konto: jeder meldet sich selbst an, Abspielen, Pause, Weiter, Zurück, Zufall, Wiederholen, Lautstärke, Gerät wählen, eigene Playlists und Suche. Steuern erlaubt Spotify nur mit Premium; gespielt wird auf deinen Spotify-Geräten. Die Spotify-App trägt ein Admin unter „Server-Management → Integrationen“ ein (nur die Client-ID); wer möchte, hinterlegt seine eigene Spotify-App. Dazu „Vom Server“: Musik aus dem Musikordner des Servers und selbst hochgeladene Titel (mehrere Dateien auf einmal, in Ordnern) im Browser hören, mit Suche, Zufall und Wiederholen. Eigene Uploads lassen sich umbenennen und löschen. Die Wiedergabe läuft beim Seitenwechsel weiter.'],
      ['new', 'Musik → Spotify: eingebetteter Spotify-Player ohne Einrichtung. Spotify-Link einfügen und direkt abspielen; hat ein Admin die Spotify-App mit Client-Secret eingetragen, sucht das Feld Playlists, Alben und Titel ohne eigene Anmeldung. Ganze Titel hört, wer im selben Browser bei Spotify angemeldet ist, sonst kurze Vorschauen. Darüber „Empfehlungen“: ein kleines Dashboard mit eingebetteten Playlists, die Admins (Recht „Musik bearbeiten“) per Link hinzufügen, sortieren und entfernen.'],
      ['new', 'Dashboard (Design V2): Modul „Musik“ mit dem gerade laufenden Titel (Server oder Spotify) und den wichtigsten Knöpfen.'],
      ['new', 'Blitzer: Neue Seite unter „Organisation → Blitzer“, systemweit. Standorte fester und mobiler Blitzer mit Ort, erlaubtem Tempo, Notiz und je einem Bild (PNG oder JPEG), als Karten mit Suche und Filter Aktiv, Abgeschaltet, Alle.'],
      ['tech', 'Migrationen 033 bis 037: Spotify als dritter Anbieter in `provider_connections` mit Anmeldung per PKCE (kein Client-Secret), eigene Spotify-App je Benutzer; Tabellen `speed_cameras` (mit Bild, Migration 037), `music_files` (Uploads im Upload-Volume) und `music_recommendations` (Migration 036). Die CSP erlaubt Frames nur von `open.spotify.com`. Neue Rollenrechte `speedcam:read|create|update|delete` und `music:read|create|update|delete` (Rolle „User“ hat sie außer `music:update` und `music:delete`, eigene Rollen nicht automatisch). Neue Einstellungen `MUSIC_DIR`, `MUSIC_UPLOAD_MB` (Standard 50) und optional `SPOTIFY_CLIENT_ID`; der Musikordner wird nur lesend eingebunden.'],
    ],
  },
  {
    version: '1.3.4', date: '2026-11-12', migrations: '032', title: 'Schneller',
    changes: [
      ['changed', 'Schneller: Die Liste der Organisationen lädt mit einer festen Zahl von Abfragen statt mehrerer je Organisation, Seiten mit Auswahl einer Organisation laden nur noch Name und Rechte. Budgets, Kalender und Feiertage antworten schneller.'],
      ['changed', 'ToDo abhaken, Notiz anheften oder archivieren und „Alle gelesen“ in der Glocke wirken sofort, ohne auf den Server zu warten. Lehnt der Server ab, springt die Anzeige zurück und eine Meldung erscheint.'],
      ['changed', 'Bilder zu Fahrzeugen und Akten laden erst, wenn sie in den sichtbaren Bereich kommen.'],
      ['tech', 'Migration 032: Indizes für häufige Abfragen (u. a. Mitgliedschaften nach Benutzer, Termine, Daueraufträge, Sparziele, Umbuchungen je Konto). Neu: `GET /teams?brief=1` und das Messskript `tests/e2e/perf.mjs`.'],
    ],
  },
  {
    version: '1.3.3', date: '2026-11-12', migrations: '029–031', title: 'Sport mit Zeiten und Runden',
    changes: [
      ['changed', 'Sport ohne Punkte: Ergebnisse sind Zeiten im Format MM:SS:hh (Minuten, Sekunden, Hundertstel), z. B. 12:34:56. Die Zeit ist Pflicht; „12:34.56“ geht auch, eine dritte Nachkommastelle (Millisekunden) wird angezeigt, wenn sie gesetzt ist. Das Feld „Erreichte Checkpoints“ entfällt: Eine Zeit gilt nur mit allen Checkpoints der Strecke. Die Bestenliste sortiert nach der schnellsten Zeit; „Bestzeit“ ersetzt „Bestwert“. Vorhandene Zeiten bleiben erhalten, Punkte und erreichte Checkpoints entfallen.'],
      ['changed', 'Sportstrecken haben statt der Distanz eine Rundenanzahl: Name, Checkpoints und Runden, dazu wie bisher Notizen. Eine schon eingetragene Distanz steht jetzt in den Notizen der Strecke.'],
      ['tech', 'Migrationen 029 bis 031: Sportergebnisse speichern die Zeit in Millisekunden (`duration_ms`), die Spalten für Punkte, Sekunden und erreichte Checkpoints entfallen; Strecken haben `laps` statt `distance_km`.'],
      ['fixed', 'Design V2: Die Schrift im Hinweisfeld der Diagramme (Maus über dem Cashflow) war dunkel auf dunklem Grund. Sie hat jetzt immer die Kontrastfarbe zum Hintergrund, hell oder dunkel je nach Modus.'],
    ],
  },
  {
    version: '1.3.2', date: '2026-11-11', migrations: '027–028', title: 'Fuhrpark, Umbuchungen und Akten als PDF',
    changes: [
      ['new', 'Fuhrpark unter Organisation → Fuhrpark: Fahrzeuge der Organisation in Gruppen (z. B. „Tailgater 2“, „Sonstige Fahrzeuge“ mit Spalte Fahrzeug), Kontrollrunden mit Stand-Datum, km-Stand, letzter Wartung, Verbandkasten, Zubehör vollständig und Notiz. Eine neue Runde übernimmt die Werte der letzten. „Erledigt“ schließt die Runde ab; ändern lässt sie sich danach nur mit „Verwalten“ (steht im Audit-Log). „Als Markdown“ erzeugt die Liste im gewohnten Format zum Kopieren oder Herunterladen, auch für alte Runden. Unabhängig von Object Management → Fahrzeuge.'],
      ['new', 'Umbuchen unter Konten und Transaktionen: auf eigene Konten und Konten deiner Organisationen sofort, wenn du dort „Lesen & Schreiben“ hast. An andere Benutzer und auf Organisationskonten ohne dieses Recht geht die Umbuchung erst nach Annahme: Der Empfänger wählt sein Konto, gebucht wird erst dann. Offene Umbuchungen stehen oben auf Konten und Transaktionen; ablehnen und zurückziehen bucht nichts. Umbuchungen zählen als Ausgabe und Einnahme und lassen sich nicht ändern oder löschen.'],
      ['new', 'Akten als PDF: „PDF“ in einer Fallakte exportiert den Aktenkopf mit Sachverhalt und die angekreuzten Teile (Personen, Fahrzeuge, Verknüpfungen, Einträge, freigegebene Berichte, Anklagepunkte, Beweismittel mit Übergabekette, Fahndungen, Bilder, Anhänge als Liste). „PDF“ an einem Bericht exportiert ihn einzeln; Entwürfe tragen den Vermerk „ENTWURF“. Formatierter Text erscheint formatiert, jeder Export steht im Audit-Log.'],
      ['fixed', 'Dialoge auf dem Handy waren breiter als der Bildschirm, Knöpfe lagen teils außerhalb.'],
      ['tech', 'Migrationen 027 (Fuhrpark, Recht „Fuhrpark“ in Organisationen und Rollen) und 028 (Umbuchungen); das Image enthält die Schriften DejaVu für PDFs.'],
    ],
  },
  {
    version: '1.3.0', date: '2026-11-11', migrations: '024–026', title: 'Design V2, Personenakten zuerst, Prognose und Screenshot-Buchung',
    changes: [
      ['new', 'Design V2 „Glass“: Einstellungen → Darstellung → Design. Alle Seiten zeigen Glas-Panels über einem Hintergrund, die Navigation hat Symbole. Als Hintergrund wählst du eine Vorlage (Dämmerung, Nacht, Wald, ohne Bild) oder lädst ein eigenes Bild hoch, das nur du siehst. Unschärfe, Deckkraft der Panels und Abdunkeln stellst du mit Reglern ein; auf Handys gibt es auf Wunsch kräftige Flächen ohne Unschärfe. V1 bleibt unverändert, der Wechsel ist jederzeit möglich.'],
      ['new', 'Dashboard in V2 anpassen: Module ziehen oder mit Pfeilen verschieben, Breite wählen (schmal, halb, breit, ganze Breite), ausblenden und wieder hinzufügen; „Standard wiederherstellen“ setzt alles zurück. Neue Module für V2: Stundenzettel mit Stempeluhr, Konten, Sparziele und offene ToDos. Das Layout gilt für dich auf allen Geräten.'],
      ['new', 'Beim nächsten Login fragt die App einmal, welches Design du möchtest: V1 (klassisch) oder V2 (Glass). Ein Klick zeigt es sofort, „Übernehmen“ speichert, „Später“ lässt alles wie es ist. Der Dialog kommt danach nicht wieder; ändern kannst du das Design jederzeit unter Einstellungen → Darstellung.'],
      ['new', 'Einträge direkt in der Personenakte, ohne Fallakte: Datum, Art und Text mit Formatierung, bearbeiten und löschen mit „Lesen & Schreiben“ für Akten. Sie gehören wie Vermerke zum gewählten Bereich.'],
      ['new', 'Server-Management → Sicherheit & Einstellungen → Akten: Fallakten, Fahndung, Strafkatalog, Berichtsvorlagen und Aktenarten lassen sich für alle aus- und wieder einschalten. Ausgeschaltetes verschwindet aus Akten und Personenakten, die Daten bleiben erhalten. Fahndung, Vorlagen und Aktenarten gibt es nur mit Fallakten, Anklagepunkte nur mit Strafkatalog.'],
      ['new', 'Dashboard: Prognose für Einnahmen und Ausgaben dieser und nächster Woche aus gebuchten und vorausdatierten Buchungen, Daueraufträgen und Festgehalt, dazu für die restlichen Tage der Schnitt der letzten bis zu 8 Wochen.'],
      ['new', 'Transaktionen → „Screenshot scannen“: Screenshot der Bank-App wählen, mit Strg+V einfügen oder hineinziehen; die App liest Beträge, Datum und Text und schlägt Buchungen vor. Gebucht wird nur, was du prüfst und anhakst; schon Gebuchtes ist abgewählt. Die Texterkennung läuft auf dem Server, das Bild wird nicht gespeichert.'],
      ['changed', 'Handy: Tabellen werden auf schmalen Bildschirmen zu Karten mit beschrifteten Zeilen statt seitlich abgeschnitten, der Kalender startet dort in der Agenda, Kennzahlen stehen zu zweit nebeneinander, Formulare einspaltig. Das Menü schließt beim Tippen daneben, die Benachrichtigungen passen auf den Bildschirm, Eingabefelder zoomen auf dem iPhone nicht mehr.'],
      ['changed', 'Akten starten mit den Personenakten; der Tab „Personenakten“ steht vorn. Die Zahl am Tab „Fallakten“ zeigt Berichte, die auf deine Freigabe warten.'],
      ['fixed', 'Personenakte: Fahrzeuge (Besitzer) und ausgegebene Schlüssel fehlten, wenn sie in einem anderen Bereich lagen als die geöffnete Akte – etwa ein privates Fahrzeug in der Personenakte einer Organisation. Jetzt stehen alle, die du sehen darfst, mit ihrem Bereich daneben.'],
      ['fixed', 'Fahrzeug, Haus oder Schlüssel speichern, den jemand anderes gerade gelöscht hat, ergab einen internen Fehler; jetzt kommt „Nicht gefunden“.'],
      ['tech', 'Migrationen 024 (Einträge in der Personenakte), 025 (Darstellung V2 je Benutzer, eigenes Hintergrundbild im Upload-Volume) und 026 (Merker für den einmaligen Design-Dialog). Das Image enthält jetzt Tesseract (Texterkennung, Deutsch und Englisch); das erste Update baut deshalb etwas länger.'],
    ],
  },
  {
    version: '1.2.4', date: '2026-11-10', migrations: '023', title: 'Notiz-Tags und Archiv',
    changes: [
      ['new', 'Tags für Notizen: Eine Notiz kann beliebig viele Tags tragen (vorgegeben BLOCKED, INVALID, DONE und WIP), gesetzt über den Knopf „Tags“ oder im Formular. Der Notizblock filtert nach Tag, die Suche findet Tag-Namen.'],
      ['new', 'Notizen archivieren: Der Knopf „Archivieren“ nimmt eine Notiz aus der Ansicht „Offen“, „Wiederherstellen“ holt sie zurück. Oben rechts wechselst du zwischen Offen, Archiv und Alle. Das Archiv gilt für alle, die die Notiz sehen.'],
      ['new', 'Server-Management → Notiz-Tags: Tags anlegen, umbenennen, einfärben, sortieren und löschen (die Notizen bleiben).'],
      ['fixed', 'Das Update hing auf manchen Servern ohne Meldung beim Bauen („npm ci“), weil der Build-Container über Dockers Netz nicht ins Internet kam. Gebaut wird jetzt im Netz des Hosts; die laufenden Container bleiben in ihrem eigenen Netz.'],
    ],
  },
  {
    version: '1.2.3', date: '2026-11-10', migrations: '', title: 'Personen über die Personenakten',
    changes: [
      ['changed', 'Personen werden nur noch unter „Akten → Personenakten“ gepflegt; die Seite „Personen“ unter Object Management ist ausgeblendet, alte Links führen zu den Personenakten.'],
      ['new', 'Personenakten mit CSV-Export und -Import, „Person löschen“, Art und Funktion, Zahl der ausgegebenen Schlüssel und Filter „Inaktiv“.'],
      ['new', 'Abschnitt „Schlüssel“ in der Personenakte: ausgegebene und verlorene Schlüssel mit Objekt und Rückgabefrist.'],
    ],
  },
  {
    version: '1.2.2', date: '2026-11-10', migrations: '', title: 'Changelog',
    changes: [
      ['new', 'Seite „Changelog“ unter Administration mit allen Versionen seit 0.0.0, durchsuchbar und nach Art filterbar.'],
    ],
  },
  {
    version: '1.2.1', date: '2026-11-10', migrations: '022', title: 'Zinsen, Bilder und Fahrzeugbesitzer',
    changes: [
      ['new', 'Zinsen für Konten (optional, z. B. Sparkonto): Satz in Prozent pro Tag, Woche, Monat oder Jahr auf den durchschnittlichen Tagessaldo, gutgeschrieben am Ende jedes Zeitraums; gutgeschriebene Zinsen werden mitverzinst.'],
      ['new', 'Bilder zu Fahrzeugen mit Galerie, Großansicht und Bildunterschrift.'],
      ['new', 'Tab „Bilder“ in Akten: PNG- und JPEG-Anhänge mit Vorschau und Bildunterschrift.'],
      ['new', 'Fahrzeugbesitzer aus der Personenliste: Das Fahrzeug erscheint automatisch in der Personenakte und der Personenübersicht.'],
      ['new', 'Deadlines offener ToDos erscheinen im Kalender (eigener Filter) und im iCal-Abo.'],
      ['new', 'Suche nach Mitarbeitern im Stundenzettel der Organisation.'],
      ['changed', 'Ausgemusterte Fahrzeuge geben ihr Kennzeichen frei, fehlen im Dashboard und erinnern nicht mehr an Service oder Verbandskasten.'],
      ['changed', 'Persönliche Konten stehen zuerst und sind in allen Auswahllisten vorausgewählt.'],
      ['changed', 'Der Stundenzettel der Organisation zeigt die eigene Person nicht mehr.'],
      ['changed', 'Arbeitsstunden rechnen sich im Formular aus Beginn, Ende und Pause.'],
      ['changed', 'Personen, die Besitzer eines Fahrzeugs sind, lassen sich nicht löschen, nur deaktivieren.'],
    ],
  },
  {
    version: '1.2.0', date: '2026-11-09', migrations: '020–021', title: 'Aktensystem und Test im Tool',
    changes: [
      ['new', 'Fallakten wie bei Polizei und Rettungsdienst: Priorität, Tat- bzw. Einsatzzeit und -ort, Sachbearbeitung, Fahrzeuge und verknüpfte Akten.'],
      ['new', 'Berichte mit Vorlagen für Polizei, Rettungsdienst und allgemein; Freigabe nach dem Vier-Augen-Prinzip, Nachträge statt Änderungen.'],
      ['new', 'Strafkatalog mit CSV-Import und -Export; Anklagepunkte mit Entscheidung, Verurteilungen ergeben die Vorstrafen.'],
      ['new', 'Beweismittel mit Übergabekette, Fahndungen mit Fahndungsliste und Schnellabfrage.'],
      ['new', 'Personenakte je Bereich mit Foto, Stammdaten, Warnhinweisen, Vermerken und medizinischen Angaben; Akte, Bericht und Personenakte lassen sich drucken.'],
      ['new', 'Optionaler Test im Tool für Schulungen: Fragen mit einer oder mehreren richtigen Antworten, Bestehensgrenze, Zeitlimit, Versuche und Mischen.'],
    ],
  },
  {
    version: '1.1.1', date: '2026-11-09', migrations: '', title: 'Update ohne Änderung der .env',
    changes: [
      ['tech', 'Update mit „git pull“ und „docker compose up -d“: Das Image heißt nach der Code-Version und wird bei jedem Start gebaut; ein altes APP_VERSION in der .env zählt nicht mehr.'],
    ],
  },
  {
    version: '1.1.0', date: '2026-11-09', migrations: '017–019', title: 'Organisationen, Akten, Schulungen und Lizenzen',
    changes: [
      ['new', 'Akten mit Aktenzeichen, Status, beteiligten Personen, Einträgen und Anhängen; Aktenarten mit eigenen Rechten und beschränkte Akten.'],
      ['new', 'Schulungen mit Terminen, Teilnahme, Ergebnis und Nachweis; Lizenzen für Personen mit Gültigkeit, Sperre und Entzug; Dokumentationen mit eigenen Kategorien.'],
      ['new', 'Organisationen (vorher Teams) mit Rängen, Gruppen und Rechten pro Funktion; Stufe „Teilnehmen“ für Schulungen und Projekte.'],
      ['new', 'Gemeinsame Personenliste für das ganze System mit CSV-Import und -Export.'],
      ['new', 'Volles Markdown mit Werkzeugleiste, Vorschau, Nebeneinander-Ansicht und Vollbild.'],
      ['changed', 'Nachtschichten werden an Mitternacht geteilt: Stunden zählen am Kalendertag, an dem gearbeitet wurde.'],
      ['changed', 'Server-Management zeigt die installierte Code-Version.'],
      ['fixed', 'Ein fehlgeschlagenes Speichern der Darstellung wird gemeldet statt verschluckt.'],
      ['tech', 'Passen die Datenbank-Zugangsdaten nicht, erklärt das Log beim Start sofort den Ausweg, statt eine Minute zu warten.'],
    ],
  },
  {
    version: '1.0.0', date: '2026-11-08', migrations: '016', title: 'RP-Management-Board',
    changes: [
      ['changed', 'Die App heißt jetzt RP-Management-Board (vorher Budget Manager); ein selbst gewählter App-Name bleibt erhalten.'],
    ],
  },
  {
    version: '0.10.0', date: '2026-11-06', migrations: '014–015', title: 'Festgehalt, Notizblock und ToDos',
    changes: [
      ['new', 'Notizblock und ToDos, solo oder im Team; ToDos mit Deadline erinnern in der Glocke.'],
      ['new', 'Kommentare an Tickets.'],
      ['new', 'Dashboard wechselt zwischen Tag, Woche und Monat.'],
      ['changed', 'Gehalt als festes Tagesgehalt; Stunden über dem Wochen-Soll bringen einen Bonus in Prozent des Festgehalts.'],
      ['tech', 'Statische Dateien sind versioniert, damit nach einem Update nie alter und neuer Code gemischt wird.'],
    ],
  },
  {
    version: '0.9.0', date: '2026-11-05', migrations: '012–013', title: 'Budgets, Sport und Datenschutz',
    changes: [
      ['new', 'Budgets als Ausgabenlimits pro Tag, Woche, Monat oder Jahr.'],
      ['new', 'Sport-Bestenlisten für Laufen, Schwimmen und Biken.'],
      ['new', 'Datenschutzerklärung und Impressum, auch ohne Anmeldung erreichbar.'],
      ['changed', 'Gravatar nur noch mit Einwilligung; bestehende Einstellungen wurden zurückgesetzt.'],
      ['changed', 'Dashboard und Kontostand zeigen nur, was wirklich auf dem Konto ist (keine zukünftigen Buchungen).'],
      ['fixed', 'Hintergrundjobs, die abbrachen; der letzte aktive Admin kann sich nicht mehr aussperren.'],
      ['tech', 'End-to-End-Tests und Anleitung für KI-Assistenten (AGENTS.md).'],
    ],
  },
  {
    version: '0.8.0', date: '2026-11-03', migrations: '010–011', title: 'Tägliche Gehaltsgutschrift',
    changes: [
      ['new', 'Vergütung je Mitarbeiter und tägliche Gehaltsgutschrift auf ein gewähltes Konto.'],
      ['tech', 'Update-Skript scripts/update.sh.'],
      ['fixed', 'Verwaiste Daueraufträge aus Objektkosten werden bereinigt.'],
    ],
  },
  {
    version: '0.7.0', date: '2026-11-02', migrations: '', title: 'Wiederholungen mit Abstand',
    changes: [
      ['changed', 'Wiederholungen mit Abstand rechnen in Kalender, Dashboard und Formularen einheitlich.'],
      ['fixed', 'Monats- und Jahresserien rasten in kürzeren Monaten auf den letzten gültigen Tag ein, statt sich zu verschieben.'],
    ],
  },
  {
    version: '0.6.0', date: '2026-11-01', migrations: '009', title: 'Tickets und Benachrichtigungen',
    changes: [
      ['new', 'Gemeldete Fehler als Tickets in der Administration.'],
      ['new', 'Benachrichtigungen als Popup an der Glocke.'],
      ['changed', 'Objektkosten, Termine und geplante Berichte wiederholen sich mit wählbarem Abstand, z. B. alle 2 Wochen.'],
    ],
  },
  {
    version: '0.5.0', date: '2026-11-01', migrations: '008', title: 'Glocke und Fehler melden',
    changes: [
      ['new', 'Glocke mit Zähler für ungelesene Benachrichtigungen.'],
      ['new', '„Fehler melden“ für alle Benutzer.'],
      ['new', 'Tägliche Fahrzeugkosten.'],
    ],
  },
  {
    version: '0.4.0', date: '2026-11-01', migrations: '005–007', title: 'Objektverwaltung und geteilte Daueraufträge',
    changes: [
      ['new', 'Häuser mit verschlüsseltem Tür-PIN, Fahrzeuge mit Besitzer und Verbandskasten, benutzerdefinierte Intervalle in Tagen.'],
      ['new', 'Daueraufträge mit einem Teammitglied teilen.'],
      ['new', 'Wöchentliche Sollzeit je Mitarbeiter.'],
    ],
  },
  {
    version: '0.3.0', date: '2026-11-01', migrations: '004', title: 'Zeiterfassung und Integrationen',
    changes: [
      ['new', 'Zeiterfassung mit Timer, Pausen und Projekten.'],
      ['new', 'Google- und Microsoft-Verbindung für Kontakte und Kalender (nur lesend).'],
      ['new', 'Häuser, Fahrzeuge und Schlüssel privat oder für ein Team.'],
    ],
  },
  {
    version: '0.2.0', date: '2026-11-01', migrations: '002–003', title: 'Intervalle, Kilometer-Service und Gehalt',
    changes: [
      ['new', 'Tägliche und wöchentliche Intervalle.'],
      ['new', 'Fahrzeug-Service nach Kilometerstand.'],
      ['new', 'Sparziele mit Raten.'],
      ['new', 'Einnahmeart „Gehalt“ und erste Arbeitsstunden.'],
    ],
  },
  {
    version: '0.1.0', date: '2026-11-01', migrations: '', title: 'Ein Port und Dashboard-Übersicht',
    changes: [
      ['changed', 'Die API liefert die Oberfläche selbst aus: ein einziger Port, kein eigener Webserver oder Reverse-Proxy nötig.'],
      ['new', 'Schnellübersicht im Dashboard.'],
    ],
  },
  {
    version: '0.0.0', date: '2026-11-01', migrations: '001', title: 'Erster Stand',
    changes: [
      ['new', 'Docker-Stack mit API, Worker und PostgreSQL.'],
      ['new', 'Persönliche und Team-Konten mit Kategorien, Buchungen, Belegen, Daueraufträgen und Sparzielen; Dashboard und Berichte.'],
      ['new', 'Teams; Häuser, Fahrzeuge, Schlüssel und Personen mit Schlüsselausgabe.'],
      ['new', 'Kalender mit iCal-Abo, Benachrichtigungen.'],
      ['new', 'Rollen und Rechte, Gruppen, 2FA mit Wiederherstellungscodes, API-Schlüssel, Webhooks, Audit-Log und verschlüsselte Backups.'],
    ],
  },
];

export const CHANGE_TYPES = { new: 'Neu', changed: 'Geändert', fixed: 'Behoben', tech: 'Technik' };
