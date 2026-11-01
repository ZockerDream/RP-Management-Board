import { $, esc } from '../ui.js';

const sections = [
  {
    title: 'Budgets und Kategorien',
    text: 'Lege Budgets mit Tages-, Wochen-, Monats- oder Jahreszeitraum an. Ein benutzerdefinierter Zeitraum wird über Start- und Enddatum festgelegt. Kategorien helfen dabei, Ausgaben innerhalb eines Budgets aufzuteilen.',
  },
  {
    title: 'Daueraufträge und Zeitintervalle',
    text: 'Daueraufträge buchen wiederkehrende Einnahmen oder Ausgaben automatisch. Wähle täglich, wöchentlich, monatlich oder jährlich und stelle bei Bedarf die Anzahl der Einheiten ein. „Benutzerdefiniert“ verwendet einen selbst gewählten Abstand in Tagen. Ein Enddatum ist optional. Du kannst einen Auftrag zusätzlich mit einem Nutzer aus deinem Team teilen. Nach dessen Zustimmung wird der volle Betrag auch in dessen persönlichem Budget verbucht; beide Konten müssen dieselbe Währung verwenden.',
  },
  {
    title: 'Stundenzettel',
    text: 'Unter „Stundenzettel“ kannst du mit „Einstempeln“ eine Zeiterfassung starten, pausieren und mit „Ausstempeln“ beenden. Pausen werden nicht als Arbeitszeit gezählt. Die Tages-, Wochen- und Monatsansicht zeigt erfasste Zeiten; Monatsübersicht und PDF enthalten Arbeitszeit, Sollzeit und Überstundensaldo. Die wöchentliche Sollzeit stellst du im Profil ein und sie wird auf fünf Arbeitstage verteilt. Einzelne Einträge lassen sich manuell ergänzen, bearbeiten oder löschen. Projekte können privat oder im Team geführt werden.',
  },
  {
    title: 'Häuser, Fahrzeuge und Schlüssel',
    text: 'Häuser und Fahrzeuge werden in „Schlüssel & Objekte“ angelegt. Bei Häusern kann ein Tür-PIN hinterlegt werden; beim Bearbeiten ist er zunächst verborgen und lässt sich einblenden. Bei Fahrzeugen kannst du Besitzer, Service-Termine und das Ablaufdatum des Verbandskastens erfassen.',
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
    title: 'Kalender, Berichte und Export',
    text: 'Der Kalender fasst eigene Termine und automatisch erstellte Hinweise wie Service-, Wartungs-, Verbandskasten- und Schlüsselrückgabetermine zusammen. Fällige Punkte werden außerdem als Benachrichtigung angezeigt. Berichte und CSV-Exporte helfen beim Auswerten und Weiterverwenden deiner Daten.',
  },
  {
    title: 'Häufige Fragen: Warum weicht die Arbeitszeit ab?',
    text: 'Pausen werden bei der Zeiterfassung nicht als Arbeitszeit gezählt. Prüfe bei manuellen Einträgen die eingetragene Pause. Das Monatssoll verteilt deine persönliche Wochen-Sollzeit gleichmäßig auf die Werktage Montag bis Freitag; Feiertage werden nicht abgezogen.',
  },
  {
    title: 'Häufige Fragen: Was tun, wenn ein Schlüssel verloren geht?',
    text: 'Öffne „Schlüssel & Objekte“, gehe zum passenden Schlüssel und wähle bei der ausgegebenen Kopie „verloren“. Die Kopie bleibt im Inventar als verloren sichtbar und kann nicht erneut ausgegeben werden.',
  },
  {
    title: 'Häufige Fragen: Warum kann ich einen PIN nicht sehen?',
    text: 'Tür-PINs werden nur nach Bestätigung mit deinem aktuellen Passwort angezeigt. Wenn Zwei-Faktor-Authentifizierung aktiv ist, gib zusätzlich den aktuellen 2FA-Code ein. Fehlt ein PIN, kannst du ihn mit „PIN ändern“ hinterlegen.',
  },
];

export async function render(view) {
  view.innerHTML = `<div class="page-head"><div><h1>Hilfe</h1><p>So funktionieren die wichtigsten Bereiche</p></div></div>
    <div class="card"><label class="field">Hilfe durchsuchen<input id="help-search" type="search" placeholder="z. B. Schlüssel, PIN, Monats-PDF"></label><p class="muted" id="help-count" aria-live="polite"></p></div>
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
