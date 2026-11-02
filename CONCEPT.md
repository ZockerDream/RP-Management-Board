# Budget Manager – Konzept

Stand: entspricht der implementierten Anwendung. Die technische Umsetzung steht in [TECHNICAL.md](TECHNICAL.md).

## 1. Ziel
Webanwendung zur Verwaltung persönlicher und geteilter Konten, kombiniert mit der Verwaltung von Häusern, Fahrzeugen, Schlüsseln und Personen. Rollen-/Rechtesystem, Teams, Dashboard, Daueraufträge und ein vollwertiger Kalender. Betrieb per Docker Compose, Datenhaltung in PostgreSQL.

## 2. Navigation und Seiten

| Gruppe | Seite | Inhalt |
|---|---|---|
| Finanzen | Dashboard | KPIs, Cashflow, Kategorien, Auslastung, Saldo-Verlauf, letzte Buchungen |
| | Transaktionen | Alle Buchungen über Konten hinweg |
| | Stundenzettel | Allgemeine und Projektzeiten, Ein-/Ausstempeln, Monatsübersicht, Soll-/Überstunden, Vergütung und PDF-Export |
| | Konten | Persönliche und geteilte Team-Konten, Kategorien mit Limits |
| | Daueraufträge | Wiederkehrende Ein- und Ausgaben |
| | Sparziele | Ziele mit Fortschritt, solo oder im Team |
| | Berichte | Auswertungen, Export, geplante Berichte |
| Zusammenarbeit | Teams | Mitglieder, Teamrollen, geteilte Konten und sichtbare Objekte |
| | Kalender | Monat, Woche, Tag, Agenda |
| Objekte | Schlüssel & Objekte | Häuser, Fahrzeuge, Schlüssel, Personen, Kosten, Protokoll |
| | Hilfe | Dokumentation der wichtigsten Funktionen |
| Administration | Verwaltung | 10 Bereiche (siehe 3) |
| Konto | Einstellungen | Profil, Sicherheit, Darstellung, Benachrichtigungen |

Die Seitenleiste ist in diese Gruppen gegliedert. Es gibt keinen Theme-Button in der Kopfzeile, Hell/Dunkel wird über die Theme-Auswahl gesteuert (siehe 2.9).

## 3. Administration

Die Verwaltung hat zehn Tabs.

| Tab | Funktionen |
|---|---|
| Übersicht | KPIs (User, aktiv in 7 Tagen, 2FA-Quote, offene Einladungen), Diagramme (Logins/aktive User, Rollenverteilung), Ressourcen (DB, Beleg-Speicher, API-Anfragen), Dienststatus, Handlungsbedarf |
| User | Suche und Filter (Rolle, Gruppe, Status, 2FA), Sammelaktionen (Rolle ändern, 2FA erzwingen, sperren, deaktivieren), CSV-Export, Anlegen, Einladen, Bearbeiten, Passwort-Reset, offene Einladungen (erneut senden, widerrufen) |
| Rollen & Rechte | Eigene Rollen anlegen, duplizieren, löschen; Rechte-Matrix je Ressource (Lesen, Erstellen, Ändern, Löschen, Export); Sonderrechte: Standardrolle, Datenbereich (alle, eigene Gruppen, eigene Daten), Kontolimit pro User |
| Gruppen | Gruppen mit Mitgliedern und Rollen; Regeln: automatische Zuordnung per E-Mail-Domain, Gruppenleitung darf Mitglieder verwalten |
| Teams & Konten | Alle Teams mit Besitzer, Mitgliedern, Auslastung und Status; Besitz übertragen, archivieren; Richtlinien (wer Teams erstellen darf, max. Mitglieder, max. Teams pro User, Ausgaben-Ausgleich) |
| Sicherheit | 2FA-Pflicht (alle oder nur Admin-Rollen), Selbstregistrierung, E-Mail-Bestätigung, Gravatar, SSO (OIDC); Passwort-Richtlinie (Länge, Ablauf, Komplexität, Leak-Check, Historie); Sessions und Sperren (Timeout, max. Sessions, Fehlversuche, Sperrdauer); Netzwerk (IP-Allowlist, Login-Benachrichtigung, Rate-Limit); aktive Sessions beenden |
| System | Branding (App-Name, Standard-Theme und -Modus, Logo, Support-Mail, Theme-Wechsel erlauben); Lokalisierung (Sprache, Zeitzone, Währung, Geschäftsjahr, Zahlenformat, Wochenstart, mehrere Währungen); SMTP mit Testmail; Mail-Vorlagen; Standard-Kategorien; Funktionsschalter (Daueraufträge, Beleg-Upload, CSV-Import, Wartungsmodus mit Banner) |
| Integrationen | API-Keys (Rechte, letzte Nutzung, widerrufen), Webhooks (Ereignisse), Anbindungen: OIDC/SSO, LDAP/AD, Bank (FinTS/PSD2), Kalender-Feed (iCal) |
| Daten & Backups | Manuelle und automatische Backups (Zeitplan, Aufbewahrung, Ziel lokal/S3/SFTP), Download und Wiederherstellen; Export und Import (CSV, JSON, MT940); DSGVO (Audit-Aufbewahrung, Löschung inaktiver Accounts, Auskunft/Löschung); geplante Jobs |
| Audit-Log | Filterbares Protokoll aller Admin-Aktionen und Rechteänderungen |

Rechte-Modell (RBAC): `User → Rollen (direkt oder über Gruppe) → Permissions`.
Permissions sind feingranular als `ressource:aktion`, z. B. `user:create`, `role:update`, `budget:read`, `key:assign`. Die Matrix deckt auch Schlüssel (Ausgabe & Rückgabe), Häuser & Fahrzeuge, Personen (Tracking), Berichte und API-Keys & Webhooks ab. Systemrollen (`Admin`, `User`) sind fest; eigene Rollen (z. B. Buchhalter*in, Support) sind frei definierbar.

## 4. Finanzfunktionen

### 4.1 Dashboard
Filter Solo / Team / Gesamt und Zeitraum. KPI-Karten (Saldo, Einnahmen, Ausgaben, Sparquote, jeweils mit Vergleich zum Vormonat), Diagramme: Cashflow (Fläche), Ausgaben nach Kategorie (Donut), Konto-Auslastung (Gauges), Saldo-Verlauf, dazu die letzten Buchungen. Keine einfachen Balken, alle Diagramme sind SVG.

### 4.2 Konten
Die Oberfläche nennt diese Finanzbereiche „Konten“; intern bleiben API und Datenbank aus Kompatibilitätsgründen bei `budgets` und `budget_id`. Zwei strikt getrennte Arten: `solo` (gehört einem User) und `shared` (gehört einem Team). Tabs Alle / Persönlich / Geteilt. Pro Konto Zeitraum (monatlich, jährlich, frei, Sparziel), Limit, Auslastung und Kategorien mit eigenen Limits. Eigene Summen und Statistiken, kein Vermischen von persönlichen und Team-Konten.

### 4.3 Transaktionen
Gesamtliste mit Suche und Filtern (Konto, Kategorie, Zeitraum). Spalten: Datum, Beschreibung, Konto, Kategorie, Quelle (manuell, Dauerauftrag, Objekt), Beleg, Betrag. Neue Buchung: Typ (Ausgabe, Einnahme, Einzahlung in ein Sparziel), Betrag, Konto, Kategorie, Datum, Tags, Notiz, Beleg, optional als Dauerauftrag wiederholen. Export als CSV.

### 4.4 Daueraufträge
Wiederkehrende Buchungen mit täglichem, wöchentlichem, monatlichem, jährlichem oder benutzerdefiniertem Tagesintervall. Für jeden Rhythmus kann ein Abstand von mehreren Tagen, Wochen, Monaten oder Jahren festgelegt werden; Start/Ende und nächste Ausführung werden angezeigt, Aufträge sind pausierbar und bearbeitbar. Objektkosten aktualisieren den bestehenden verknüpften Auftrag statt Duplikate zu erzeugen; Objektaufträge können wie andere Daueraufträge verwaltet oder gelöscht werden. Ein persönlicher Dauerauftrag kann nach Annahme durch einen Team-Nutzer mit dem vollen Betrag auch in dessen persönlichem Konto verbucht werden; beide Konten müssen dieselbe Währung verwenden.

### 4.5 Sparziele
Zielbetrag, Zieldatum, Fortschrittsanzeige, monatlicher Beitrag; solo oder für ein Team. Einzahlungen sind Buchungen vom Typ `deposit`.

### 4.6 Berichte
Vorlagen Monatsübersicht, Kategorien-Analyse, Objektkosten; Export als PDF oder CSV; geplante Berichte mit Rhythmus und Empfängern per E-Mail.

### 4.7 Teams
Teams mit Mitgliedern und Teamrollen (Owner, Editor, Viewer), Einladung per E-Mail, geteilte Konten und teamweit sichtbare Objekte. Team-Owner und -Editoren können die Arbeitszeiten aller Teammitglieder einsehen und bearbeiten sowie globale Mitarbeitereinstellungen verwalten. Optional Ausgaben-Ausgleich („wer schuldet wem“), im Admin als Richtlinie schaltbar.

### 4.8 Zeiterfassung und Stundenzettel
Arbeitszeit kann unabhängig von Projekten per Start-/Pause-/Stopp-Timer oder manuell erfasst werden; Projektzeiten bleiben separat zugeordnet. Monatliche Stundenzettel zeigen allgemeine und projektbezogene Einträge getrennt sowie Gesamtstunden, Sollzeit, Überstunden und gutgeschriebene Vergütung. Pro Mitarbeiter gelten global Wochen-Sollzeit, Stundenlohn und Überstundenzuschlag. Das Basisgehalt wird unabhängig von Anwesenheit täglich einschließlich Wochenende um 03:45 Uhr auf ein eigenes ausgewähltes Konto gebucht; jede tatsächlich erfasste Wochenstunde oberhalb des Solls wird zusätzlich mit Stundenlohn plus Überstundenzuschlag vergütet. Team-Owner und -Editoren können Teamzeiten und diese Mitarbeitereinstellungen bearbeiten.

## 5. Objekte: Schlüssel, Häuser, Fahrzeuge

Eine Seite mit den Tabs Übersicht, Schlüssel, Häuser, Fahrzeuge, Personen, Kosten, Protokoll.

1. **Personen (Tracking)** – Mitarbeitende, Externe und Familie, auch ohne Panel-Zugang (`user_id` optional, später verknüpfbar). Dient dem Nachverfolgen, wer was hat.
2. **Häuser** – Name, Typ (Wohnhaus, Büro, Lager, Ferienobjekt), Adresse, Verantwortliche Person, verschlüsselter Tür-PIN (Anzeige nach Passwort-/2FA-Bestätigung und protokolliert), Notizen und zugeordnete Schlüssel.
3. **Fahrzeuge** – Marke/Modell, Kennzeichen, Besitzer, Service-fällig (Monat), Verbandskasten-Ablaufdatum, Status (verfügbar, im Einsatz, Werkstatt, außer Betrieb) und zugeordnete Schlüssel. Eine Versicherungsangabe gibt es nicht.
4. **Schlüssel** – gehört zu einem Haus oder Fahrzeug, hat eine frei eingebbare Art und eine verwaltbare Anzahl Exemplare. Inventur zeigt Gesamtbestand, Ausgaben und Verluste; QR-Codes öffnen den Schlüssel in der Verwaltung. Ausgabe und Rückgabe mit Datum, Person, Quittierung und optionaler Rückgabefrist. Status: ausgegeben, im Safe, überfällig, verloren, gesperrt.
5. **Übersicht** – KPIs, „Wer hat welche Schlüssel?“, Diagramm Schlüssel nach Status, Handlungsbedarf (fälliger Service, überfällige oder verlorene Schlüssel), letzte Vorgänge.
6. **Protokoll** – lückenlose Historie je Schlüssel.
7. **Optionaler Preis & Kontoverfolgung** – Haus, Fahrzeug und Schlüssel haben ein optionales Preisfeld: Betrag, Intervall (einmalig, täglich, wöchentlich, monatlich, jährlich oder benutzerdefinierte Tage), Abstand, Konto, Kategorie, Schalter „im Tracking“. Ohne Preis wird der Posten nur verwaltet. Mit Preis erzeugt das System bei „einmalig“ genau eine Buchung, sonst einen Dauerauftrag im gewählten Konto; Preisänderungen aktualisieren den Dauerauftrag statt Duplikate zu erzeugen. Der Tab „Kosten“ zeigt alle Posten mit Preis, Intervall, Konto, Kategorie, Tracking-Schalter, die laufenden Monatskosten, einmalige Kosten und die Anzahl Posten ohne Preis.

## 6. Kalender

Ansichten Monat, Woche, Tag und Agenda (30 Tage), Navigation vor/zurück/heute, Klick auf Tag öffnet die Tagesansicht oder legt einen Termin an.

- **Automatische Termine** (aus anderen Modulen abgeleitet, nur lesbar): Daueraufträge und Zahlungen, Service der Fahrzeuge, Rückgabefristen von Schlüsseln, Wartungen von Häusern, Feiertage.
- Ablauf-Erinnerungen weisen rechtzeitig auf Fahrzeug-Service, Verbandskasten und Schlüsselrückgaben hin; sie erscheinen im Kalender und als Benachrichtigung.
- **Eigene Termine**: Kalender-Typ Team oder Privat, ganztägig oder mit Beginn/Ende, Wiederholung (täglich, wöchentlich, monatlich, jährlich oder benutzerdefinierte Tage) mit einstellbarem Abstand, Erinnerung (1/3/7/14 Tage vorher), optionaler Betrag, Notiz; Bearbeiten und Löschen. Monats- und Jahresserien fallen in kürzeren Zeiträumen auf den letzten gültigen Tag, zum Beispiel vom 31. auf den Monatsletzten.
- **Seitenleiste**: Filter je Kalender-Typ (Zahlungen, Fahrzeuge, Schlüssel, Häuser, Team, Privat, Feiertage), „Als Nächstes“, Zahlungssaldo des Monats (Einnahmen, Ausgaben, Saldo).
- **iCal-Abo** zum Einbinden in externe Kalender.

## 7. User-Einstellungen

| Tab | Inhalt |
|---|---|
| Profil | Gravatar (ein/aus, es wird nur der MD5-Hash der E-Mail übertragen; ohne Gravatar bleiben Initialen, mit Bild kein Text darunter), Name, E-Mail, Sprache, Währung, Zeitzone, erster Wochentag, konfigurierbare Wochen-Sollzeit, DSGVO-Export, Konto löschen |
| Sicherheit | 2FA per Authenticator-App (QR-Code, Bestätigungscode, Wiederherstellungscodes), Passwort ändern, aktive Sitzungen beenden |
| Darstellung | Theme-Auswahl, „Automatisch wechseln“ (folgt Hell/Dunkel des Geräts), kompakte Tabellen, Beträge ausblenden |
| Benachrichtigungen | Budget-Warnung bei 80 %, Budget überschritten, Ablauf-Erinnerungen für Fahrzeuge und Schlüssel, Team-Einladungen |

Die Hilfe-Seite bietet durchsuchbare Schritt-für-Schritt-Erklärungen und Antworten auf häufige Fragen.

## 8. Design

- Schlicht und flach, wenige Icons, modulare Karten, SVG-Diagramme (Fläche, Donut, Gauge, Sparkline).
- Sechs Themes: Indigo, Smaragd, Ozean, Rosé, Bernstein, Mono. Jedes Theme hat eine eigene helle und dunkle Variante; in den Einstellungen wird die Variante direkt gewählt. Optional folgt es automatisch dem System.
- Admin kann Standard-Theme und -Modus festlegen und den Theme-Wechsel für User sperren.

## 9. Architektur

```
Browser ──HTTP(S)──> api (SPA + REST API)
                         ├── worker
                         └── PostgreSQL (Volume)
```

| Service | Zweck |
|---|---|
| `api` | Einstiegspunkt: liefert SPA und REST-API direkt aus; kein Proxy erforderlich |
| `worker` | Scheduler (Daueraufträge, Erinnerungen, Berichte, Backups) |
| `db` | PostgreSQL 16, Volume, Healthcheck |

Ein vorhandener Betreiber-Proxy kann optional TLS terminieren und den App-Port weiterleiten; er ist nicht Bestandteil des Repositories.

Details, Stack, Datenmodell, API, Sicherheit und Betrieb stehen in [TECHNICAL.md](TECHNICAL.md).

## 10. Roadmap
| Phase | Inhalt |
|---|---|
| 0 | Compose-Setup, Migrationen, CI |
| 1 | Auth, Userverwaltung, Rollen/Rechte, Gruppen, Audit-Log |
| 2 | Persönliche Konten, Kategorien, Transaktionen, Einzahlungen |
| 3 | Dashboard, Berichte |
| 4 | Teams, geteilte Konten, Einladungen, Sparziele |
| 5 | Daueraufträge, Scheduler |
| 6 | Personen, Häuser, Fahrzeuge, Schlüssel, Preis-Tracking |
| 7 | Kalender, Erinnerungen, iCal |
| 8 | Härtung: 2FA, SSO, Backups, Export/Import, Tests |

## 11. Offene Fragen
- Selbstregistrierung oder nur Einladung (im Admin als Schalter vorgesehen, Standardwert offen)?
- Mehrere Währungen mit Umrechnung gleich in Version 1?
- Ausgaben-Ausgleich in Teams in Version 1?
- Tech-Stack: Vorschlag in TECHNICAL.md (Node/NestJS), Python/FastAPI wäre die Alternative.
- Beleg-Upload und Bankimport (CSV, MT940, FinTS) im ersten Umfang?
