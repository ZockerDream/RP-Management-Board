# RP-Management-Board – Konzept

Stand: entspricht der implementierten Anwendung. Die technische Umsetzung steht in [TECHNICAL.md](TECHNICAL.md).

## 1. Ziel
Webanwendung zur Verwaltung persönlicher und geteilter Konten, kombiniert mit Zeiterfassung, Sport-Bestenlisten und der Verwaltung von Häusern, Fahrzeugen, Schlüsseln und Personen. Rollen-/Rechtesystem, Teams, Dashboard, Daueraufträge und ein vollwertiger Kalender. Betrieb per Docker Compose, Datenhaltung in PostgreSQL.

## 2. Navigation und Seiten

| Gruppe | Seite | Inhalt |
|---|---|---|
| Finanzen | Dashboard | KPIs und Cashflow nach Tag, Woche oder Monat, Prognose für diese und nächste Woche, Kategorien, Budget-Auslastung, Fuhrpark, nächste Termine, letzte Buchungen |
| | Transaktionen | Alle Buchungen über Konten hinweg; Buchungen per Screenshot |
| | Stundenzettel | Allgemeine und Projektzeiten, Ein-/Ausstempeln, Gehalt einstellen, Monatsübersicht, Soll-/Überstunden, Vergütung und PDF-Export |
| | Konten | Persönliche und geteilte Konten mit Kontostand, Einkommen, Ausgaben und Kategorien |
| | Budgets | Ausgabenlimits pro Tag, Woche, Monat oder Jahr |
| | Daueraufträge | Wiederkehrende Ein- und Ausgaben |
| | Sparziele | Ziele mit Fortschritt, persönlich oder auf einem Konto einer Organisation |
| | Berichte | Auswertungen, Export, geplante Berichte |
| Zusammenarbeit | Kalender | Monat, Woche, Tag, Agenda |
| | Notizblock | Notizen solo oder in einer Organisation, anheften, durchsuchen |
| | ToDos | Aufgaben solo oder in einer Organisation, Deadline mit Benachrichtigung |
| Sport | Laufen, Schwimmen, Biken | Strecken der Organisation mit gemeinsamer Bestenliste |
| Object Management | Fahrzeuge, Häuser, Schlüssel | Je eine eigene Seite. Personen werden seit 2026-11-10 unter „Akten → Personenakten“ gepflegt (Abschnitt 6) |
| | Verwaltung | Übersicht, Kosten, Protokoll, Auditlog |
| Organisation | Organisationen | Mitglieder mit Rang und Gruppen, Rechte pro Funktion, eigene Rechte im Überblick |
| | Akten | Startseite Personenakten (mit eigenen Einträgen); Vorgänge mit Aktenzeichen, Aktenarten, beteiligten Personen, Einträgen und Anhängen; einzelne Akten beschränkbar. Fallakten, Fahndung, Strafkatalog, Berichtsvorlagen und Aktenarten systemweit abschaltbar |
| | Schulungen | Schulungen mit Terminen, Teilnahme, Ergebnis und Nachweis; Übersicht, wer was hat |
| | Lizenzen | Lizenzarten und Lizenzen von Personen mit Gültigkeit, Sperre und Entzug |
| | Dokumentationen | Nachschlagewerke wie Gesetze und Funktionen in selbst angelegten Kategorien |
| Administration | User-Management | Benutzer, Rollen & Rechte, Gruppen, Organisationen (nur Admins) |
| | Server-Management | Übersicht, Sicherheit & Einstellungen, System & Backups, Integrationen, Notiz-Tags, Audit-Log (nur Admins) |
| | Tickets | Gemeldete Fehler (nur Admins) |
| | Hilfe, Fehler melden | Für alle Benutzer |
| | Changelog | Alle Versionen seit 0.0.0, neueste oben als „Installiert“, mit Suche und Filter nach Art (Neu, Geändert, Behoben, Technik); für alle Benutzer. Vor 1.0.0 gab es keine Versionsnummern, die Stände 0.x sind nachträglich nummeriert (Wunsch des Auftraggebers vom 2026-11-10) |
| Konto | Einstellungen | Profil, Sicherheit, Darstellung, Benachrichtigungen, Sitzungen, API & Kalender |
| Rechtliches | Impressum, Datenschutz | Auch ohne Anmeldung erreichbar |

Ältere Links wie `#/assets?tab=keys` oder `#/admin` führen weiterhin auf die passende Seite. Der in den Einstellungen gepflegte App-Name erscheint in Seitenleiste, Login, Browser-Titel und auf den Rechtsseiten.

## 3. Administration

| Bereich | Tab | Funktionen |
|---|---|---|
| User-Management | Benutzer | Suche, Filter, Anlegen, Einladen, Bearbeiten, Sperren, Zugangsablauf (gilt bis einschließlich zum gewählten Tag), 2FA erzwingen oder zurücksetzen, Sitzungen beenden, CSV-Export; der letzte aktive Admin kann weder gesperrt noch befristet werden |
| | Rollen & Rechte | Eigene Rollen, Rechte-Matrix je Ressource, Datenbereich (alle, eigene Gruppen, eigene Daten), Kontolimit pro Benutzer, Standardrolle |
| | Gruppen | Mitglieder und Rollen, automatische Zuordnung per E-Mail-Domain, Gruppenleitung |
| | Organisationen | Alle Organisationen mit Ersteller, Mitgliederzahl und Status (nur Übersicht) |
| Server-Management | Übersicht | KPIs, Aktivität, Rollenverteilung, letzte Ereignisse |
| | Sicherheit & Einstellungen | Passwortlänge, Sperren, Sitzungsdauer, 2FA-Pflicht, Admin-IP-Allowlist, App-Name, Wartungsmodus, Registrierung, Standardwährung und -sprache, Aufbewahrungsfristen, Schalter für Teile der Akten (Abschnitt 9); SMTP-Test |
| | System & Backups | Geplante Jobs mit Status, manuelle Backups, Download, Löschen, Umgebungswerte (schreibgeschützt) |
| | Integrationen | Webhooks, API-Schlüssel aller Benutzer |
| | Notiz-Tags | Tags für den Notizblock anlegen, umbenennen, einfärben (Grau, Blau, Grün, Gelb, Rot), sortieren und löschen; zeigt, wie viele Notizen jeden Tag tragen. Löschen entfernt den Tag von allen Notizen, die Notizen bleiben |
| | Audit-Log | Filterbares Protokoll, CSV-Export |
| Tickets | – | Gemeldete Fehler, optional mit GitHub-Issue-Abgleich; kommentieren und löschen. Auch Melder kommentieren und löschen ihre eigenen Tickets unter „Fehler melden“. Kommentare bleiben intern, ein GitHub-Issue bleibt beim Löschen bestehen |

Rechte-Modell (RBAC): `User → Rollen (direkt oder über Gruppe) → Permissions`. Permissions sind feingranular als `ressource:aktion`, z. B. `user:create`, `budget:read`, `key:assign`. Systemrollen (`Admin`, `User`) sind fest; eigene Rollen sind frei definierbar.

## 4. Finanzfunktionen

### 4.1 Dashboard
Filter Solo / Organisation / Gesamt, Ansicht Tag / Woche / Monat und passender Zeitraum (14 Tage, 8 Wochen, 3 Monate zurück); der Browser merkt sich die Ansicht, die Woche beginnt mit dem Wochenstart aus dem Profil. KPI-Karten (Gesamtsaldo, Einnahmen, Ausgaben, Sparquote), Diagramme: Cashflow (Fläche, letzte 14 Tage, 8 Wochen oder 6 Monate), Ausgaben nach Kategorie (Donut), Budget-Auslastung (Gauges), dazu Fuhrpark (ohne ausgemusterte Fahrzeuge), nächste Termine und letzte Buchungen. Alle Diagramme sind SVG. Das Dashboard zeigt nur den echten Stand: Buchungen mit Datum in der Zukunft zählen erst ab diesem Datum, Sparziel-Einzahlungen ändern den Saldo nicht, weil das Geld auf dem Konto bleibt.

**Prognose (Wunsch des Auftraggebers vom 2026-11-10, Basis „Geplantes + Erfahrungswert“ ausdrücklich gewählt):** Eine Karte schätzt Einnahmen und Ausgaben dieser und der nächsten Woche (Wochenstart aus dem Profil) für denselben Kontenumfang wie der Filter Solo / Organisation / Gesamt. Sie zählt: gebucht (bis heute), vorausdatiert (nach heute), noch offene Ausführungen von Daueraufträgen (ab `next_run`; geteilte zählen auf jeder sichtbaren Seite), das Festgehalt für Tage ohne Gehaltsbuchung (nur das eigene, nur auf ein gültiges Gehaltskonto im Umfang) und eine Schätzung: der Schnitt pro Tag aus den letzten bis zu 8 abgeschlossenen Wochen seit der ersten Buchung, ohne Buchungen aus Daueraufträgen und ohne Festgehalt (der Bonus aus dem Gehaltslauf zählt mit), mal die Tage nach heute bzw. 7 für nächste Woche. Sparziel-Einzahlungen zählen nicht. Regeln in `forecast.js`.

### 4.2 Konten
Die Oberfläche nennt diese Finanzbereiche „Konten“; intern bleiben API und Datenbank aus Kompatibilitätsgründen bei `budgets` und `budget_id`. Zwei strikt getrennte Arten: `solo` (gehört einem User) und `shared` (gehört einem Team). Jede Karte zeigt Kontostand (Einkommen minus Ausgaben bis heute), Einkommen und Ausgaben. Das Formular fragt nur Name, Typ, Team und Währung ab; vorgeschlagen ist die Profilwährung, beim Ändern wird nichts umgerechnet. Ausgabenlimits werden als Budgets (4.3) gepflegt. Kategorien können eigene Limits haben. Persönliche Konten stehen in der Liste und in allen Auswahlfeldern vor den geteilten und sind damit vorausgewählt (Wunsch des Auftraggebers vom 2026-11-10).

**Zinsen (optional, Wunsch des Auftraggebers vom 2026-11-10, Modell am selben Tag bestätigt, Migration 022):** Ein Konto kann einen Zinssatz in Prozent je Zeitraum haben: pro Tag, Woche (Montag bis Sonntag), Monat oder Jahr. Am letzten Tag jedes abgeschlossenen Zeitraums wird eine Einnahme „Zinsen …“ gebucht, berechnet auf den durchschnittlichen Tagessaldo (Einnahmen minus Ausgaben, Sparziel-Einzahlungen zählen wie beim Kontostand nicht), kaufmännisch auf den Cent gerundet. Tage im Minus zählen als 0, gutgeschriebene Zinsen werden mitverzinst. Gezählt wird ab dem Tag des Einschaltens; ein geänderter Satz oder Zeitraum gilt für alles, was noch nicht gutgeschrieben ist. Gutgeschriebene Zeiträume werden nicht nachberechnet, auch nicht bei nachgetragenen Buchungen. Zinsgutschriften lassen sich nicht ändern, nur löschen; der Zeitraum bleibt dann gutgeschrieben. Einstellen darf, wer das Konto ändern darf; Änderungen stehen im Audit-Log. Beispiel: 2 % pro Monat, im November 15 Tage 1.000 und 15 Tage 2.000 → Durchschnitt 1.500 → 30,00 am 30.11.

### 4.3 Budgets
Ein Budget ist ein Ausgabenlimit: Name, Betrag und Zeitraum (Tag, Woche, Monat, Jahr), optional begrenzt auf ein Konto oder eine Kategorie. Die Karte zeigt laufenden Zeitraum, Verbrauch, Rest oder Überschreitung. Budgets gehören dem jeweiligen Benutzer; gezählt werden Ausgaben aller für ihn zugänglichen Konten, auch geteilter. Löschen eines Budgets lässt Buchungen unberührt.

### 4.4 Transaktionen
Gesamtliste mit Suche und Filtern (Konto, Kategorie, Zeitraum). Neue Buchung: Typ (Ausgabe, Einnahme, Einzahlung in ein Sparziel), Betrag, Konto, Kategorie, Datum, Tags, Notiz, Beleg. Export als CSV.

**Buchungen per Screenshot (Wunsch des Auftraggebers vom 2026-11-10, Texterkennung lokal ausdrücklich gewählt):** „Screenshot scannen“ nimmt ein PNG oder JPEG (Datei, Einfügen, Ziehen). Der Browser bereitet das Bild auf (vergrößern, lokaler Kontrast: Schrift wird schwarz auf weiß, egal ob hell auf dunkel oder farbig), der Server liest es mit Tesseract (Deutsch und Englisch) und verwirft es danach. Aus dem Text werden Vorschläge: je Zeile mit Betrag (Währung, Vorzeichen oder zwei Nachkommastellen; Kontostand-, Saldo- und Summenzeilen nicht) Datum, Text, Art und Betrag. Die Art kommt vom Vorzeichen, sonst von Wörtern (z. B. „Gehalt“, „von“, „erhalten“ gegen „Zahlung“, „an“, „gekauft“), sonst Ausgabe; das Datum aus der Zeile, der Zeile darunter („Heute, 14:32“) oder einer Datums-Überschrift, sonst heute. Geratene Art und geratenes Datum sind markiert. Datumsformate: deutsch mit Punkt, ISO, mit Schrägstrich (passen Tag/Monat und Monat/Tag, gilt das näher vor heute liegende), Monatsnamen, Heute/Gestern/Vorgestern. Gebucht wird nur, was der Benutzer anhakt, auf ein Konto mit Schreibrecht, als Quelle `import` („Import“ in der Liste). Vorschläge mit gleichem Konto, Datum, Art und Betrag wie eine vorhandene Buchung sind als „schon gebucht“ abgewählt. Regeln in `scan.js`.


### 4.5 Daueraufträge
Wiederkehrende Buchungen mit täglichem, wöchentlichem, monatlichem, jährlichem oder benutzerdefiniertem Tagesintervall. Für jeden Rhythmus kann ein Abstand festgelegt werden; Start/Ende und nächste Ausführung werden angezeigt, Aufträge sind pausierbar und bearbeitbar. Objektkosten aktualisieren den bestehenden verknüpften Auftrag statt Duplikate zu erzeugen. Ein persönlicher Dauerauftrag kann nach Annahme durch einen Team-Nutzer mit dem vollen Betrag auch in dessen persönlichem Konto verbucht werden; beide Konten müssen dieselbe Währung verwenden.

### 4.6 Sparziele
Zielbetrag, Zieldatum, Fortschrittsanzeige, Rate mit Rhythmus; persönlich oder auf einem Konto einer Organisation. Einzahlungen sind Buchungen vom Typ `deposit`.

### 4.7 Berichte
Vorlagen Monatsübersicht, Kategorien-Analyse, Objektkosten; Export; geplante Berichte mit Rhythmus und Empfängern per E-Mail.

### 4.8 Organisationen, Ränge, Gruppen und Rechte
Eine Organisation (früher „Team“; in Code, API und Datenbank weiter `team`) bündelt Mitglieder, geteilte Konten, Objekte, Akten, Schulungen, Lizenzen, Dokumentationen, Kalender, Notizen, ToDos, Stundenzettel-Projekte und Sportstrecken. Die Seite „Organisationen“ hat die Tabs Übersicht (eigener Rang, Gruppen und Rechte), Mitglieder, Ränge, Gruppen und Rechte.

- **Ränge:** Jedes Mitglied hat genau einen Rang; Ränge sind sortiert, der höchste steht oben. Neue Organisationen beginnen mit Leitung, Mitglied und Leser. Neue Ränge kommen ganz nach unten und haben noch keine Rechte. Ein Rang mit Mitgliedern lässt sich nicht löschen.
- **Gruppen:** frei benannte Zusammenschlüsse, z. B. Abteilungen; ein Mitglied kann in mehreren Gruppen sein.
- **Inhaber:** dürfen alles, unabhängig von Rang und Rechten; mindestens ein Inhaber bleibt. Nur Inhaber benennen weitere Inhaber, benennen die Organisation um, archivieren oder löschen sie.
- **Rechte pro Funktion** für Ränge, Gruppen und einzelne Mitglieder, in Stufen:

| Stufe | Bedeutung |
|---|---|
| Kein Zugriff | Die Funktion zeigt nichts aus dieser Organisation |
| Teilnehmen | Schulungen: Schulungen und Termine sehen, sich selbst an- und abmelden, keine Teilnehmer und Ergebnisse. Stundenzettel: auf Projekte der Organisation buchen |
| Lesen | sehen |
| Lesen & Schreiben | anlegen und ändern |
| Verwalten | zusätzlich löschen und Einstellungen wie Aktenarten, Lizenzarten, Kategorien |

Funktionen: Mitglieder & Ränge, Konten & Buchungen, Stundenzettel, Kalender, Notizblock, ToDos, Sport, Fahrzeuge, Häuser, Schlüssel, Akten, Schulungen, Lizenzen, Dokumentationen. Personen sind global (Abschnitt 6) und haben deshalb keine Rechte in der Organisation. Nicht jede Funktion kennt jede Stufe (Kalender, Notizblock und ToDos zum Beispiel nur Lesen und Lesen & Schreiben).

- **Verrechnung:** Es gilt das höchste Recht aus Rang und Gruppen. Ist für ein Mitglied persönlich etwas eingestellt, gilt genau das, auch wenn es weniger ist. Aktenarten und Doku-Kategorien haben eigene Zeilen; je Rang, Gruppe oder Mitglied geht die Zeile für die Art bzw. Kategorie der allgemeinen vor.
- **Hierarchie:** Wer bei „Mitglieder & Ränge“ Lesen & Schreiben hat, lädt ein, entfernt und vergibt Ränge und Gruppen; mit Verwalten bearbeitet er Ränge, Gruppen und Rechte. Nicht-Inhaber handeln nur unter dem eigenen Rang, ändern weder sich selbst noch Inhaber und vergeben nie mehr, als sie selbst haben (auch nicht über einen Rang oder eine Gruppe, die mehr darf).
- **Übernahme:** Bestehende Teams wurden mit Migration 018 übernommen: Owner wurden Inhaber mit Rang Leitung, Editoren Mitglied, Viewer Leser. Die Standardrechte entsprechen dem bisherigen Verhalten; Leser dürfen zusätzlich auf Projekte buchen.
- Die appweiten Rollen aus der Administration gelten zusätzlich: Fehlt dort zum Beispiel `casefile:read`, zeigt auch die Organisation keine Akten.

### 4.9 Zeiterfassung und Stundenzettel
Arbeitszeit kann unabhängig von Projekten per Start-/Pause-/Stopp-Timer oder manuell erfasst werden; Projektzeiten bleiben separat zugeordnet. Im Formular rechnen sich die Arbeitsstunden aus Beginn, Ende und Pause, sobald eins davon geändert wird (über Mitternacht und Ende 00:00 eingeschlossen); von Hand überschreiben bleibt möglich. Der Stundenzettel der Organisation zeigt alle anderen aktiven Mitglieder, nicht die eigene Person (deren Zeiten stehen schon oben), und hat eine Suche nach Namen (Wünsche des Auftraggebers vom 2026-11-10). Monatliche Stundenzettel zeigen allgemeine und projektbezogene Einträge getrennt sowie Gesamtstunden, Sollzeit, Überstunden und gutgeschriebene Vergütung. Das Monats-Soll ist Wochen-Soll × Kalendertage / 7. Pro Mitarbeiter gelten Festgehalt pro Tag, Wochen-Sollzeit und Bonus in Prozent des Festgehalts. Das Festgehalt wird unabhängig von den Stunden täglich einschließlich Wochenende um 03:45 Uhr für den Vortag auf ein eigenes persönliches Konto gebucht. Nur Stunden über dem Wochen-Soll (Montag bis Sonntag) bringen je Stunde zusätzlich den Bonus; montags beginnt die Zählung neu. Beispiel mit 1.669 Festgehalt, 13 Stunden Soll und 17 %: Bei 8 Stunden gibt es täglich 1.669, bei 15 Stunden kommen 2 × 283,73 dazu. Nachgetragene Stunden derselben Woche kommen mit der nächsten Gutschrift dazu; abgeschlossene Wochen werden nicht nachberechnet. Schichten über Mitternacht zählen am Kalendertag, an dem gearbeitet wurde: Timer und manuelle Einträge werden an Mitternacht in einen Eintrag je Tag geteilt (manuell: Ende vor Beginn; Stunden und Pause anteilig nach Dauer; beim Timer zählt eine laufende Pause genau, frühere Pausen anteilig). In der Nacht von Sonntag auf Montag gehören die Stunden nach Mitternacht damit zur neuen Woche. Der Gehaltslauf prüft stündlich und bucht den Vortag ab 03:45 Uhr; läuft dann noch ein Timer, der vor weniger als 24 Stunden gestartet wurde, wartet sein Starttag bis zum Ausstempeln. Timer über 24 Stunden lassen sich nicht ausstempeln, nur verwerfen. Das Gehaltskonto wählt jeder Mitarbeiter selbst, auf dem Stundenzettel unter „Gehalt einstellen“ oder im Profil. Wählbar sind eigene persönliche Konten in Profilwährung; Konten einer Organisation und Konten in anderer Währung stehen mit Begründung in der Liste, fehlt ein passendes Konto, nennt ein Hinweis den nächsten Schritt.

## 5. Sport

Getrennte Seiten für Laufen, Schwimmen und Biken. Eine Strecke gehört einer Organisation und hat Name, Checkpoints, optional Distanz und Notizen. Ergebnisse bestehen aus Punkten, optional Zeit (mm:ss oder h:mm:ss), erreichten Checkpoints, Datum und Notiz. Die Bestenliste sortiert nach Punkten absteigend, bei Gleichstand nach Zeit.

| Recht bei Sport | Strecken | Ergebnisse |
|---|---|---|
| Lesen & Schreiben | anlegen, bearbeiten, löschen | eintragen, eigene und fremde löschen |
| Lesen | ansehen | eintragen, eigene löschen |
| Kein Zugriff, nicht Mitglied | nicht sichtbar | nicht möglich |

## 6. Objekte: Fahrzeuge, Häuser, Personen, Schlüssel

Fahrzeuge, Häuser und Schlüssel sind privat oder pro Datensatz einer Organisation freigegeben. Dort gilt je Objektart das Recht der Organisation: ändern ab Lesen & Schreiben, löschen mit Verwalten. Personen sind dagegen global (Entscheidung des Auftraggebers vom 2026-11-09, Migration 019).

1. **Fahrzeuge** – Marke/Modell, Kennzeichen, Besitzer, Service-Termin und/oder -Kilometerstand, Verbandskasten-Ablaufdatum, Status (verfügbar, im Einsatz, Werkstatt, ausgemustert), zugeordnete Schlüssel und Bilder. Eine Versicherungsangabe gibt es nicht. Wünsche des Auftraggebers vom 2026-11-10 (Migration 022):
   - **Besitzer als Person:** Der Besitzer wird aus der globalen Personenliste gewählt; das Fahrzeug erscheint dann automatisch in seiner Personenakte (je Bereich: Fahrzeuge desselben Bereichs, soweit sichtbar) und in der Personenübersicht. Für Besitzer ohne Personeneintrag bleibt ein Textfeld. Bei der Umstellung wurden Texte, die genau einen Personennamen treffen, zugeordnet. Personen, die Besitzer eines Fahrzeugs sind, lassen sich nicht löschen.
   - **Ausgemustert:** Das Kennzeichen ist nur unter nicht ausgemusterten Fahrzeugen eines Bereichs eindeutig; ein ausgemustertes gibt es frei. Wer ein ausgemustertes wieder in Betrieb nimmt, dessen Kennzeichen inzwischen vergeben ist, bekommt eine Meldung. Ausgemusterte Fahrzeuge fehlen im Dashboard, stehen in der Liste hinten und erzeugen keine Service- und Verbandskasten-Termine oder -Erinnerungen mehr.
   - **Bilder:** PNG und JPEG mit Bildunterschrift (höchstens 50 je Fahrzeug), Raster mit Vorschau und Großansicht. Sehen, wer das Fahrzeug sieht; hochladen, beschriften und löschen ab „Lesen & Schreiben“. Mit dem Fahrzeug werden die Bilder gelöscht.
2. **Häuser** – Name, Typ (Wohnhaus, Büro, Lager, Ferienobjekt), Adresse, verantwortliche Person, Wartung, verschlüsselter Tür-PIN (Anzeige nach Passwort-/2FA-Bestätigung und protokolliert), Notizen und zugeordnete Schlüssel.
3. **Personen** – Mitarbeitende, Externe und Familie, auch ohne Panel-Zugang. Dient dem Nachverfolgen, wer was hat. **Gepflegt werden Personen allein unter „Akten → Personenakten“** (Wunsch des Auftraggebers vom 2026-11-10): Die Liste dort enthält alle Personen mit Art, Funktion, Zahl der ausgegebenen Schlüssel und Filter „Inaktiv“; dazu „Neue Person“, CSV-Export und -Import, in der Akte „Stammdaten“, „Foto“, „Person löschen“ und ein Abschnitt „Schlüssel“ (ausgegebene und verlorene Schlüssel des Bereichs). Die frühere Seite „Personen“ unter Object Management ist ausgeblendet; `#/assets-people` und `#/assets?tab=people` führen zu den Personenakten. Wer Personen pflegt, braucht deshalb auch Zugriff auf Akten (`casefile:read`); verwenden lassen sich Personen in Schlüsseln, Häusern und Fahrzeugen weiterhin allein mit `person:read`. Es gibt **eine gemeinsame Personenliste für das ganze System**: Jeder mit `person:read` sieht alle Personen und kann sie überall verwenden – bei Schlüsselausgabe, als Verantwortliche eines Hauses, in Akten, Lizenzen und Schulungen jeder Organisation und solo. Personen gehören keiner Organisation und sind nie privat. Anlegen, Ändern und Löschen regeln allein die Rollenrechte `person:create|update|delete` aus der Administration (die Systemrolle User hat sie); jede Änderung steht im Audit-Log. Die „Übersicht“ einer Person zeigt ihre Akten, Einträge, Lizenzen und Schulungen, soweit die eigenen Rechte reichen; Unterlagen einer fremden Organisation bleiben verborgen. Personen mit Akten, Lizenzen, Schulungsnachweisen oder Fahrzeugen lassen sich nicht löschen, nur deaktivieren. Wird ein Team oder ein Benutzer gelöscht, bleiben die Personen bestehen; die Akten, Lizenzen und Nachweise des Teams gehen mit. Bei der Umstellung (Migration 019) wurden bisher private und Organisations-Personen unverändert in die gemeinsame Liste übernommen, gleichnamige Personen also nicht zusammengeführt.
   **CSV-Export und -Import:** Der Export (`person:export`) enthält ID, Name, Art, Funktion, Telefon, E-Mail, Aktiv (ja/nein) und Notiz mit deutschen Überschriften und Werten und lässt sich unverändert wieder einlesen. Der Import (`person:create`) prüft zuerst und zeigt, was passiert; erst danach wird geschrieben. Regeln: Zeilen mit ID ändern genau diese Person (dafür zusätzlich `person:update`) und nur in den Spalten der Datei; Zeilen ohne ID legen neu an, außer es gibt den Namen (ohne Groß-/Kleinschreibung) schon oder er steht mehrfach in der Datei, dann wird die Zeile übersprungen. Fehlerhafte Zeilen fallen mit Zeilennummer und Grund heraus, der Rest wird übernommen. Erkannt werden Semikolon, Komma und Tab, UTF-8 und Windows-1252; höchstens 10.000 Personen je Datei. Export und Import stehen im Audit-Log.
4. **Schlüssel** – gehört zu einem Haus oder Fahrzeug, hat eine frei eingebbare Art und eine Anzahl Kopien. Inventur zeigt Gesamtbestand, Ausgaben und Verluste; QR-Codes öffnen den Schlüssel. Ausgabe und Rückgabe mit Datum, Person, Quittierung und optionaler Rückgabefrist. Status: ausgegeben, im Safe, überfällig, verloren.
5. **Verwaltung** – Übersicht (KPIs, Handlungsbedarf), Kosten, Protokoll je Schlüssel und Auditlog (mit Recht `audit:read`).
6. **Optionaler Preis & Kontoverfolgung** – Haus, Fahrzeug und Schlüssel haben ein optionales Preisfeld: Betrag, Intervall (einmalig, täglich, wöchentlich, monatlich, jährlich oder benutzerdefinierte Tage), Abstand, Konto, Kategorie, Schalter „im Tracking“. Mit Preis erzeugt das System bei „einmalig“ genau eine Buchung, sonst einen Dauerauftrag; Preisänderungen aktualisieren den Auftrag statt Duplikate zu erzeugen.

## 7. Kalender

Ansichten Monat, Woche, Tag und Agenda, Navigation vor/zurück/heute.

- **Automatische Termine** (abgeleitet, nur lesbar): Daueraufträge und Zahlungen, Service der Fahrzeuge (nicht ausgemusterte), Rückgabefristen von Schlüsseln, Wartungen von Häusern, Schulungstermine, Ablauf von Lizenzen und Schulungsnachweisen, Deadlines offener ToDos (eigener Filter „ToDo-Deadlines“, Wunsch des Auftraggebers vom 2026-11-10), Feiertage.
- **Erinnerungen:** Ein täglicher Job weist auf Termine, Fahrzeug-Service, Verbandskasten, Schlüsselrückgaben sowie ablaufende Lizenzen und Schulungsnachweise hin (30 Tage vorher und nach dem Ablauf); sie erscheinen als Benachrichtigung in der Glocke.
- **Eigene Termine:** Organisation oder Privat, ganztägig oder mit Beginn/Ende, Wiederholung mit Abstand, Erinnerung (1/3/7/14 Tage vorher), optionaler Betrag, Notiz. Monats- und Jahresserien fallen in kürzeren Zeiträumen auf den letzten gültigen Tag.
- **iCal-Abo** zum Einbinden in externe Kalender; Google und Microsoft können lesend importiert werden.

## 8. Notizblock und ToDos

Beide gehören entweder einer Person (Solo) oder einer Organisation. Mit Lesen & Schreiben darf man ändern, mit Lesen nur lesen; die Oberfläche blendet die Aktionen dann aus. Die Sichtbarkeit lässt sich beim Bearbeiten ändern.

- **Notizblock:** Titel und/oder Text, anheften, archivieren, Suche über Titel, Text und Tags. Jede Notiz zeigt, wer sie zuletzt wann bearbeitet hat; Anheften, Archivieren und Tags zählen nicht als Bearbeitung.
- **Archiv (Wunsch des Auftraggebers vom 2026-11-10):** Knopf „Archivieren“ bzw. „Wiederherstellen“ für alle, die die Notiz bearbeiten dürfen; Umschalter „Offen | Archiv | Alle“ neben „Alle | Solo | Organisation“, Vorgabe „Offen“. Archivieren gilt für alle, die die Notiz sehen, zeigt Zeitpunkt und Namen, löst das Anheften und zählt nicht als Bearbeitung; archivierte Notizen lassen sich bearbeiten, aber nicht anheften.
- **Notiz-Tags (Wunsch des Auftraggebers vom 2026-11-10):** Tags gelten systemweit und werden nur im Server-Management verwaltet; vorgegeben sind BLOCKED, INVALID, DONE und WIP. Eine Notiz trägt beliebig viele davon; setzen darf sie, wer die Notiz bearbeiten darf. Tags sind reine Markierung: farbiges Abzeichen auf der Karte und Filter „Alle Tags / Ohne Tag / <Tag>“, ausgeblendet oder umsortiert wird nichts.
- **ToDos:** Aufgabe, Notiz, optionale Deadline, abhaken mit Name und Zeitpunkt. Die Liste gruppiert nach Überfällig, Heute, Demnächst, Ohne Deadline und Erledigt. Offene ToDos mit Deadline erscheinen automatisch als ganztägiger Termin „ToDo: …“ im Kalender und im iCal-Abo, für alle, die das ToDo sehen; erledigte verschwinden dort.
- **Benachrichtigungen:** Zu offenen ToDos mit Deadline erscheint einen Tag vorher, am Fälligkeitstag und einmal bei Überfälligkeit eine Meldung in der Glocke. ToDos einer Organisation erreichen alle Mitglieder, die sie lesen dürfen. Art `todo_due`, in den Einstellungen abschaltbar und optional per E-Mail.

## 9. Akten, Schulungen, Lizenzen und Dokumentationen

Alle vier gehören einer Person (Solo) oder einer Organisation; die Sichtbarkeit wird beim Anlegen gewählt und bleibt danach fest. Was Mitglieder dürfen, regeln die Rechte der Organisation (Abschnitt 4.8), Fremde sehen nichts. Zusätzlich gelten die Rechte `casefile:*`, `training:*`, `license:*` und `doc:*` (Systemrollen Admin und User haben sie). Personen sind global: Jede Person lässt sich in jedem Bereich beteiligen, als Teilnehmer eintragen oder als Lizenzinhaber wählen. Benutzer als Teilnehmer müssen dagegen zum selben Bereich gehören: in einer Organisation deren Mitglieder, solo man selbst. Änderungen stehen im Audit-Log.

- **Akten:** Aktenzeichen (frei oder automatisch `Jahr-laufende Nummer`, eindeutig je Bereich), Titel, Sachverhalt, Status offen, ruhend oder abgeschlossen mit Eröffnungs- und Abschlussdatum. Beteiligte Personen mit Rolle, chronologische Einträge mit Datum, Art und optional betroffener Person, Anhänge (PDF, PNG, JPEG wie bei Belegen). PNG- und JPEG-Anhänge erscheinen als **Bilder** in einem eigenen Tab mit Vorschau, Großansicht und Bildunterschrift (Wunsch des Auftraggebers vom 2026-11-10); der Tab „Anhänge“ zeigt die übrigen Dateien. Wird eine Person aus der Akte entfernt, bleiben ihre Einträge ohne Personenbezug erhalten. Suche über Aktenzeichen, Titel, Sachverhalt und beteiligte Personen, Filter nach Status und Aktenart. **Aktenarten** (z. B. Ermittlungsakte, Personalakte) legt an, wer bei Akten Verwalten hat; jede Art kann in der Organisation eigene Rechte bekommen. Eine benutzte Art lässt sich nicht löschen, eine Art wechseln nur mit Verwalten. **Beschränkte Akten:** Wer eine Akte verwalten darf, beschränkt sie auf Ränge (samt allen höheren), Gruppen und einzelne Mitglieder; Inhaber und wer sie angelegt hat, sehen sie immer, und niemand kann sich dabei selbst aussperren. Fällt ein gewählter Rang oder eine Gruppe weg, bleibt die Akte beschränkt.
- **Aktensystem (Migration 020, Wunsch des Auftraggebers vom 2026-11-09):** „wie ein richtiges Aktensystem bei Polizei, Medics und Co.“
  - *Fallakte* zusätzlich mit Priorität (niedrig, normal, hoch, dringend), Tat- bzw. Einsatzzeit und -ort, Sachbearbeitung (Mitglied der Organisation), Fahrzeugen (Kennzeichen, Beschreibung, Rolle, Halter) und verknüpften Akten desselben Bereichs. Suche auch über Ort, Alias und Kennzeichen; Liste mit dringenden Akten oben.
  - *Berichte* mit laufender Nummer (B-1, B-2 …), Art, Zeitpunkt, betroffenen Personen und Text. Ablauf: Entwurf (sehen nur Verfasser und wer freigibt) → eingereicht → freigegeben oder mit Begründung zurück. Freigeben mit „Verwalten“ nach dem Vier-Augen-Prinzip (eigene nur als Inhaber); freigegebene Berichte sind unveränderlich und unlöschbar, Korrekturen als Nachtrag. Privat schließt Einreichen den Bericht ab. Meldungen `report_review` und `report_decided`. *Berichtsvorlagen* je Bereich, fertige Sätze für Polizei, Rettungsdienst und allgemein.
  - *Strafkatalog* je Bereich (Paragraph, Bezeichnung, Kategorie, Geldstrafe, Haft in Hafteinheiten, Punkte, aktiv), pflegen mit „Verwalten“, CSV-Import mit Prüfung (vorhandene Paragraphen werden aktualisiert) und Export. *Anklagepunkte* gegen beteiligte Personen aus dem Katalog oder frei, mit Anzahl; sie halten den Katalogstand fest. Erfassen mit „Lesen & Schreiben“, Entscheidung (verurteilt, eingestellt, freigesprochen) mit „Verwalten“; Verurteilte ergeben die Vorstrafen.
  - *Beweismittel* je Akte nummeriert (A-1 …) mit Art, Fundort, Fundzeit, Person, Lagerort und Status (sichergestellt, in Untersuchung, eingelagert, herausgegeben, vernichtet); jede Übergabe und jeder Statuswechsel landet in einer Übergabekette, die sich nur fortschreiben lässt. Löschen nur mit „Verwalten“.
  - *Fahndungen* in einer Akte: Haftbefehl, Durchsuchungsbeschluss, Aufenthaltsermittlung (beteiligte Person) oder Fahrzeugfahndung (Kennzeichen), optional befristet; vollstrecken, aufheben, wieder aktivieren. Fahndungsliste über alle sichtbaren Akten mit Abfrage nach Name, Alias, Kennzeichen.
  - *Personenakte* je Bereich: global die Stammdaten der Person (Geburtsdatum, Geschlecht, Größe, Staatsangehörigkeit, Adresse, Alias, Merkmale, Foto), je Bereich Warnhinweise, Vermerke und medizinische Angaben; dazu Fahndungen, Vorstrafen mit Summen, Akten, Berichte, Beweismittel, Fahrzeuge als Halter, Einträge, Lizenzen und Schulungen, jeweils nur soweit sichtbar. Bearbeiten mit „Lesen & Schreiben“ bei Akten; Stammdaten und Foto mit `person:update`.
  - *Personenakten als Startseite* (Wunsch des Auftraggebers vom 2026-11-10): „Akten“ öffnet die Personenakten, ihr Tab steht vorn; die Zahl am Tab „Fallakten“ zeigt Berichte, die auf die eigene Freigabe warten.
  - *Einträge in der Personenakte* (Wunsch vom 2026-11-10, Migration 024): datierte Einträge mit Art und Markdown-Text direkt an der Person, ohne Fallakte. Sie gehören wie die Vermerke einem Bereich und folgen dessen Recht für Akten (lesen ab „Lesen“, anlegen, ändern und löschen ab „Lesen & Schreiben“); andere Bereiche sehen sie nicht. Eine Person mit Einträgen lässt sich nicht löschen. Die Einträge aus Fallakten stehen getrennt darunter.
  - *Fahrzeuge und Schlüssel* in der Personenakte (Fehler vom 2026-11-10 behoben): Sie gehören der Objektverwaltung, nicht dem Aktenbereich. Gezeigt werden alle, die man sehen darf, mit ihrem Bereich („Privat“ oder Name der Organisation), egal welcher Bereich für die Akte gewählt ist. Vorher fehlte etwa ein privates Fahrzeug in der Personenakte der Organisation.
  - *Teile ausschalten* (Wunsch vom 2026-11-10, systemweit ausdrücklich gewählt): Unter Server-Management → Sicherheit & Einstellungen → Akten schalten Admins Fallakten, Fahndung, Strafkatalog, Berichtsvorlagen und Aktenarten aus. Fahndung, Vorlagen und Aktenarten hängen an Fallakten; Anklagepunkte und Vorstrafen brauchen Fallakten und Strafkatalog; der Strafkatalog allein bleibt zum Nachschlagen möglich. Ausgeschaltet verschwinden Tabs und Abschnitte (auch in der Personenakte und in der Fallakte), die API antwortet mit 403 `disabled`; Daten bleiben und sind nach dem Einschalten wieder da. Ohne Aktenarten behalten vorhandene Akten ihre Art und deren Rechte, neue Akten bekommen keine. Personenakten mit ihren Einträgen lassen sich nicht ausschalten.
  - Alles an einer Akte erbt deren Sichtbarkeit (Aktenart, Beschränkung). Drucken von Akte, Bericht und Personenakte.
- **Lizenzen:** Frei anlegbare Lizenzarten mit optionaler Standard-Gültigkeit in Monaten. Eine Lizenz gehört einer Person und hat Nummer, Aussteller, Ausstellungsdatum, Ablauf (leer: Standard-Gültigkeit, auch unbefristet möglich) und Status gültig, gesperrt oder entzogen mit Begründung. Angezeigt wird zusätzlich „läuft bald ab“ (30 Tage) und „abgelaufen“. Verlängern rechnet die Standard-Gültigkeit ab dem bisherigen Ablauf oder ab heute. Benachrichtigungsart `license_expiry`.
- **Schulungen:** Name, Beschreibung, optionale Gültigkeit in Monaten, aktiv oder inaktiv. Termine mit Datum, Zeit, Ort und Ausbilder. Teilnehmer sind Benutzer oder Personen, je Termin höchstens einmal; Ergebnis angemeldet, bestanden, nicht bestanden oder nicht erschienen. Ein bestandener Nachweis gilt ab dem Abschlussdatum (leer: Termin oder heute) für die Gültigkeit der Schulung. Die Übersicht zeigt je Teilnehmer und Schulung den neuesten bestandenen Nachweis. Mitglieder mit „Teilnehmen“ melden sich für kommende Termine selbst an und wieder ab, solange noch kein Ergebnis eingetragen ist; Teilnehmer, Ergebnisse, Zahlen und die Übersicht sehen sie nicht und bekommen keine Ablauf-Erinnerungen. Benachrichtigungsart `training_expiry`, nur für den jeweils neuesten Nachweis.
  - *Test im Tool* (Migration 021, optional je Schulung): Ohne Test reichen Teilnahme und „bestanden“ durch den Ausbilder. Mit Test bestehen Benutzer nur über den Test, Personen ohne Zugang weiter von Hand. Einstellungen: Bestehensgrenze in Prozent der Punkte (Standard 70), optional Zeitlimit (1–600 Minuten) und Versuche je Person, Fragen und Antworten mischen (Standard an), Test erst nach Teilnahme an einem Termin (heute oder früher). Fragen mit einer oder mehreren richtigen Antworten (2–8 Antworten, 1–100 Punkte, Erklärung nur für Ausbilder); eine Frage zählt nur, wenn genau die richtigen Antworten gewählt sind, Teilpunkte gibt es nicht. Prozent werden abgerundet. Wer die Schulung sieht, startet den Test (auch mit „Teilnehmen“), solange er aktiv ist, Fragen hat, Versuche übrig sind und kein bestandener Nachweis länger als 30 Tage gilt. Ein Versuch hält Reihenfolge und Antworten fest; ein erneuter Start setzt den offenen Versuch fort. Abgabe nach Fristende plus 30 Sekunden Kulanz zählt als „Zeit abgelaufen“ (nicht bestanden); vergessene Versuche laufen beim nächsten Abruf ab. Das Ergebnis wird in die offene Teilnahme eingetragen (bevorzugt die eines vergangenen Termins), sonst entsteht ein Nachweis „Test im Tool“; bestanden mit Gültigkeit der Schulung. Sichtbar: eigene Versuche immer, alle Versuche mit Punkten ab „Lesen“, Antworten im Einzelnen und Zurücksetzen ab „Lesen & Schreiben“ (zurückgesetzte Versuche zählen nicht mehr, bleiben aber sichtbar), Fragen mit Lösung nur mit „Verwalten“.
- **Dokumentationen:** Kategorien legen die Benutzer selbst an (z. B. Gesetze, Funktionen) und sortieren sie. Seiten mit Titel und Text in einfacher Formatierung (Überschriften, fett, kursiv, Listen, Zitate, Trennlinien, http(s)-Links), anheftbar, durchsuchbar über Titel und Text. Seiten lassen sich nur innerhalb ihres Bereichs verschieben; eine Kategorie lässt sich erst löschen, wenn sie leer ist. In einer Organisation kann jede Kategorie eigene Rechte haben, etwa eine interne Kategorie nur für die Leitung.

## 10. Benutzer-Einstellungen

| Tab | Inhalt |
|---|---|
| Profil | Name, Sprache, Währung, Zeitzone, erster Wochentag, Festgehalt pro Tag, Wochen-Sollzeit, Bonus, Konto für Gehaltsgutschrift, DSGVO-Export |
| Sicherheit | 2FA per Authenticator-App (QR-Code, Wiederherstellungscodes), Passwort ändern |
| Darstellung | Design V1 oder V2, Akzentfarbe, Modus (System, Hell, Dunkel), Gravatar (Standard aus, nur mit Einwilligung); in V2 Hintergrund (Vorlage oder eigenes Bild), Unschärfe, Deckkraft, Abdunkeln, Handy ohne Unschärfe |
| Benachrichtigungen | In-App und E-Mail je Ereignisart |
| Sitzungen | Aktive Sitzungen ansehen und beenden |
| API & Kalender | API-Schlüssel, iCal-Abo, Google-/Microsoft-Verbindung |

## 11. Datenschutz und Rechtliches

- **Impressum:** Angaben aus der Datei `.env-impressum`; leere Felder werden ausgeblendet.
- **Datenschutzerklärung:** öffentliche Seite mit Verantwortlichem, Rechtsgrundlagen, Daten, Cookies, Dritten, Speicherdauer und Betroffenenrechten.
- **Gravatar:** nur nach aktiver Einwilligung, Standard aus. Bestehende Einstellungen wurden per Migration zurückgesetzt.
- Nur technisch notwendige Speicherung, kein Tracking.

## 12. Design

- Schlicht und flach, wenige Icons, modulare Karten, SVG-Diagramme.
- Sechs Akzentfarben (Indigo, Smaragd, Ozean, Rosé, Bernstein, Mono), jeweils hell und dunkel; optional folgt der Modus dem System.
- Bedienbar bis 390 px Breite. Unter 640 px werden Tabellen zu Karten (Spaltenüberschrift links in jeder Zeile), Formulare einspaltig, Kennzahlen zu zweit; der Kalender startet dort in der Agenda. Eingaben haben auf dem Handy 16 px Schrift, damit iOS nicht hineinzoomt.
- **Design V2 „Glass“ (Wunsch des Auftraggebers vom 2026-11-11):** je Benutzer wählbar, V1 bleibt Standard und unverändert. Alle Seiten zeigen Karten, Seitenleiste und Kopfleiste als Glas-Panels (durchscheinend mit Unschärfe) über einem festen Hintergrund; die Navigation hat Symbole. Hintergrund: Vorlagen Dämmerung, Nacht, Wald, ohne Bild oder ein eigenes Bild, das jeder Benutzer selbst hochlädt und nur selbst sieht. Regler für Unschärfe (0–40 px), Deckkraft der Panels (20–90 %) und Abdunkeln (0–70 %); auf Handys standardmäßig ohne Unschärfe. Dialoge und Popover sind kräftiger, damit Formulare lesbar bleiben.
- **Dashboard in V2:** Module mit eigenem Standard (Kennzahlen; Cashflow + Stundenzettel; Prognose + Konten; Budgets, Buchungen, Termine; ToDos, Sparziele, Kategorien; Fuhrpark) und frei anpassbar: verschieben (Ziehen oder Pfeile), Breite 4/6/8/12 von 12 Spalten, ausblenden, wieder hinzufügen, auf Standard zurück. Gespeichert je Benutzer. V1 zeigt immer die feste Anordnung von früher, ohne die V2-Module.

## 13. Architektur

```
Browser ──HTTP(S)──> api (SPA + REST API)
                         ├── worker
                         └── PostgreSQL (Volume)
```

Ein vorhandener Betreiber-Proxy kann optional TLS terminieren; er ist nicht Bestandteil des Repositories. Details stehen in [TECHNICAL.md](TECHNICAL.md).

## 14. Offene Punkte

- Stunden, die für eine abgeschlossene Woche nachgetragen werden, bringen keinen Bonus mehr.
- Buchungen, die für einen schon verzinsten Zeitraum nachgetragen werden, ändern dessen Zinsen nicht mehr.
- Arbeitszeiten, die vor der Aufteilung an Mitternacht erfasst wurden, bleiben unverändert am Starttag.
- Beträge erscheinen überall in der Profilwährung, auch bei Konten in anderer Währung; umgerechnet wird nichts.
- Nicht enthalten: SSO/OIDC, LDAP, Bankanbindung, MT940, S3/SFTP-Backupziele, E-Mail-Bestätigung bei Registrierung, Restore in der Oberfläche.
