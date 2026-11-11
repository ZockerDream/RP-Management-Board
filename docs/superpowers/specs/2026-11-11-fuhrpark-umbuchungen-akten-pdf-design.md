# Entwurf: Fuhrpark, Umbuchungen, Akten als PDF

Stand 2026-11-11, aus dem Gespräch mit dem Auftraggeber. Drei unabhängige Funktionen, die nacheinander gebaut werden können (Vorschlag: Fuhrpark, Umbuchungen, PDF). Markiert sind Entscheidungen, die **ich** (Claude) getroffen habe, nicht der Auftraggeber: *(meine Wahl)*.

Es gelten alle Regeln aus `AGENTS.md` (Fallstricke, Doku-Pflicht, Changelog `UNRELEASED`, Tests auf `bm-check`).

---

## 1. Fuhrpark

### Wozu
Das Team des Fuhrparkmanagers einer Organisation kontrolliert regelmäßig alle Dienstfahrzeuge der Organisation und postet das Ergebnis als Markdown-Liste (z. B. in Discord). Bisher von Hand geschrieben. Die App soll die Kontrollrunden erfassen, speichern und die Liste genau im gewohnten Format erzeugen.

### Vorgaben des Auftraggebers
- **Eigener Bereich, unabhängig vom Objekt-Management.** Fuhrpark-Fahrzeuge sind keine `vehicles`; keine Verknüpfung, keine gemeinsamen Daten, keine Kalender-/Erinnerungs-Ableitungen aus `vehicles`.
- **Gehört immer zu einer Organisation** (kein Solo-Fuhrpark). Rechte über Rang, Gruppen, Mitglieder wie überall: neue Funktion `fleet` in `ORG_MODULES`.
- **Kontrollrunden werden gespeichert** und bleiben aufrufbar, samt Markdown-Ausgabe für alte Runden.
- **„Erledigt“** = alles vollständig und geprüft; gilt für die ganze Runde.
- **Abgeschlossene (erledigte) Runden lassen sich nachträglich ändern**, aber nur mit einem zusätzlichen Recht. *(meine Wahl: Stufe „Verwalten“ in `fleet`)*
- **Notizen sind reiner Text**, kein Markdown, keine Werkzeugleiste. (In der Markdown-Ausgabe werden `|` und Zeilenumbrüche maskiert bzw. durch Leerzeichen ersetzt, damit die Tabelle nicht bricht – *meine Wahl*.)
- „Rumpo Special“ ist einfach ein eigener Fahrzeugtyp (in-game Tag „Special“), keine Sonderlogik.

### Datenmodell *(Aufbau meine Wahl)*
- `fleet_groups` (team_id, name, sort, `show_model` boolean): Abschnitte der Ausgabe („Tailgater 2“, „Rumpo Espera“, „Sonstige Fahrzeuge“). `show_model` = Spalte „Fahrzeug“ in der Tabelle (wie bei „Sonstige Fahrzeuge“).
- `fleet_vehicles` (team_id, group_id, plate, model, sort, active, note): Kennzeichen eindeutig je Organisation unter aktiven Fahrzeugen. Ausgemusterte (`active=false`) erscheinen nicht in neuen Runden, bleiben in alten.
- `fleet_checks` (team_id, checked_on date = „Stand“, done boolean, done_at, done_by, created_by, created_at, updated_at).
- `fleet_check_items` (check_id, vehicle_id, plate/model/group-Name als Kopie zum Zeitpunkt der Runde, odometer_km, last_service_on date, first_aid_kit_until date, accessories_complete boolean, note text). Kopie der Stammdaten, damit alte Listen sich nicht ändern, wenn ein Fahrzeug umbenannt/umgruppiert wird.
- Reihenfolge der Ausgabe: Gruppen nach `sort`, darin Fahrzeuge nach `sort` (per Ziehen oder Pfeile änderbar).

### Abläufe
- **Fahrzeuge und Gruppen pflegen:** ab „Lesen & Schreiben“; löschen mit „Verwalten“ (Fahrzeuge mit Runden nur ausmustern, nicht löschen – *meine Wahl*).
- **Neue Runde:** ab „Lesen & Schreiben“. Datum vorbelegt mit heute. Für jedes aktive Fahrzeug eine Zeile, **vorbefüllt mit den Werten der letzten Runde** (km, letzte Wartung, Verbandskasten, Zubehör, Notiz). Man ändert nur, was abweicht.
- **Erfassen:** Tabelle je Gruppe, direkt editierbar, speichern zwischendurch möglich (Runde bleibt offen).
- **Erledigt setzen:** ab „Lesen & Schreiben“. Danach unveränderlich außer mit „Verwalten“ (auch „Erledigt“ zurücknehmen nur mit „Verwalten“). Änderungen an erledigten Runden ins Audit-Log *(meine Wahl)*.
- **Ausgabe:** Knopf „Als Markdown“ in jeder Runde: Vorschau + „Kopieren“ + Download `.md`. Ab „Lesen“.
- **Liste der Runden:** neueste oben, mit Datum, Erledigt-Status, Anzahl Fahrzeuge.
- Mehrere offene Runden gleichzeitig sind erlaubt *(meine Wahl; einfach)*.

### Markdown-Format (verbindlich, wie vom Auftraggeber geliefert)
```
Stand: 07.11.2026

Erledigt?: ✔️

### <Gruppenname>

|Kennzeichen|KM Stand|Letzte Wartung|Verbandkasten|Zubehör vollst.|Notizen|
|---|---|---|---|---|---|
|30 0V91M|13394|08.11.2026|25.11.26|✔️||
```
- Bei Gruppen mit `show_model`: Spalten `|Kennzeichen|Fahrzeug|KM-Stand|Letzte Wartung|Verbandkasten|Zubehör vollst.|Notizen|` (Schreibweise „KM-Stand“ mit Bindestrich genau so übernehmen).
- Datumsformate: „Stand“ und „Letzte Wartung“ `TT.MM.JJJJ`, Verbandkasten `TT.MM.JJ`.
- Zubehör: `✔️` wenn vollständig, sonst leer. „Erledigt?:“ `✔️` wenn erledigt, sonst leer (*meine Wahl*: `❌` wäre auch denkbar; leer entspricht der Vorlage am ehesten).
- Leere Werte bleiben leer. Kilometer ohne Tausenderpunkt.
- Gruppen ohne Fahrzeuge in der Runde entfallen.
- Die Zeile „Rumpo Special | - Unten - …“ in der Vorlage war ein Hinweis von Hand; sie wird **nicht** nachgebaut, „Rumpo Special“ ist einfach eine eigene Gruppe.
- Erzeugung in einer reinen Funktion ohne DOM und Datenbank (z. B. `fleet-markdown.js` im API-Code), mit Unit-Test, der die Vorlage oben reproduziert.

### Rechte (`fleet` in `ORG_MODULES`)
Stufen 0, 2, 3, 4: 2 = Fahrzeuge und Runden sehen, Markdown; 3 = Fahrzeuge/Gruppen pflegen, Runden anlegen, erfassen, erledigt setzen; 4 = erledigte Runden ändern, Fahrzeuge/Gruppen/Runden löschen. Neue Migration: `seed_team_ranks()` ergänzen und bestehenden Organisationen Zeilen geben: Leitung 4, Mitglied 2, Leser 2 *(meine Wahl: Kontrollieren soll nur das Fuhrpark-Team; die Organisation legt dafür eine Gruppe an und gibt ihr „Lesen & Schreiben“, es wird keine Gruppe automatisch angelegt)*. Appweites Katalogrecht `fleet:read|create|update|delete` analog zu `casefile`; Admin und User bekommen es per Migration, **eigene Rollen bekommen dieselben `fleet`-Rechte wie die Rolle User** *(meine Wahl, sonst sähe nach dem Update in Organisationen mit eigenen Rollen niemand den Fuhrpark)*.

### Oberfläche
Navigation „Organisation → Fuhrpark“ (`#/fleet`), Auswahl der Organisation wie bei anderen Organisationsseiten. Tabs: Runden | Fahrzeuge. Muss auf dem Handy (390 px) in V1 und V2 bedienbar sein.

### Nicht-Ziele
Keine Erinnerungen, keine Kalendertermine, keine Kosten, kein Bezug zu `vehicles`, keine Bilder.

---

## 2. Umbuchungen

### Wozu
Geld vom eigenen Konto auf ein Konto einer Organisation oder an andere Benutzer übertragen (und zwischen eigenen Konten).

### Vorgaben des Auftraggebers
- Ziele: **eigene Konten**, **Konten einer Organisation**, **beliebige Benutzer im System** (nicht nur Mitglieder derselben Organisation).
- **An andere Benutzer: wie beim Teilen von Daueraufträgen** – Empfänger nimmt an und wählt dabei sein Zielkonto, oder lehnt ab.
- **Organisationskonten:** Wer auf dem Organisationskonto „Lesen & Schreiben“ (`budget` ≥ 3) hat, bucht direkt ohne Bestätigung, in beide Richtungen (auch vom Organisationskonto weg). Wer das Recht nicht hat, kann trotzdem auf ein Organisationskonto einzahlen; die Organisation muss annehmen.

### Meine Wahl (zur Prüfung)
- **Zwischen eigenen Konten:** direkt.
- **Währung:** Quelle und Ziel müssen dieselbe Währung haben; beim Annehmen stehen nur passende Konten zur Wahl. Keine Umrechnung.
- **Ausstehende Umbuchung (Entscheidung des Auftraggebers):** Abgebucht wird **erst beim Annehmen**: Dann entstehen beide Buchungen zugleich (Ausgabe auf dem Quellkonto, Einnahme auf dem Zielkonto, Datum = Tag der Annahme). Bis dahin bucht nichts; abgelehnt oder zurückgezogen bleibt ohne Buchung. Es gibt keine Deckungsprüfung (Konten dürfen heute schon ins Minus) *(meine Wahl)*. Wird das Quellkonto gelöscht oder verliert der Absender das Buchungsrecht darauf, wird die offene Umbuchung beim Annehmen abgelehnt mit Meldung, und Konto löschen zieht offene Umbuchungen automatisch zurück *(meine Wahl)*. Der Absender sieht offene Umbuchungen als „ausstehend“ am Konto.
- **Annehmen bei Organisationen:** jedes Mitglied mit `budget` ≥ 3 auf dem Zielkonto; Benachrichtigung an alle, die es dürfen (`teamUsers`). Ziel ist dann das konkrete vom Absender gewählte Organisationskonto (keine freie Wahl beim Annehmen).
- **Empfänger-Suche:** Suche nach Anzeigename über alle aktiven Benutzer; zeigt nur Name (keine E-Mail) – Datenschutz. Neuer Endpunkt, nur für eingeloggte Benutzer mit Buchungsrecht.
- **Buchungen:** Neue Quelle `source = 'transfer'` und Spalte `transfer_id` auf `transactions`. Tabelle `transfers` (from_budget_id, to_budget_id NULL bis angenommen, to_user_id / to_team_id, amount, currency, note, status pending/accepted/declined/revoked, created_by, decided_by, booked_at, decided_at).
- **Auswertungen (Entscheidung des Auftraggebers):** Umbuchungen **zählen voll mit** – als normale Ausgabe bzw. Einnahme in KPIs, Kategorien, Budgets, Wochenprognose (auch Erfahrungswert) und Berichten. Keine Sonderfilter. Kategorie optional wählbar wie bei normalen Buchungen *(meine Wahl)*.
- **Welche Organisationskonten als Ziel (Entscheidung des Auftraggebers):** nur Konten von Organisationen, in denen man selbst Mitglied ist (`team_members`). Ohne `budget` ≥ 3 sieht man dabei nur Organisations- und Kontoname (keinen Saldo) und die Einzahlung braucht Annahme; mit `budget` ≥ 3 direkt. Beliebige Benutzer bleiben als persönliche Empfänger möglich.
- Umbuchungsbuchungen lassen sich nicht einzeln ändern oder löschen (sonst passen beide Seiten nicht mehr zusammen); eine ausstehende Umbuchung kann der Absender zurückziehen.
- Bei Annahme durch eine Organisation steht das Zielkonto schon fest (vom Absender gewählt); bei Annahme durch einen Benutzer wählt dieser ein eigenes persönliches Konto in passender Währung. Ein „Storno“ einer angenommenen Umbuchung gibt es nicht; man bucht zurück.
- Datum: heute (Server-Datum, siehe offener Punkt UTC), keine vorausdatierten Umbuchungen.
- Viewer (appweite Rolle ohne Buchungsrecht) dürfen nicht umbuchen.
- Neue Benachrichtigungsarten in `KINDS`: Umbuchung erhalten, angenommen, abgelehnt.
- Oberfläche: Knopf „Umbuchen“ auf Konten- und Transaktionsseite; Dialog mit Von-Konto, Ziel (Eigenes Konto / Organisationskonto / Benutzer), Betrag, Verwendungszweck. Offene eingehende Umbuchungen erscheinen dort, wo heute geteilte Daueraufträge angenommen werden, plus Glocke.
- `audit` für Umbuchungen an Fremde *(optional)*.

### Nicht-Ziele
Keine Umrechnung, keine Daueraufträge als Umbuchung (gibt es schon über geteilte Daueraufträge), keine Umbuchung auf Sparziele.

---

## 3. Akten als PDF

### Vorgaben des Auftraggebers
- **Ganze Akte exportieren**, „vernünftig formatiert“. Der **Aktenkopf ist immer ganz enthalten**; **weitere Teile sind ankreuzbar**.
- **Einzelnen Bericht exportieren.**
- Empfänger ist egal.

### Inhalt
**Kopf (immer):** Aktenzeichen, Titel, Aktenart, Bereich (Organisation/Solo), Status, Priorität, Ort, Tatzeit (`incident_at`), Eröffnet/Abgeschlossen, Sachbearbeitung, beschränkt ja/nein, Sachverhalt (`description`). Dazu Exportdatum und exportierende Person in Kopf- oder Fußzeile, Seitenzahlen „Seite x von y“.

**Ankreuzbar (Vorgabe alle an – *meine Wahl*):** Beteiligte Personen (mit Rolle), Fahrzeuge, Verknüpfungen, Einträge, Berichte (nur freigegebene; Entwürfe nie – *meine Wahl*; eingereichte nicht freigegebene? *meine Wahl*: nein), Anklagepunkte, Beweismittel samt Übergabekette, Fahndungen, Bilder (eingebettet, verkleinert, mit Bildunterschrift), Anhänge (nur als Liste mit Dateiname/Größe). Ausgeschaltete Teile des Aktensystems (`caseFeature`) erscheinen nicht zur Auswahl.

**Einzelbericht:** Aktenzeichen + Titel der Akte, Berichtsnummer, Art, Titel, Zeitpunkt, Verfasser, Status, Freigabe durch/am, ggf. „ergänzt Bericht Nr. …“, beteiligte Personen, Text. Exportierbar ist jeder Bericht, den man sehen darf (auch eigener Entwurf, dann groß „ENTWURF“ im Kopf – *meine Wahl*).

### Technik
- Serverseitig mit `pdfkit` (schon im Projekt, Stundenzettel). Kein neuer Build, kein Headless-Browser.
- Markdown-Texte werden **formatiert** gesetzt: Überschriften, Absätze, fett/kursiv/durchgestrichen, Listen, Aufgabenlisten, Zitate/Hinweis-Kästen, Code, Tabellen, Links als Text mit URL. Dafür einen Renderer auf Basis des vorhandenen `markdown.js`-Parsers (der läuft ohne DOM) schreiben, der statt HTML pdfkit-Aufrufe erzeugt; was nicht abbildbar ist, fällt auf Text zurück.
- Schrift mit Umlauten und `✔` (pdfkit-Standardschriften können kein Unicode jenseits WinAnsi): eine freie TTF (z. B. DejaVu Sans oder Noto Sans) ins Image legen bzw. ins Repo – *meine Wahl*.
- Rechte: wer die Akte lesen darf (`loadFile`), bekommt das PDF; alle Teile über `casefile-access.js`, nichts an den Prüfungen vorbei. Jeder Export ins Audit-Log *(meine Wahl; Akten sind sensibel)*.
- Endpunkte: `GET /case-files/:id/pdf?parts=people,entries,…` und `GET /case-file-reports/:id/pdf` (genaue Pfade an bestehende Routen anpassen; fallen unter die Schalter in `features.js`).
- Oberfläche: Knopf „PDF“ in der Akte → Dialog mit Häkchen; Knopf „PDF“ an jedem Bericht.

### Nicht-Ziele
Kein PDF für Personenakten (nicht gewünscht, später möglich), keine Signatur, kein Wasserzeichen.

---

## Offen für den Builder
Layout der PDF-Seiten, genaue Routennamen, Aufteilung in Dateien, UI-Details innerhalb der bestehenden Muster.
