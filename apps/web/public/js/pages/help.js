import { $, esc } from '../ui.js';

const sections = [
  {
    title: 'Dashboard: Tag, Woche oder Monat',
    text: 'Oben im Dashboard wechselst du zwischen den Ansichten Tag, Woche und Monat und wählst daneben den Zeitraum. Einnahmen, Ausgaben, Sparquote und die Ausgaben nach Kategorie beziehen sich auf den gewählten Zeitraum; der Cashflow zeigt die letzten 14 Tage, 8 Wochen oder 6 Monate. Der Gesamtsaldo bleibt immer der heutige Stand. Die Woche beginnt mit dem Tag, den du im Profil als Wochenstart eingestellt hast. Deine Ansicht merkt sich der Browser.',
  },
  {
    title: 'Konten und Kategorien',
    text: 'Unter „Konten“ legst du persönliche Konten oder geteilte Konten einer Organisation an. Jede Karte zeigt Kontostand, Einkommen und Ausgaben. Neue Konten erhalten deine Profilwährung; änderst du die Währung später, werden Beträge nicht umgerechnet. Kategorien teilen die Buchungen eines Kontos auf und können ein eigenes Limit haben. Wähle ein Konto aus, um seine Kategorien zu sehen.',
  },
  {
    title: 'Budgets: Ausgaben begrenzen',
    text: 'Unter „Budgets“ legst du Ausgabenlimits an, zum Beispiel 100 € pro Woche für Lebensmittel. Wähle Betrag und Zeitraum (Tag, Woche, Monat oder Jahr) und optional ein Konto oder eine Kategorie. Die Karte zeigt, was im laufenden Zeitraum verbraucht ist, was noch übrig bleibt und um wie viel du überzogen hast. Budgets sind nur für dich sichtbar. Ein Budget zu löschen, ändert keine Buchungen.',
  },
  {
    title: 'Daueraufträge und Zeitintervalle',
    text: 'Daueraufträge buchen wiederkehrende Einnahmen oder Ausgaben automatisch. Wähle täglich, wöchentlich, monatlich oder jährlich und stelle bei Bedarf die Anzahl der Einheiten ein. „Benutzerdefiniert“ verwendet einen selbst gewählten Abstand in Tagen. Ein Enddatum ist optional. Du kannst einen Auftrag zusätzlich mit einem Nutzer aus deiner Organisation teilen. Nach dessen Zustimmung wird der volle Betrag auch in dessen persönlichem Konto verbucht; beide Konten müssen dieselbe Währung verwenden.',
  },
  {
    title: 'Stundenzettel',
    text: 'Unter „Stundenzettel“ kannst du mit „Einstempeln“ eine Zeiterfassung starten, pausieren und mit „Ausstempeln“ beenden. Pausen werden nicht als Arbeitszeit gezählt. Die Tages-, Wochen- und Monatsansicht zeigt erfasste Zeiten; Monatsübersicht und PDF enthalten Arbeitszeit, Sollzeit und Überstundensaldo. Die wöchentliche Sollzeit stellst du im Profil ein. Einzelne Einträge lassen sich manuell ergänzen, bearbeiten oder löschen. Projekte können privat oder in einer Organisation geführt werden; wer dort beim Stundenzettel „Teilnehmen“ hat, bucht auf ihre Projekte. Geht eine Schicht über Mitternacht, zählen die Stunden an dem Kalendertag, an dem du sie gearbeitet hast: Aus 22:00 bis 02:00 werden zwei Einträge, 22:00–00:00 und 00:00–02:00. Bei manuellen Einträgen genügt ein Ende vor dem Beginn; Stunden und Pause werden nach der Dauer vor und nach Mitternacht aufgeteilt. Ein Timer, der länger als 24 Stunden läuft, lässt sich nicht mehr ausstempeln. Verwirf ihn dann und erfasse die Zeit manuell.',
  },
  {
    title: 'Gehalt: Festgehalt und Bonus',
    text: 'Unter „Stundenzettel → Gehalt einstellen“ oder im Profil trägst du Festgehalt pro Tag, Wochen-Sollzeit und Bonus ein und wählst ein persönliches Konto für die Gehaltsgutschrift. Das Festgehalt wird jeden Tag gegen 03:45 Uhr für den Vortag gutgeschrieben, auch am Wochenende und unabhängig von deinen Stunden. Sobald du das Wochen-Soll (Montag bis Sonntag) erreicht hast, gibt es für jede weitere Stunde zusätzlich den Bonus, einen Prozentsatz des Festgehalts. Beispiel mit 1.669 Festgehalt, 13 Stunden Soll und 17 % Bonus: Bei 8 Stunden in der Woche gibt es täglich nur die 1.669. Erreichst du das Soll am Dienstag, bringt ab dann jede weitere Stunde 283,73 extra. Erreichst du es erst am Samstag, zählen nur noch die restlichen Stunden von Samstag und Sonntag. Montags beginnt die Zählung neu. Stunden, die du später für dieselbe Woche nachträgst, kommen mit der nächsten Gutschrift dazu; eine abgeschlossene Woche wird nicht nachberechnet. Bei einer Nachtschicht zählen die Stunden nach Mitternacht zum neuen Tag, in der Nacht von Sonntag auf Montag also schon zur neuen Woche. Bist du um 03:45 Uhr noch eingestempelt, wartet die Gutschrift für den Tag, an dem die Schicht begann, bis du ausstempelst, und folgt spätestens eine Stunde danach. Die erste Gutschrift erscheint frühestens am Folgetag.',
  },
  {
    title: 'Sport: Strecken und Bestenliste',
    text: 'Unter „Laufen“, „Schwimmen“ und „Biken“ sehen Mitglieder einer Organisation deren Strecken. Wer bei Sport „Lesen & Schreiben“ hat, legt Strecken mit Checkpoints und optionaler Distanz an und darf auch fremde Ergebnisse löschen. Über „Ergebnis eintragen“ erfasst jedes Mitglied Punkte, optional die Zeit im Format mm:ss und die erreichten Checkpoints. Die Bestenliste sortiert nach Punkten, bei Gleichstand nach der Zeit. Eigene Ergebnisse kannst du jederzeit löschen.',
  },
  {
    title: 'Notizblock',
    text: 'Unter „Notizblock“ schreibst du Notizen nur für dich (Solo) oder für eine Organisation. Notizen einer Organisation bearbeitet, wer dort beim Notizblock „Lesen & Schreiben“ hat; mit „Lesen“ siehst du sie nur. Der Text unterstützt Markdown mit Werkzeugleiste und Vorschau (siehe „Text formatieren“). Mit „Anheften“ bleibt eine Notiz oben. Über das Suchfeld findest du Notizen nach Titel und Text.',
  },
  {
    title: 'ToDos und Deadlines',
    text: 'Unter „ToDos“ legst du Aufgaben für dich (Solo) oder eine Organisation an, auf Wunsch mit Deadline, und hakst sie per Kästchen ab. Zu offenen ToDos mit Deadline erscheint eine Benachrichtigung in der Glocke: einen Tag vorher, am Fälligkeitstag und einmal, wenn das ToDo überfällig ist. ToDos einer Organisation erinnern alle Mitglieder, die sie sehen dürfen. Unter „Einstellungen → Benachrichtigungen“ kannst du das bei „ToDo-Deadlines“ abschalten oder zusätzlich per E-Mail bekommen. Mit „Lesen & Schreiben“ änderst und hakst du sie ab, mit „Lesen“ siehst du sie nur.',
  },
  {
    title: 'Fallakten',
    text: 'Unter „Akten → Fallakten“ führst du Vorgänge wie bei Polizei, Rettungsdienst oder Verwaltung, solo oder in einer Organisation. Eine Akte hat Aktenzeichen (leer gelassen automatisch, z. B. 2026-0001), Titel, Priorität (niedrig bis dringend), Tat- bzw. Einsatzzeit und -ort, Sachbearbeitung, Status offen, ruhend oder abgeschlossen und den Sachverhalt. Die Akte ist in Tabs gegliedert: „Übersicht“ mit beteiligten Personen (Rolle wie Beschuldigte/r, Zeuge/Zeugin, Patient/in), Fahrzeugen (Kennzeichen, Rolle, Halter) und verknüpften Akten desselben Bereichs; „Berichte“, „Anklagen“, „Beweismittel“, „Fahndungen“, „Verlauf“ mit datierten Einträgen und „Anhänge“ (PDF, PNG, JPEG). Gesucht wird über Aktenzeichen, Titel, Sachverhalt, Ort, Personen samt Alias und Kennzeichen. „Drucken“ gibt die ganze Akte aus. Rechte: Mit „Lesen“ siehst du Akten, mit „Lesen & Schreiben“ erfasst du alles darin, mit „Verwalten“ gibst du Berichte frei, entscheidest über Anklagepunkte, löschst Akten und beschränkst sie. Unter „Aktenarten“ legst du Arten wie Ermittlungsakte, Patientenakte oder Personalakte mit eigenen Rechten an; über „Zugriff“ beschränkst du eine einzelne Akte auf Ränge (und alle höheren), Gruppen oder Mitglieder. Jede Änderung steht im Audit-Log.',
  },
  {
    title: 'Berichte',
    text: 'Im Tab „Berichte“ einer Akte schreibst du Einsatz-, Festnahme-, Unfall- oder Behandlungsberichte. „Neuer Bericht“ übernimmt auf Wunsch eine Vorlage mit vorgegebenen Abschnitten; fertige Vorlagen für Polizei, Rettungsdienst und allgemein übernimmst du unter „Berichtsvorlagen“. Ein Bericht ist zuerst ein Entwurf, den nur du und wer Berichte freigeben darf sehen. „Einreichen“ schickt ihn zur Freigabe: Wer bei Akten „Verwalten“ hat, bekommt eine Meldung und gibt ihn frei oder mit Begründung zurück. Den eigenen Bericht gibt eine zweite Person frei (Vier-Augen-Prinzip), nur Inhaber dürfen das selbst. Freigegebene Berichte sind gesperrt und bleiben in der Akte; Korrekturen kommen als „Nachtrag“. In einer privaten Akte schließt du Berichte selbst ab.',
  },
  {
    title: 'Strafkatalog und Anklagepunkte',
    text: 'Unter „Akten → Strafkatalog“ pflegt, wer bei Akten „Verwalten“ hat, die Tatbestände eines Bereichs: Paragraph, Bezeichnung, Kategorie, Geldstrafe, Haft in Hafteinheiten (HE) und Punkte. Große Kataloge kommen per CSV (Paragraph, Bezeichnung, Kategorie, Geldstrafe, Haft, Punkte, Beschreibung; erst prüfen, dann importieren, vorhandene Paragraphen werden aktualisiert) und lassen sich als CSV exportieren. Im Tab „Anklagen“ einer Akte erfasst du gegen beteiligte Personen Anklagepunkte aus dem Katalog oder frei, mit Anzahl; Strafen lassen sich im Einzelfall anpassen. Je Person stehen die Summen offen und verurteilt darunter. Über „Entscheiden“ setzt, wer verwalten darf, verurteilt, eingestellt oder freigesprochen. Verurteilte Punkte erscheinen in der Personenakte als Vorstrafen. Ein Anklagepunkt behält den Stand des Katalogs, auch wenn der Katalog sich später ändert.',
  },
  {
    title: 'Beweismittel und Fahndungen',
    text: 'Im Tab „Beweismittel“ sicherst du Gegenstände und Spuren mit Beschreibung, Art, Fundort, Fundzeit, zugehöriger Person und Lagerort; sie werden je Akte durchnummeriert (A-1, A-2 …). „Vorgang“ hält Übergaben und Statuswechsel fest (sichergestellt, in Untersuchung, eingelagert, herausgegeben, vernichtet); die Übergabekette lässt sich nicht nachträglich ändern. Im Tab „Fahndungen“ schreibst du Haftbefehle, Durchsuchungsbeschlüsse, Aufenthaltsermittlungen (für beteiligte Personen) oder Fahrzeugfahndungen (per Kennzeichen) aus, optional befristet; „Vollstreckt“ und „Aufheben“ erledigen sie. Unter „Akten → Fahndung“ stehen alle aktiven Fahndungen aus Akten, die du sehen darfst, mit Schnellabfrage nach Name, Alias oder Kennzeichen.',
  },
  {
    title: 'Personenakten',
    text: 'Unter „Akten → Personenakten“ findest du zu jeder Person, was ein Bereich (deine Organisation oder privat) über sie weiß: Foto und Stammdaten (Geburtsdatum, Geschlecht, Größe, Staatsangehörigkeit, Adresse, Alias, besondere Merkmale – global wie die Person), dazu je Bereich Warnhinweise wie „Bewaffnet“ oder „Fluchtgefahr“, Vermerke und medizinische Angaben (Blutgruppe, Allergien, Vorerkrankungen, Medikamente, Notfallkontakt). Darunter stehen aktive Fahndungen, Vorstrafen mit Summen, Fallakten mit Rolle, Berichte, Beweismittel, Fahrzeuge als Halter, Einträge, Lizenzen und Schulungen – jeweils nur, soweit du sie sehen darfst. Die Liste zeigt Gesuchte zuerst und filtert nach Akten, Fahndungen und Warnhinweisen. Personenakten bearbeitet, wer bei Akten „Lesen & Schreiben“ hat; Stammdaten und Foto, wer Personen ändern darf. Aus einer Fallakte führt „Personenakte“ direkt hin.
  },
  {
    title: 'Lizenzen',
    text: 'Unter „Lizenzen → Lizenzarten“ legst du zuerst Arten wie Führerschein oder Waffenschein an, optional mit einer Standard-Gültigkeit in Monaten. Danach stellst du Lizenzen an Personen aus: mit Nummer, Aussteller, Ausstellungsdatum und Ablauf. Lässt du „Gültig bis“ leer, gilt die Standard-Gültigkeit der Art; „Unbefristet“ setzt keinen Ablauf. Über „Bearbeiten“ sperrst oder entziehst du eine Lizenz mit Begründung, „Verlängern“ verlängert um die Standard-Gültigkeit. 30 Tage vor dem Ablauf und noch einmal danach erinnert die Glocke; das stellst du unter „Einstellungen → Benachrichtigungen“ bei „Lizenzen laufen ab“ ein. Der Ablauf erscheint auch im Kalender.',
  },
  {
    title: 'Schulungen',
    text: 'Unter „Schulungen“ legst du eine Schulung mit Beschreibung und optionaler Gültigkeit in Monaten an. In der Schulung planst du Termine und trägst Teilnehmer ein: Benutzer (in einer Organisation alle Mitglieder) oder Personen. Mit „Ergebnis erfassen“ setzt du bestanden, nicht bestanden oder nicht erschienen. Ein bestandener Nachweis gilt ab dem Abschlussdatum so lange wie die Schulung vorgibt, sonst unbefristet. Die „Übersicht“ zeigt, wer welche Schulung hat und was bald abläuft. Termine und Abläufe stehen im Kalender; 30 Tage vor dem Ablauf erinnert die Glocke. Wer in der Organisation nur „Teilnehmen“ hat, sieht Schulungen und Termine und meldet sich über „Anmelden“ selbst an oder wieder ab, sieht aber keine Teilnehmer und keine Ergebnisse.',
  },
  {
    title: 'Dokumentationen',
    text: 'Unter „Dokumentationen“ sammelst du Nachschlagewerke wie Gesetze oder Funktionen. Kategorien legst du selbst an, solo oder für eine Organisation, und ordnest sie über die Reihenfolge; in der Organisation kann jede Kategorie eigene Rechte haben, etwa eine interne Kategorie nur für die Leitung. Seiten unterstützen einfache Formatierung: # Überschrift, **fett**, *kursiv*, - Listen, 1. nummerierte Listen, > Zitate, --- Trennlinien und Links wie [Text](https://…). Die Suche durchsucht Titel und Text aller Seiten, die du sehen darfst. Mit „Lesen & Schreiben“ schreibst du Seiten, mit „Verwalten“ löschst du sie und verwaltest Kategorien. Eine Kategorie lässt sich erst löschen, wenn sie leer ist.',
  },
  {
    title: 'Text formatieren (Markdown)',
    text: 'In Notizen, ToDo-Notizen, im Sachverhalt und in Einträgen von Akten, in Schulungsbeschreibungen, Streckennotizen, Beschreibungen von Lizenzarten, Dokumentationen sowie in Tickets und deren Kommentaren schreibst du Markdown wie auf GitHub: Überschriften (# bis ######), **fett**, *kursiv*, ~~durchgestrichen~~, `Code` und Codeblöcke mit ```, verschachtelte und nummerierte Listen, Aufgabenlisten mit - [ ] und - [x], Zitate, Hinweis-Kästen mit > [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] oder [!CAUTION], Tabellen, Trennlinien, Fußnoten mit [^1], Links wie [Text](https://…) und Adressen, die automatisch zu Links werden. [Text](#/casefiles) öffnet eine Seite der App. Die Werkzeugleiste über dem Textfeld fügt all das ein und nimmt es beim zweiten Klick wieder weg; „Vorschau“ zeigt das Ergebnis, „Nebeneinander“ beides zugleich, „Vollbild“ gibt dir die ganze Seite (Esc beendet es), „?“ öffnet einen Spickzettel. Kürzel: Strg+B fett, Strg+I kursiv, Strg+K Link, Strg+E Code, Strg+H Überschrift, Strg+Umschalt+7/8/9 nummerierte Liste, Aufzählung, Aufgaben; Enter setzt Listen fort, Tab rückt Listenpunkte ein, eine eingefügte Adresse über markiertem Text wird zum Link. Ein Zeilenumbruch bleibt ein Zeilenumbruch. Bilder aus dem Internet erscheinen zum Schutz deiner Daten als Link statt eingebettet. HTML wird als Text angezeigt; nur wenige harmlose Tags wie <kbd>, <sub>, <sup>, <mark> und <br> wirken. Gespeichert wird dein Text unverändert, Links öffnen sich in einem neuen Tab. In der Notiz eines Stundenzettel-Eintrags wirkt nur die Formatierung innerhalb einer Zeile.',
  },
  {
    title: 'Personen',
    text: 'Personen gibt es nur einmal für das ganze System: Alle mit Zugriff auf „Personen“ sehen dieselbe Liste und können jede Person in Schlüsseln, Häusern, Akten, Lizenzen und Schulungen verwenden, egal in welcher Organisation. Eine Person gehört deshalb keiner Organisation und ist nie privat; was in Notiz, Telefon und E-Mail steht, sehen alle. Wer Personen anlegen, ändern und löschen darf, legen die Rollen in der Administration fest; jede Änderung steht im Audit-Log. „Personenakte“ öffnet alles zu einer Person unter „Akten“ (siehe „Personenakten“); ohne Zugriff auf Akten zeigt „Übersicht“ Lizenzen und Schulungen. Akten einer fremden Organisation bleiben immer verborgen. Eine Person mit Akten, Lizenzen oder Schulungsnachweisen lässt sich nicht löschen; setze sie stattdessen auf inaktiv.',
  },
  {
    title: 'Personen per CSV importieren und exportieren',
    text: '„CSV-Export“ lädt die ganze Personenliste als Datei, die Excel und LibreOffice öffnen. Mit „CSV-Import“ liest du eine solche Datei wieder ein: Die erste Zeile nennt die Spalten (Name ist Pflicht; dazu Art, Funktion, Telefon, E-Mail, Aktiv, Notiz und ID), getrennt durch Semikolon, Komma oder Tab, gespeichert als UTF-8 oder wie bei Excel üblich als Windows-1252. „Prüfen“ zeigt zuerst, was passieren würde, samt Zeilennummer bei jedem Fehler; erst „Importieren“ schreibt. Zeilen mit ID ändern die vorhandene Person, Zeilen ohne ID legen eine neue an. Gibt es den Namen schon, wird die Zeile übersprungen, so legt ein zweiter Import derselben Datei nichts doppelt an. Fehlt eine Spalte, bleibt sie bei vorhandenen Personen unverändert. Am einfachsten: exportieren, in Excel bearbeiten, wieder importieren. Exportieren braucht das Recht „Personen exportieren“, Importieren „Personen anlegen“ und für Änderungen zusätzlich „Personen ändern“. Export und Import stehen im Audit-Log.',
  },
  {
    title: 'Fahrzeuge und Häuser',
    text: 'Unter „Object Management“ hat jeder Bereich eine eigene Seite. Bei Fahrzeugen erfasst du Besitzer, Service-Termine und das Ablaufdatum des Verbandskastens, bei Häusern Adresse, Wartung und einen Tür-PIN. Beim Anlegen sind Fahrzeuge, Häuser und Schlüssel privat; pro Eintrag kannst du sie einer Organisation freigeben. Personen sind dagegen immer für alle da. Mit einem Preis werden Kosten automatisch auf dem gewählten Konto verbucht. „Verwaltung“ bündelt Übersicht, Kosten, Protokoll und, sofern du das Recht hast, das Auditlog.',
  },
  {
    title: 'Schlüssel verwalten und ausgeben',
    text: 'Lege Schlüssel mit einer frei eingebbaren Art an und ordne sie einem Haus oder Fahrzeug zu. „Anzahl Kopien“ gibt die verfügbaren Exemplare an. Über die Schlüsselzahl am Objekt gelangst du direkt zu den zugehörigen Schlüsseln. Die Inventur zeigt Gesamtbestand, ausgegebene und verlorene Exemplare. Schlüssel können an aktive Personen ausgegeben, mit einem Rückgabedatum versehen, zurückgenommen oder als verloren markiert werden. Über „QR“ wird ein Code für einen Schlüssel erstellt; scanne ihn in der Schlüsselansicht, um den Eintrag zu öffnen.',
  },
  {
    title: 'Tür-PINs schützen',
    text: 'Tür-PINs sind verschlüsselt gespeichert und erscheinen nie in der normalen Objektliste. Zum Anzeigen oder Ändern klicke auf das Augen-Symbol beziehungsweise „PIN ändern“ und bestätige dein Passwort; bei aktivierter Zwei-Faktor-Authentifizierung ist zusätzlich der 2FA-Code erforderlich. Zugriffe werden protokolliert. Andere Passwortfelder sind standardmäßig verdeckt und lassen sich über das Augen-Symbol einblenden.',
  },
  {
    title: 'Kalender und Erinnerungen',
    text: 'Der Kalender fasst eigene Termine und automatisch erstellte Hinweise wie Zahlungen, Service-, Wartungs- und Schlüsselrückgabetermine zusammen. Täglich morgens prüft das System fällige Punkte; Erinnerungen an Termine, Fahrzeug-Service, Verbandskasten und Schlüsselrückgaben erscheinen in der Glocke oben. In den Einstellungen legst du fest, welche Benachrichtigungen du bekommst.',
  },
  {
    title: 'Berichte und Export',
    text: 'Berichte helfen beim Auswerten deiner Daten und lassen sich auch regelmäßig per E-Mail versenden. Transaktionen und Stundenzettel kannst du als CSV exportieren, den Monatsstundenzettel zusätzlich als PDF. Einen Export aller deiner Daten findest du in den Einstellungen im Profil.',
  },
  {
    title: 'Datenschutz und Gravatar',
    text: 'Es gibt kein Tracking; gespeichert wird nur, was für die Anmeldung und deine Einstellungen nötig ist. Gravatar ist standardmäßig ausgeschaltet. Erst wenn du es unter „Einstellungen → Darstellung“ aktivierst, wird ein Hash deiner E-Mail-Adresse an gravatar.com gesendet. Details stehen in der Datenschutzerklärung, die wie das Impressum auch ohne Anmeldung erreichbar ist.',
  },
  {
    title: 'Administration',
    text: 'Administratoren finden unter „User-Management“ Benutzer, Rollen, Gruppen und Organisationen, unter „Server-Management“ Übersicht, Sicherheit und Einstellungen, System und Backups, Integrationen und das Audit-Log, unter „Tickets“ gemeldete Fehler. Dort lässt sich auch der App-Name ändern, der dann überall angezeigt wird.',
  },
  {
    title: 'Fehler melden',
    text: 'Unter „Fehler melden“ beschreibst du ein Problem mit Titel, Beschreibung und den Schritten, die dazu geführt haben. Die Meldung erscheint bei den Administratoren unter „Tickets“.',
  },
  {
    title: 'Tickets kommentieren und löschen',
    text: 'Unter jedem Ticket schreiben Melder und Administratoren Kommentare; die jeweils andere Seite bekommt dazu eine Benachrichtigung. Eigene Kommentare kannst du löschen, Administratoren jeden. Das ganze Ticket löschen kann der Melder oder ein Administrator, samt allen Kommentaren. Kommentare bleiben intern, und ein verknüpftes GitHub-Issue bleibt beim Löschen bestehen.',
  },
  {
    title: 'Häufige Fragen: Warum weicht die Arbeitszeit ab?',
    text: 'Pausen werden bei der Zeiterfassung nicht als Arbeitszeit gezählt. Prüfe bei manuellen Einträgen die eingetragene Pause. Das Monats-Soll verteilt deine Wochen-Sollzeit gleichmäßig auf alle Kalendertage des Monats (Wochen-Soll × Kalendertage ÷ 7); Feiertage werden nicht abgezogen.',
  },
  {
    title: 'Häufige Fragen: Was ist der Unterschied zwischen Konto und Budget?',
    text: 'Ein Konto hält dein Geld und zeigt den Kontostand aus Einnahmen und Ausgaben. Ein Budget ist nur eine Obergrenze, die deine Ausgaben im gewählten Zeitraum überwacht; es bucht nichts und sperrt auch keine Ausgaben.',
  },
  {
    title: 'Häufige Fragen: Warum habe ich noch kein Gehalt erhalten?',
    text: 'Prüfe unter „Stundenzettel → Gehalt einstellen“, ob ein Konto für die Gehaltsgutschrift gewählt und ein Festgehalt eingetragen ist. Die Gutschrift erfolgt immer nachts für den Vortag, also frühestens am Tag nach dem Einrichten. Läuft um 03:45 Uhr noch dein Timer, wartet die Gutschrift, bis du ausstempelst.',
  },
  {
    title: 'Häufige Fragen: Warum kann ich kein Gehaltskonto auswählen?',
    text: 'Gehalt wird nur auf ein eigenes persönliches Konto in deiner Profilwährung gebucht. Konten einer Organisation und Konten in einer anderen Währung stehen deshalb in der Liste, sind aber nicht wählbar. Fehlt ein passendes Konto, lege es unter „Konten“ an; neue Konten erhalten automatisch deine Profilwährung.',
  },
  {
    title: 'Häufige Fragen: Warum sehe ich keine Sportstrecken?',
    text: 'Strecken gehören immer einer Organisation. Du siehst sie, wenn du dort bei Sport mindestens „Lesen“ hast; damit trägst du auch eigene Ergebnisse ein. Strecken anlegen und ändern braucht „Lesen & Schreiben“.',
  },
  {
    title: 'Organisationen, Ränge und Gruppen',
    text: 'Unter „Organisationen“ (früher Teams) arbeitest du mit anderen zusammen. Jedes Mitglied hat einen Rang; Ränge haben eine Reihenfolge, der höchste steht oben. Neue Organisationen beginnen mit Leitung, Mitglied und Leser. Gruppen fassen Mitglieder unabhängig vom Rang zusammen, etwa Abteilungen; ein Mitglied kann in mehreren Gruppen sein. Inhaber dürfen alles; eine Organisation braucht immer mindestens einen Inhaber. Wer Mitglieder verwalten darf, lädt ein, entfernt und vergibt Ränge und Gruppen – aber nur unter dem eigenen Rang. Mit „Verlassen“ trittst du selbst aus.',
  },
  {
    title: 'Rechte in einer Organisation',
    text: 'Unter „Organisationen → Rechte“ stellst du für jeden Rang, jede Gruppe und auf Wunsch für einzelne Mitglieder ein, was sie in jeder Funktion dürfen: Kein Zugriff, Teilnehmen (nur bei Schulungen und Stundenzettel), Lesen, Lesen & Schreiben oder Verwalten. Es gilt das höchste Recht aus Rang und Gruppen. Ist für ein Mitglied persönlich etwas eingestellt, gilt genau das, auch wenn es weniger ist. Für Aktenarten und Doku-Kategorien gibt es eigene Zeilen, die dem allgemeinen Recht vorgehen. Niemand vergibt mehr, als er selbst hat; höhere Stufen sind ausgegraut. Unter „Übersicht“ siehst du deine eigenen Rechte. Die allgemeinen Rechte deiner Rolle aus der Administration gelten zusätzlich: Fehlt dir dort zum Beispiel „Akten lesen“, siehst du keine Akten.',
  },
  {
    title: 'Häufige Fragen: Eine Seite wirkt nach einem Update veraltet',
    text: 'Lade die Seite einmal neu (F5). Cache löschen ist nicht nötig. Ein Tab, der während eines Updates offen war, aktualisiert sich normalerweise beim nächsten Seitenwechsel von selbst.',
  },
  {
    title: 'Häufige Fragen: Warum fehlt eine Buchung im Saldo?',
    text: 'Dashboard und Kontostand zeigen nur, was heute wirklich auf dem Konto ist: Einnahmen minus Ausgaben bis zum heutigen Tag. Eine Buchung mit Datum in der Zukunft zählt erst ab diesem Datum, steht aber schon unter „Transaktionen“. Einzahlungen auf ein Sparziel ändern den Saldo nicht, denn das Geld bleibt auf dem Konto und ist nur für das Ziel vorgemerkt.',
  },
  {
    title: 'Häufige Fragen: Warum darf ich etwas einer Organisation nicht ändern?',
    text: 'Dein Rang, deine Gruppen oder ein persönlich gesetztes Recht erlauben dort nur Lesen. Welche Stufe du in welcher Funktion hast, zeigt „Organisationen → Übersicht“. Beim Speichern nennt der Hinweis die fehlende Stufe; bitte jemanden mit „Verwalten“ bei „Mitglieder & Ränge“, sie dir zu geben.',
  },
  {
    title: 'Häufige Fragen: Warum kann ich einen Kalendertermin nicht ändern?',
    text: 'Automatische Termine wie Zahlungen, Service oder Feiertage stammen aus anderen Bereichen und sind schreibgeschützt. Ändere sie dort, wo sie entstehen, zum Beispiel beim Fahrzeug oder Dauerauftrag. Eigene Termine kannst du per Klick bearbeiten und löschen.',
  },
  {
    title: 'Häufige Fragen: Was tun, wenn ein Schlüssel verloren geht?',
    text: 'Öffne „Schlüssel“, gehe zum passenden Schlüssel und wähle bei der ausgegebenen Kopie „verloren“. Die Kopie bleibt im Inventar als verloren sichtbar und kann nicht erneut ausgegeben werden.',
  },
  {
    title: 'Häufige Fragen: Warum kann ich einen PIN nicht sehen?',
    text: 'Tür-PINs werden nur nach Bestätigung mit deinem aktuellen Passwort angezeigt. Wenn Zwei-Faktor-Authentifizierung aktiv ist, gib zusätzlich den aktuellen 2FA-Code ein. Fehlt ein PIN, kannst du ihn mit „PIN ändern“ hinterlegen.',
  },
];

export async function render(view) {
  view.innerHTML = `<div class="page-head"><div><h1>Hilfe</h1><p>So funktionieren die wichtigsten Bereiche</p></div></div>
    <div class="card"><label class="field">Hilfe durchsuchen<input id="help-search" type="search" placeholder="z. B. Budget, Gehalt, ToDo, PIN"></label><p class="muted" id="help-count" aria-live="polite"></p></div>
    <div class="grid cols-2" id="help-results">${sections.map(({ title, text }, index) => `<section class="card" data-help-item="${index}"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p></section>`).join('')}</div>`;
  const search = $('#help-search', view);
  const items = [...view.querySelectorAll('[data-help-item]')];
  const count = $('#help-count', view);
  const results = $('#help-results', view);
  search.addEventListener('input', () => {
    const query = search.value.trim().toLocaleLowerCase('de');
    let visible = 0;
    for (const item of items) {
      const matches = item.textContent.toLocaleLowerCase('de').includes(query);
      item.hidden = !matches;
      if (matches) visible++;
    }
    count.textContent = query ? `${visible} ${visible === 1 ? 'Anleitung gefunden' : 'Anleitungen gefunden'}` : '';
    let noResults = $('#help-no-results', results);
    if (!visible && !noResults) {
      results.insertAdjacentHTML('beforeend', '<p class="muted" id="help-no-results">Keine passende Anleitung gefunden.</p>');
      noResults = $('#help-no-results', results);
    }
    if (noResults) noResults.hidden = visible > 0;
  });
}
