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
    text: 'Unter „Notizblock“ schreibst du Notizen nur für dich (Solo) oder für eine Organisation. Notizen einer Organisation bearbeitet, wer dort beim Notizblock „Lesen & Schreiben“ hat; mit „Lesen“ siehst du sie nur. Der Text unterstützt Markdown, etwa **fett**, Listen und Links. Mit „Anheften“ bleibt eine Notiz oben. Über das Suchfeld findest du Notizen nach Titel und Text.',
  },
  {
    title: 'ToDos und Deadlines',
    text: 'Unter „ToDos“ legst du Aufgaben für dich (Solo) oder eine Organisation an, auf Wunsch mit Deadline, und hakst sie per Kästchen ab. Zu offenen ToDos mit Deadline erscheint eine Benachrichtigung in der Glocke: einen Tag vorher, am Fälligkeitstag und einmal, wenn das ToDo überfällig ist. ToDos einer Organisation erinnern alle Mitglieder, die sie sehen dürfen. Unter „Einstellungen → Benachrichtigungen“ kannst du das bei „ToDo-Deadlines“ abschalten oder zusätzlich per E-Mail bekommen. Mit „Lesen & Schreiben“ änderst und hakst du sie ab, mit „Lesen“ siehst du sie nur.',
  },
  {
    title: 'Akten',
    text: 'Unter „Akten“ führst du Vorgänge, solo oder in einer Organisation. Jede Akte hat ein Aktenzeichen (leer gelassen wird es automatisch vergeben, z. B. 2026-0001), einen Titel, den Sachverhalt und einen Status: offen, ruhend oder abgeschlossen. In der Akte beteiligst du Personen mit einer Rolle wie Zeuge oder Beschuldigter, schreibst Einträge mit Datum und Art und lädst Anhänge hoch (PDF, PNG, JPEG). Ein Eintrag kann eine beteiligte Person betreffen und erscheint dann auch in ihrer Übersicht. Beteiligen lassen sich nur Personen aus demselben Bereich: in einer Organisation deren Personen, solo deine eigenen. Mit „Lesen“ siehst du Akten, mit „Lesen & Schreiben“ legst du sie an und schreibst Einträge, mit „Verwalten“ löschst du sie. Unter „Aktenarten“ legst du Arten wie Ermittlungsakte oder Personalakte an; in der Organisation bekommt jede Art eigene Rechte. Über „Zugriff“ beschränkst du eine einzelne Akte auf bestimmte Ränge (und alle höheren), Gruppen oder Mitglieder; Inhaber und wer die Akte angelegt hat, sehen sie immer. Jede Änderung steht im Audit-Log.',
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
    text: 'In Notizen, ToDo-Notizen, im Sachverhalt und in Einträgen von Akten, in Schulungsbeschreibungen, Streckennotizen, Beschreibungen von Lizenzarten, Dokumentationen sowie in Tickets und deren Kommentaren formatierst du Text mit einfachem Markdown: # Überschrift, **fett**, *kursiv*, `Code`, - Listen, 1. nummerierte Listen, > Zitate, --- Trennlinien und Links wie [Text](https://…). In der Notiz eines Stundenzettel-Eintrags wirken fett, kursiv, Code und Links. Gespeichert wird dein Text unverändert; HTML wird nicht ausgeführt, Links öffnen sich in einem neuen Tab.',
  },
  {
    title: 'Personenübersicht',
    text: 'Unter „Personen“ öffnet „Übersicht“ alles zu einer Person auf einen Blick: Akten, an denen sie beteiligt ist, Einträge zu ihr, Lizenzen und Schulungen, jeweils soweit deine Rechte reichen. Eine Person mit Akten, Lizenzen oder Schulungsnachweisen lässt sich nicht löschen und nicht zwischen Organisation und privat verschieben, damit diese Unterlagen vollständig und für die Beteiligten sichtbar bleiben; setze sie stattdessen auf inaktiv.',
  },
  {
    title: 'Fahrzeuge und Häuser',
    text: 'Unter „Object Management“ hat jeder Bereich eine eigene Seite. Bei Fahrzeugen erfasst du Besitzer, Service-Termine und das Ablaufdatum des Verbandskastens, bei Häusern Adresse, Wartung und einen Tür-PIN. Beim Anlegen sind Einträge privat; pro Eintrag kannst du sie einer Organisation freigeben. Mit einem Preis werden Kosten automatisch auf dem gewählten Konto verbucht. „Verwaltung“ bündelt Übersicht, Kosten, Protokoll und, sofern du das Recht hast, das Auditlog.',
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
