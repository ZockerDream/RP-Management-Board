import { z } from 'zod';

// Zod 4 setzt Standardwerte auch bei .partial(). Ein PATCH würde fehlende Felder damit überschreiben.
export function patchSchema(schema) {
  return z.object(Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [
    key, (field instanceof z.ZodDefault ? field.removeDefault() : field).optional(),
  ])));
}

const LABELS = {
  achieved_on: 'Datum', active: 'Aktiv', address: 'Adresse', allDay: 'Ganztägig', amount: 'Betrag', archived: 'Archiviert', body: 'Text', booked_at: 'Datum',
  break_minutes: 'Pause', budget_id: 'Konto', category_id: 'Kategorie', checkpoints: 'Checkpoints', checkpoints_reached: 'Erreichte Checkpoints', code: 'Code',
  color: 'Farbe', copies: 'Anzahl Kopien', cost_amount: 'Kostenbetrag', cost_budget_id: 'Kostenkonto', cost_category_id: 'Kostenkategorie', cost_interval: 'Kostenintervall',
  cost_interval_count: 'Kostenabstand', currency: 'Währung', current: 'Aktuelles Passwort', daily_salary: 'Festgehalt', data_scope: 'Datenumfang', date: 'Datum',
  description: 'Beschreibung', distance_km: 'Distanz', due_at: 'Rückgabedatum', due_date: 'Deadline', duration_seconds: 'Zeit', email: 'E-Mail', end: 'Ende',
  end_date: 'Enddatum', ended_at: 'Ende', events: 'Ereignisse', expires_at: 'Ablaufdatum', first_aid_kit_expires_on: 'Verbandskasten', frequency: 'Rhythmus', from: 'Von',
  function: 'Funktion', goal_id: 'Sparziel', granularity: 'Ansicht', group_ids: 'Gruppen', hourly_bonus_percent: 'Bonus', hours: 'Stunden', income_kind: 'Einnahmeart',
  installment_amount: 'Rate', installment_frequency: 'Ratenrhythmus', installment_interval: 'Ratenabstand', interval: 'Abstand', kind: 'Art', label: 'Bezeichnung',
  limit_amount: 'Betrag', maintenance_due: 'Wartung', maintenance_note: 'Wartungshinweis', make_model: 'Marke und Modell', max_budgets: 'Max. Konten', member_ids: 'Mitglieder',
  month: 'Monat', name: 'Name', note: 'Notiz', notes: 'Notizen', odometer_km: 'Kilometerstand', password: 'Passwort', payroll_budget_id: 'Gehaltskonto', period_type: 'Zeitraum',
  periods: 'Anzahl Zeiträume', permissions: 'Rechte', person_id: 'Person', phone: 'Telefon', pin: 'PIN', plate: 'Kennzeichen', project_id: 'Projekt', property_id: 'Haus',
  recipient_user_id: 'Empfänger', recipients: 'Empfänger', registered_owner: 'Besitzer', remind: 'Erinnerung', repeat: 'Wiederholung', repeat_interval: 'Wiederholungsabstand',
  responsible_person_id: 'Verantwortlich', rhythm: 'Rhythmus', rhythm_interval: 'Abstand', role_ids: 'Rollen', scope: 'Sichtbarkeit', score: 'Punkte', service_due: 'Service',
  service_due_km: 'Service bei km', service_interval_km: 'Service-Intervall', sport_type: 'Sportart', start: 'Beginn', start_date: 'Startdatum', started_at: 'Beginn',
  status: 'Status', steps: 'Reproduktionsschritte', tags: 'Tags', target_amount: 'Zielbetrag', target_date: 'Zieldatum', team_id: 'Organisation', title: 'Titel',
  to: 'Bis', type: 'Typ', url: 'URL', vehicle_id: 'Fahrzeug', week_start: 'Wochenstart', weekly_work_hours: 'Wochen-Soll', work_date: 'Datum',
  // Akten, Lizenzen, Schulungen, Dokumentationen
  case_file_id: 'Akte', closed_on: 'Abgeschlossen am', completed_on: 'Abgeschlossen am', end_time: 'Ende', entry_date: 'Datum', file_number: 'Aktenzeichen',
  instructor: 'Ausbilder', issued_on: 'Ausgestellt am', issuer: 'Ausgestellt von', location: 'Ort', number: 'Nummer', opened_on: 'Eröffnet am',
  people: 'Personen', pinned: 'Angeheftet', q: 'Suche', result: 'Ergebnis', role: 'Rolle', session_date: 'Datum', session_id: 'Termin', sort: 'Reihenfolge',
  start_time: 'Beginn', state: 'Zustand', status_reason: 'Begründung', type_id: 'Art', user_id: 'Benutzer', valid_until: 'Gültig bis',
  validity_months: 'Gültigkeit',
  // Organisationen
  is_owner: 'Inhaber', level: 'Recht', module: 'Funktion', move: 'Verschieben', rank_id: 'Rang', rank_ids: 'Ränge', restricted: 'Beschränkt',
  scope_id: 'Bereich', subject: 'Recht für', subject_id: 'Recht für', user_ids: 'Mitglieder',
  // Personen-Import
  csv: 'CSV-Datei', preview: 'Vorschau',
  // Personen-Stammdaten und Aktensystem
  birth_date: 'Geburtsdatum', gender: 'Geschlecht', nationality: 'Staatsangehörigkeit', height_cm: 'Größe', features: 'Merkmale', aliases: 'Alias',
  priority: 'Priorität', incident_at: 'Tatzeit', lead_user_id: 'Sachbearbeitung', owner_person_id: 'Halter', linked_id: 'Akte',
  occurred_at: 'Zeitpunkt', person_ids: 'Personen', review_note: 'Anmerkung', template_id: 'Vorlage', penal_code_id: 'Tatbestand', count: 'Anzahl',
  fine: 'Geldstrafe', jail: 'Haft', points: 'Punkte', category: 'Kategorie', storage: 'Lagerort', found_at: 'Fundzeit', found_where: 'Fundort',
  action: 'Vorgang', reason: 'Begründung', close_note: 'Vermerk', warnings: 'Warnhinweise', blood_type: 'Blutgruppe',
  allergies: 'Allergien', conditions: 'Vorerkrankungen', medications: 'Medikamente', emergency_contact: 'Notfallkontakt',
};

function subject(path) {
  const name = LABELS[path[0]] || 'Eingabe';
  return typeof path[1] === 'number' ? `${name} ${path[1] + 1}` : name;
}

const number = (value) => Number(value).toLocaleString('de-DE');

function problem(issue) {
  const amount = number(issue.code === 'too_small' ? issue.minimum : issue.maximum);
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'string') return issue.minimum === 1 ? 'darf nicht leer sein' : `muss mindestens ${amount} Zeichen lang sein`;
      if (issue.origin === 'array') return `braucht mindestens ${amount} Einträge`;
      return issue.inclusive === false ? `muss größer als ${amount} sein` : `muss mindestens ${amount} sein`;
    case 'too_big':
      if (issue.origin === 'string') return `darf höchstens ${amount} Zeichen lang sein`;
      if (issue.origin === 'array') return `darf höchstens ${amount} Einträge haben`;
      return `darf höchstens ${amount} sein`;
    case 'invalid_format':
      return issue.format === 'email' ? 'ist keine gültige E-Mail-Adresse' : 'hat kein gültiges Format';
    case 'invalid_type':
      return /received undefined/.test(issue.message) ? 'fehlt' : 'ist ungültig';
    case 'not_multiple_of':
      return 'hat zu viele Nachkommastellen';
    default:
      return 'ist ungültig';
  }
}

// Verständliche deutsche Meldungen statt der englischen Texte von Zod mit Feldschlüsseln
export function validationMessage(issues) {
  return issues.map((issue) => {
    const custom = issue.code === 'custom' && issue.message !== 'Invalid input';
    if (custom) return issue.path.length ? `${subject(issue.path)}: ${issue.message}` : issue.message;
    return `${subject(issue.path)} ${problem(issue)}`;
  }).join('; ');
}
