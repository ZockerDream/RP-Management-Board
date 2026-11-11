// Änderungsprotokoll für die Seite „Changelog“ unter Administration, neueste Version zuerst. Ohne DOM, damit
// apps/api/test/changelog.test.js es prüfen kann (neueste Version = package.json, absteigend, Arten gültig).
// Vor 1.0.0 gab es keine eigenen Versionsnummern (package.json stand von Anfang an auf 1.0.0): Die Stände 0.x sind
// nachträglich nach den zusammengeführten Änderungen nummeriert.
// Beim Release: die Einträge aus UNRELEASED als neue Version oben in CHANGELOG eintragen und UNRELEASED leeren.
// Arten: new = Neu, changed = Geändert, fixed = Behoben, tech = Technik und Betrieb

export const UNRELEASED = [
];

export const CHANGELOG = [
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
