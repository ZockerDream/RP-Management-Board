// Markdown-Liste einer Fuhrpark-Kontrollrunde im Format, das der Fuhrpark bisher von Hand gepostet hat.
// Ohne Datenbank, damit der Unit-Test das Format genau prüfen kann.
const CHECK = '✔️';

const day = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');
const shortDay = (d) => {
  if (!d) return '';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}.${m}.${y.slice(2)}`;
};
// Tabellenzellen dürfen weder | noch Zeilenumbrüche enthalten; ein \ am Ende würde das folgende | maskieren
const cell = (v) => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').trim();
const row = (cells) => `|${cells.join('|')}|`;

export function fleetMarkdown(check, sections) {
  const out = [`Stand: ${day(check.checked_on)}`, '', `Erledigt?:${check.done ? ` ${CHECK}` : ''}`];
  for (const s of sections) {
    if (!s.items?.length) continue;
    const head = s.show_model
      ? ['Kennzeichen', 'Fahrzeug', 'KM-Stand', 'Letzte Wartung', 'Verbandkasten', 'Zubehör vollst.', 'Notizen']
      : ['Kennzeichen', 'KM Stand', 'Letzte Wartung', 'Verbandkasten', 'Zubehör vollst.', 'Notizen'];
    out.push('', `### ${cell(s.name)}`, '', row(head), row(head.map(() => '---')));
    for (const i of s.items) {
      const cells = [cell(i.plate)];
      if (s.show_model) cells.push(cell(i.model));
      cells.push(i.odometer_km ?? '', day(i.last_service_on), shortDay(i.first_aid_kit_until), i.accessories_complete ? CHECK : '', cell(i.note));
      out.push(row(cells));
    }
  }
  return `${out.join('\n')}\n`;
}
