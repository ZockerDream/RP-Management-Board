import { $, esc } from '../ui.js';

const sections = [
  {
    title: 'Konten und Kategorien',
    text: 'Unter „Konten“ legst du persönliche oder geteilte Team-Konten an. Jede Karte zeigt Kontostand, Einkommen und Ausgaben. Kategorien teilen die Buchungen eines Kontos auf und können ein eigenes Limit haben. Wähle ein Konto aus, um seine Kategorien zu sehen.',
  },
  {
    title: 'Budgets: Ausgaben begrenzen',
    text: 'Unter „Budgets“ legst du Ausgabenlimits an, zum Beispiel 100 € pro Woche für Lebensmittel. Wähle Betrag und Zeitraum (Tag, Woche, Monat oder Jahr) und optional ein Konto oder eine Kategorie. Die Karte zeigt, was im laufenden Zeitraum verbraucht ist, was noch übrig bleibt und um wie viel du überzogen hast. Budgets sind nur für dich sichtbar. Ein Budget zu löschen, ändert keine Buchungen.',
  },
  {
    title: 'Daueraufträge und Zeitintervalle',
    text: 'Daueraufträge buchen wiederkehrende Einnahmen oder Ausgaben automatisch. Wähle täglich, wöchentlich, monatlich oder jährlich und stelle bei Bedarf die Anzahl der Einheiten ein. „Benutzerdefiniert“ verwendet einen selbst gewählten Abstand in Tagen. Ein Enddatum ist optional. Du kannst einen Auftrag zusätzlich mit einem Nutzer aus deinem Team teilen. Nach dessen Zustimmung wird der volle Betrag auch in dessen persönlichem Konto verbucht; beide Konten müssen dieselbe Währung verwenden.',
  },
  {
    title: 'Stundenzettel',
    text: 'Unter „Stundenzettel“ kannst du mit „Einstempeln“ eine Zeiterfassung starten, pausieren und mit „Ausstempeln“ beenden. Pausen werden nicht als Arbeitszeit gezählt. Die Tages-, Wochen- und Monatsansicht zeigt erfasste Zeiten; Monatsübersicht und PDF enthalten Arbeitszeit, Sollzeit und Überstundensaldo. Die wöchentliche Sollzeit stellst du im Profil ein. Einzelne Einträge lassen sich manuell ergänzen, bearbeiten oder löschen. Projekte können privat oder im Team geführt werden.',
  },
  {
    title: 'Gehalt und Überstunden',
    text: 'Trage im Profil Wochen-Sollzeit, Stundenlohn und Überstundenzuschlag ein und wähle ein persönliches Konto für die Gehaltsgutschrift. Das Basisgehalt wird dann täglich gegen 03:45 Uhr für den Vortag gutgeschrieben, auch am Wochenende und unabhängig von deiner Anwesenheit. Erfasste Stunden über dem Wochen-Soll (Montag bis Sonntag) werden zusätzlich mit Stundenlohn plus Zuschlag vergütet. Die erste Gutschrift erscheint daher frühestens am Folgetag.',
  },
  {
    title: 'Sport: Strecken und Bestenliste',
    text: 'Unter „Laufen“, „Schwimmen“ und „Biken“ sehen Teammitglieder die Strecken ihres Teams. Team-Owner und -Editoren legen Strecken mit Checkpoints und optionaler Distanz an. Über „Ergebnis eintragen“ erfasst jedes Mitglied Punkte, optional die Zeit im Format mm:ss und die erreichten Checkpoints. Die Bestenliste sortiert nach Punkten, bei Gleichstand nach der Zeit. Eigene Ergebnisse kannst du jederzeit löschen.',
  },
  {
    title: 'Fahrzeuge und Häuser',
    text: 'Unter „Object Management“ hat jeder Bereich eine eigene Seite. Bei Fahrzeugen erfasst du Besitzer, Service-Termine und das Ablaufdatum des Verbandskastens, bei Häusern Adresse, Wartung und einen Tür-PIN. Beim Anlegen sind Einträge privat; pro Eintrag kannst du sie einem Team freigeben. Mit einem Preis werden Kosten automatisch auf dem gewählten Konto verbucht. „Verwaltung“ bündelt Übersicht, Kosten, Protokoll und, sofern du das Recht hast, das Auditlog.',
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
    text: 'Administratoren finden unter „User-Management“ Benutzer, Rollen, Gruppen und Teams, unter „Server-Management“ Übersicht, Sicherheit und Einstellungen, System und Backups, Integrationen und das Audit-Log, unter „Tickets“ gemeldete Fehler. Dort lässt sich auch der App-Name ändern, der dann überall angezeigt wird.',
  },
  {
    title: 'Fehler melden',
    text: 'Unter „Fehler melden“ beschreibst du ein Problem mit Titel, Beschreibung und den Schritten, die dazu geführt haben. Die Meldung erscheint bei den Administratoren unter „Tickets“.',
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
    text: 'Prüfe im Profil, ob ein Konto für die Gehaltsgutschrift gewählt ist und ein Stundenlohn eingetragen ist. Die Gutschrift erfolgt immer nachts für den Vortag, also frühestens am Tag nach dem Einrichten.',
  },
  {
    title: 'Häufige Fragen: Warum sehe ich keine Sportstrecken?',
    text: 'Strecken gehören immer einem Team. Du siehst sie nur als Mitglied dieses Teams. Anlegen können sie Team-Owner und -Editoren; als Viewer kannst du Ergebnisse eintragen, aber keine Strecken verwalten.',
  },
  {
    title: 'Teams und Rollen',
    text: 'In „Teams“ lädst du Mitglieder ein und vergibst Rollen. Owner dürfen alles, Editoren buchen und bearbeiten, Viewer sehen nur und tragen Sportergebnisse ein. Ein Team braucht immer mindestens einen Owner; als letzter Owner kannst du es erst verlassen, wenn du die Rolle weitergegeben hast. Mit „Verlassen“ verlässt du ein Team selbst.',
  },
  {
    title: 'Häufige Fragen: Warum fehlt eine Buchung im Saldo?',
    text: 'Dashboard und Kontostand zeigen nur, was heute wirklich auf dem Konto ist: Einnahmen minus Ausgaben bis zum heutigen Tag. Eine Buchung mit Datum in der Zukunft zählt erst ab diesem Datum, steht aber schon unter „Transaktionen“. Einzahlungen auf ein Sparziel ändern den Saldo nicht, denn das Geld bleibt auf dem Konto und ist nur für das Ziel vorgemerkt.',
  },
  {
    title: 'Häufige Fragen: Warum darf ich ein Team-Objekt nicht speichern?',
    text: 'Als Viewer eines Teams kannst du dessen Objekte ansehen, aber nicht ändern. Beim Speichern erscheint dann ein Hinweis. Bitte einen Team-Owner, dir die Rolle Editor zu geben.',
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
    <div class="card"><label class="field">Hilfe durchsuchen<input id="help-search" type="search" placeholder="z. B. Budget, Gehalt, Sport, PIN"></label><p class="muted" id="help-count" aria-live="polite"></p></div>
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
