# RP-Management-Board – Konzept

Stand: entspricht der implementierten Anwendung. Die technische Umsetzung steht in [TECHNICAL.md](TECHNICAL.md).

## 1. Ziel
Webanwendung zur Verwaltung persönlicher und geteilter Konten, kombiniert mit Zeiterfassung, Sport-Bestenlisten und der Verwaltung von Häusern, Fahrzeugen, Schlüsseln und Personen. Rollen-/Rechtesystem, Teams, Dashboard, Daueraufträge und ein vollwertiger Kalender. Betrieb per Docker Compose, Datenhaltung in PostgreSQL.

## 2. Navigation und Seiten

| Gruppe | Seite | Inhalt |
|---|---|---|
| Finanzen | Dashboard | KPIs und Cashflow nach Tag, Woche oder Monat, Kategorien, Budget-Auslastung, Fuhrpark, nächste Termine, letzte Buchungen |
| | Transaktionen | Alle Buchungen über Konten hinweg |
| | Stundenzettel | Allgemeine und Projektzeiten, Ein-/Ausstempeln, Gehalt einstellen, Monatsübersicht, Soll-/Überstunden, Vergütung und PDF-Export |
| | Konten | Persönliche und geteilte Konten mit Kontostand, Einkommen, Ausgaben und Kategorien |
| | Budgets | Ausgabenlimits pro Tag, Woche, Monat oder Jahr |
| | Daueraufträge | Wiederkehrende Ein- und Ausgaben |
| | Sparziele | Ziele mit Fortschritt, solo oder im Team |
| | Berichte | Auswertungen, Export, geplante Berichte |
| Zusammenarbeit | Teams | Mitglieder, Teamrollen, geteilte Konten und sichtbare Objekte |
| | Kalender | Monat, Woche, Tag, Agenda |
| | Notizblock | Notizen solo oder im Team, anheften, durchsuchen |
| | ToDos | Aufgaben solo oder im Team, Deadline mit Benachrichtigung |
| Sport | Laufen, Schwimmen, Biken | Strecken des Teams mit gemeinsamer Bestenliste |
| Object Management | Fahrzeuge, Häuser, Personen, Schlüssel | Je eine eigene Seite |
| | Verwaltung | Übersicht, Kosten, Protokoll, Auditlog |
| Administration | User-Management | Benutzer, Rollen & Rechte, Gruppen, Teams (nur Admins) |
| | Server-Management | Übersicht, Sicherheit & Einstellungen, System & Backups, Integrationen, Audit-Log (nur Admins) |
| | Tickets | Gemeldete Fehler (nur Admins) |
| | Hilfe, Fehler melden | Für alle Benutzer |
| Konto | Einstellungen | Profil, Sicherheit, Darstellung, Benachrichtigungen, Sitzungen, API & Kalender |
| Rechtliches | Impressum, Datenschutz | Auch ohne Anmeldung erreichbar |

Ältere Links wie `#/assets?tab=keys` oder `#/admin` führen weiterhin auf die passende Seite. Der in den Einstellungen gepflegte App-Name erscheint in Seitenleiste, Login, Browser-Titel und auf den Rechtsseiten.

## 3. Administration

| Bereich | Tab | Funktionen |
|---|---|---|
| User-Management | Benutzer | Suche, Filter, Anlegen, Einladen, Bearbeiten, Sperren, Zugangsablauf (gilt bis einschließlich zum gewählten Tag), 2FA erzwingen oder zurücksetzen, Sitzungen beenden, CSV-Export; der letzte aktive Admin kann weder gesperrt noch befristet werden |
| | Rollen & Rechte | Eigene Rollen, Rechte-Matrix je Ressource, Datenbereich (alle, eigene Gruppen, eigene Daten), Kontolimit pro Benutzer, Standardrolle |
| | Gruppen | Mitglieder und Rollen, automatische Zuordnung per E-Mail-Domain, Gruppenleitung |
| | Teams | Alle Teams mit Besitzer und Status |
| Server-Management | Übersicht | KPIs, Aktivität, Rollenverteilung, letzte Ereignisse |
| | Sicherheit & Einstellungen | Passwortlänge, Sperren, Sitzungsdauer, 2FA-Pflicht, Admin-IP-Allowlist, App-Name, Wartungsmodus, Registrierung, Standardwährung und -sprache, Aufbewahrungsfristen; SMTP-Test |
| | System & Backups | Geplante Jobs mit Status, manuelle Backups, Download, Löschen, Umgebungswerte (schreibgeschützt) |
| | Integrationen | Webhooks, API-Schlüssel aller Benutzer |
| | Audit-Log | Filterbares Protokoll, CSV-Export |
| Tickets | – | Gemeldete Fehler, optional mit GitHub-Issue-Abgleich; kommentieren und löschen. Auch Melder kommentieren und löschen ihre eigenen Tickets unter „Fehler melden“. Kommentare bleiben intern, ein GitHub-Issue bleibt beim Löschen bestehen |

Rechte-Modell (RBAC): `User → Rollen (direkt oder über Gruppe) → Permissions`. Permissions sind feingranular als `ressource:aktion`, z. B. `user:create`, `budget:read`, `key:assign`. Systemrollen (`Admin`, `User`) sind fest; eigene Rollen sind frei definierbar.

## 4. Finanzfunktionen

### 4.1 Dashboard
Filter Solo / Team / Gesamt, Ansicht Tag / Woche / Monat und passender Zeitraum (14 Tage, 8 Wochen, 3 Monate zurück); der Browser merkt sich die Ansicht, die Woche beginnt mit dem Wochenstart aus dem Profil. KPI-Karten (Gesamtsaldo, Einnahmen, Ausgaben, Sparquote), Diagramme: Cashflow (Fläche, letzte 14 Tage, 8 Wochen oder 6 Monate), Ausgaben nach Kategorie (Donut), Budget-Auslastung (Gauges), dazu Fuhrpark, nächste Termine und letzte Buchungen. Alle Diagramme sind SVG. Das Dashboard zeigt nur den echten Stand: Buchungen mit Datum in der Zukunft zählen erst ab diesem Datum, Sparziel-Einzahlungen ändern den Saldo nicht, weil das Geld auf dem Konto bleibt.

### 4.2 Konten
Die Oberfläche nennt diese Finanzbereiche „Konten“; intern bleiben API und Datenbank aus Kompatibilitätsgründen bei `budgets` und `budget_id`. Zwei strikt getrennte Arten: `solo` (gehört einem User) und `shared` (gehört einem Team). Jede Karte zeigt Kontostand (Einkommen minus Ausgaben bis heute), Einkommen und Ausgaben. Das Formular fragt nur Name, Typ, Team und Währung ab; vorgeschlagen ist die Profilwährung, beim Ändern wird nichts umgerechnet. Ausgabenlimits werden als Budgets (4.3) gepflegt. Kategorien können eigene Limits haben.

### 4.3 Budgets
Ein Budget ist ein Ausgabenlimit: Name, Betrag und Zeitraum (Tag, Woche, Monat, Jahr), optional begrenzt auf ein Konto oder eine Kategorie. Die Karte zeigt laufenden Zeitraum, Verbrauch, Rest oder Überschreitung. Budgets gehören dem jeweiligen Benutzer; gezählt werden Ausgaben aller für ihn zugänglichen Konten, auch geteilter. Löschen eines Budgets lässt Buchungen unberührt.

### 4.4 Transaktionen
Gesamtliste mit Suche und Filtern (Konto, Kategorie, Zeitraum). Neue Buchung: Typ (Ausgabe, Einnahme, Einzahlung in ein Sparziel), Betrag, Konto, Kategorie, Datum, Tags, Notiz, Beleg. Export als CSV.

### 4.5 Daueraufträge
Wiederkehrende Buchungen mit täglichem, wöchentlichem, monatlichem, jährlichem oder benutzerdefiniertem Tagesintervall. Für jeden Rhythmus kann ein Abstand festgelegt werden; Start/Ende und nächste Ausführung werden angezeigt, Aufträge sind pausierbar und bearbeitbar. Objektkosten aktualisieren den bestehenden verknüpften Auftrag statt Duplikate zu erzeugen. Ein persönlicher Dauerauftrag kann nach Annahme durch einen Team-Nutzer mit dem vollen Betrag auch in dessen persönlichem Konto verbucht werden; beide Konten müssen dieselbe Währung verwenden.

### 4.6 Sparziele
Zielbetrag, Zieldatum, Fortschrittsanzeige, Rate mit Rhythmus; solo oder für ein Team. Einzahlungen sind Buchungen vom Typ `deposit`.

### 4.7 Berichte
Vorlagen Monatsübersicht, Kategorien-Analyse, Objektkosten; Export; geplante Berichte mit Rhythmus und Empfängern per E-Mail.

### 4.8 Teams
Teams mit Mitgliedern und Teamrollen (Owner, Editor, Viewer), Einladung per E-Mail, geteilte Konten, teamweit sichtbare Objekte und Sportstrecken. Team-Owner und -Editoren können die Arbeitszeiten aller Teammitglieder einsehen und bearbeiten sowie Mitarbeitereinstellungen verwalten.

### 4.9 Zeiterfassung und Stundenzettel
Arbeitszeit kann unabhängig von Projekten per Start-/Pause-/Stopp-Timer oder manuell erfasst werden; Projektzeiten bleiben separat zugeordnet. Monatliche Stundenzettel zeigen allgemeine und projektbezogene Einträge getrennt sowie Gesamtstunden, Sollzeit, Überstunden und gutgeschriebene Vergütung. Das Monats-Soll ist Wochen-Soll × Kalendertage / 7. Pro Mitarbeiter gelten Festgehalt pro Tag, Wochen-Sollzeit und Bonus in Prozent des Festgehalts. Das Festgehalt wird unabhängig von den Stunden täglich einschließlich Wochenende um 03:45 Uhr für den Vortag auf ein eigenes persönliches Konto gebucht. Nur Stunden über dem Wochen-Soll (Montag bis Sonntag) bringen je Stunde zusätzlich den Bonus; montags beginnt die Zählung neu. Beispiel mit 1.669 Festgehalt, 13 Stunden Soll und 17 %: Bei 8 Stunden gibt es täglich 1.669, bei 15 Stunden kommen 2 × 283,73 dazu. Nachgetragene Stunden derselben Woche kommen mit der nächsten Gutschrift dazu; abgeschlossene Wochen werden nicht nachberechnet. Das Gehaltskonto wählt jeder Mitarbeiter selbst, auf dem Stundenzettel unter „Gehalt einstellen“ oder im Profil. Wählbar sind eigene persönliche Konten in Profilwährung; Team-Konten und Konten in anderer Währung stehen mit Begründung in der Liste, fehlt ein passendes Konto, nennt ein Hinweis den nächsten Schritt.

## 5. Sport

Getrennte Seiten für Laufen, Schwimmen und Biken. Eine Strecke gehört einem Team und hat Name, Checkpoints, optional Distanz und Notizen. Ergebnisse bestehen aus Punkten, optional Zeit (mm:ss oder h:mm:ss), erreichten Checkpoints, Datum und Notiz. Die Bestenliste sortiert nach Punkten absteigend, bei Gleichstand nach Zeit.

| Rolle im Team | Strecken | Ergebnisse |
|---|---|---|
| Owner, Editor | anlegen, bearbeiten, löschen | eintragen, eigene und fremde löschen |
| Viewer | ansehen | eintragen, eigene löschen |
| Nicht im Team | nicht sichtbar | nicht möglich |

## 6. Objekte: Fahrzeuge, Häuser, Personen, Schlüssel

Jeder Datensatz ist privat oder pro Datensatz einem Team freigegeben.

1. **Fahrzeuge** – Marke/Modell, Kennzeichen, Besitzer, Service-Termin und/oder -Kilometerstand, Verbandskasten-Ablaufdatum, Status (verfügbar, im Einsatz, Werkstatt, außer Betrieb) und zugeordnete Schlüssel. Eine Versicherungsangabe gibt es nicht.
2. **Häuser** – Name, Typ (Wohnhaus, Büro, Lager, Ferienobjekt), Adresse, verantwortliche Person, Wartung, verschlüsselter Tür-PIN (Anzeige nach Passwort-/2FA-Bestätigung und protokolliert), Notizen und zugeordnete Schlüssel.
3. **Personen** – Mitarbeitende, Externe und Familie, auch ohne Panel-Zugang. Dient dem Nachverfolgen, wer was hat.
4. **Schlüssel** – gehört zu einem Haus oder Fahrzeug, hat eine frei eingebbare Art und eine Anzahl Kopien. Inventur zeigt Gesamtbestand, Ausgaben und Verluste; QR-Codes öffnen den Schlüssel. Ausgabe und Rückgabe mit Datum, Person, Quittierung und optionaler Rückgabefrist. Status: ausgegeben, im Safe, überfällig, verloren.
5. **Verwaltung** – Übersicht (KPIs, Handlungsbedarf), Kosten, Protokoll je Schlüssel und Auditlog (mit Recht `audit:read`).
6. **Optionaler Preis & Kontoverfolgung** – Haus, Fahrzeug und Schlüssel haben ein optionales Preisfeld: Betrag, Intervall (einmalig, täglich, wöchentlich, monatlich, jährlich oder benutzerdefinierte Tage), Abstand, Konto, Kategorie, Schalter „im Tracking“. Mit Preis erzeugt das System bei „einmalig“ genau eine Buchung, sonst einen Dauerauftrag; Preisänderungen aktualisieren den Auftrag statt Duplikate zu erzeugen.

## 7. Kalender

Ansichten Monat, Woche, Tag und Agenda, Navigation vor/zurück/heute.

- **Automatische Termine** (abgeleitet, nur lesbar): Daueraufträge und Zahlungen, Service der Fahrzeuge, Rückgabefristen von Schlüsseln, Wartungen von Häusern, Feiertage.
- **Erinnerungen:** Ein täglicher Job weist auf Termine, Fahrzeug-Service, Verbandskasten und Schlüsselrückgaben hin; sie erscheinen als Benachrichtigung in der Glocke.
- **Eigene Termine:** Team oder Privat, ganztägig oder mit Beginn/Ende, Wiederholung mit Abstand, Erinnerung (1/3/7/14 Tage vorher), optionaler Betrag, Notiz. Monats- und Jahresserien fallen in kürzeren Zeiträumen auf den letzten gültigen Tag.
- **iCal-Abo** zum Einbinden in externe Kalender; Google und Microsoft können lesend importiert werden.

## 8. Notizblock und ToDos

Beide gehören entweder einer Person (Solo) oder einem Team. Team-Owner und -Editoren dürfen ändern, Viewer nur lesen; die Oberfläche blendet die Aktionen für Viewer aus. Die Sichtbarkeit lässt sich beim Bearbeiten ändern.

- **Notizblock:** Titel und/oder Text, anheften, Suche über Titel und Text. Jede Notiz zeigt, wer sie zuletzt wann bearbeitet hat; Anheften zählt nicht als Bearbeitung.
- **ToDos:** Aufgabe, Notiz, optionale Deadline, abhaken mit Name und Zeitpunkt. Die Liste gruppiert nach Überfällig, Heute, Demnächst, Ohne Deadline und Erledigt.
- **Benachrichtigungen:** Zu offenen ToDos mit Deadline erscheint einen Tag vorher, am Fälligkeitstag und einmal bei Überfälligkeit eine Meldung in der Glocke. Team-ToDos erreichen alle Teammitglieder. Art `todo_due`, in den Einstellungen abschaltbar und optional per E-Mail.

## 9. Benutzer-Einstellungen

| Tab | Inhalt |
|---|---|
| Profil | Name, Sprache, Währung, Zeitzone, erster Wochentag, Festgehalt pro Tag, Wochen-Sollzeit, Bonus, Konto für Gehaltsgutschrift, DSGVO-Export |
| Sicherheit | 2FA per Authenticator-App (QR-Code, Wiederherstellungscodes), Passwort ändern |
| Darstellung | Akzentfarbe, Modus (System, Hell, Dunkel), Gravatar (Standard aus, nur mit Einwilligung) |
| Benachrichtigungen | In-App und E-Mail je Ereignisart |
| Sitzungen | Aktive Sitzungen ansehen und beenden |
| API & Kalender | API-Schlüssel, iCal-Abo, Google-/Microsoft-Verbindung |

## 10. Datenschutz und Rechtliches

- **Impressum:** Angaben aus der Datei `.env-impressum`; leere Felder werden ausgeblendet.
- **Datenschutzerklärung:** öffentliche Seite mit Verantwortlichem, Rechtsgrundlagen, Daten, Cookies, Dritten, Speicherdauer und Betroffenenrechten.
- **Gravatar:** nur nach aktiver Einwilligung, Standard aus. Bestehende Einstellungen wurden per Migration zurückgesetzt.
- Nur technisch notwendige Speicherung, kein Tracking.

## 11. Design

- Schlicht und flach, wenige Icons, modulare Karten, SVG-Diagramme.
- Sechs Akzentfarben (Indigo, Smaragd, Ozean, Rosé, Bernstein, Mono), jeweils hell und dunkel; optional folgt der Modus dem System.
- Bedienbar bis 390 px Breite; breite Tabellen scrollen innerhalb ihrer Karte.

## 12. Architektur

```
Browser ──HTTP(S)──> api (SPA + REST API)
                         ├── worker
                         └── PostgreSQL (Volume)
```

Ein vorhandener Betreiber-Proxy kann optional TLS terminieren; er ist nicht Bestandteil des Repositories. Details stehen in [TECHNICAL.md](TECHNICAL.md).

## 13. Offene Punkte

- Stunden für abgeschlossene Wochen bringen keinen Bonus mehr, auch nicht bei einer Nachtschicht von Sonntag auf Montag, die erst nach 03:45 ausgestempelt wird.
- Beträge erscheinen überall in der Profilwährung, auch bei Konten in anderer Währung; umgerechnet wird nichts.
- Nicht enthalten: SSO/OIDC, LDAP, Bankanbindung, MT940, S3/SFTP-Backupziele, E-Mail-Bestätigung bei Registrierung, Restore in der Oberfläche.
