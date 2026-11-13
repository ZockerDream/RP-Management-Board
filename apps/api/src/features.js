// Schalter für Teile des Aktensystems (Wunsch des Auftraggebers vom 2026-11-10, systemweit unter Server-Management →
// Sicherheit & Einstellungen). Ausgeschaltet heißt: Tabs und Abschnitte verschwinden, die API lehnt ab, die Daten
// bleiben erhalten. Personenakten lassen sich nicht ausschalten. Ohne Datenbank testbar; die Prüfung zur Laufzeit
// steht in feature-guard.js.
export const CASE_SWITCHES = {
  files: 'casefiles.files',
  wanted: 'casefiles.wanted',
  codes: 'casefiles.penal_codes',
  templates: 'casefiles.report_templates',
  types: 'casefiles.types',
};

// Wirksame Schalter: Fahndungen, Vorlagen und Aktenarten hängen an Fallakten, Anklagepunkte an Fallakten und
// Strafkatalog. Den Strafkatalog gibt es auch ohne Fallakten, etwa zum Nachschlagen. Fehlt eine Einstellung, ist sie an.
export function caseFeatures(settings) {
  const on = (key) => settings[CASE_SWITCHES[key]] !== false;
  const files = on('files');
  const codes = on('codes');
  return { files, wanted: files && on('wanted'), codes, charges: files && codes, templates: files && on('templates'), types: files && on('types') };
}

export const FEATURE_NAMES = {
  files: 'Fallakten sind', wanted: 'Fahndungen sind', codes: 'Der Strafkatalog ist', charges: 'Anklagepunkte sind', templates: 'Berichtsvorlagen sind', types: 'Aktenarten sind',
};

// Welche Funktion eine Route braucht; die erste passende Regel gilt. Personenakten (/person-files) gehören zu keiner.
const RULES = [
  [/^\/(warrants|case-files\/:id\/warrants)(\/|$)/, 'wanted'],
  [/^\/(case-file-charges|case-files\/:id\/charges)(\/|$)/, 'charges'],
  [/^\/penal-codes(\/|$)/, 'codes'],
  [/^\/report-templates(\/|$)/, 'templates'],
  [/^\/case-file-types(\/|$)/, 'types'],
  [/^\/case-files?(-[a-z]+)?(\/|$)/, 'files'],
];
export function featureForRoute(url) {
  const path = url.replace(/^\/api(?=\/)/, '');
  return RULES.find(([pattern]) => pattern.test(path))?.[1] || null;
}

// ---------- Schalter für die Funktionen ab 2026-11-13 (Wunsch des Auftraggebers vom 2026-11-13, systemweit unter
// Server-Management → Sicherheit & Einstellungen → Funktionen). Ausgeschaltet: Seite und Navigation verschwinden, die
// API antwortet mit 403 „disabled“, die Daten bleiben. Fehlt eine Einstellung, ist die Funktion an.
export const MODULE_SWITCHES = {
  board: { setting: 'modules.board', label: 'Pinnwand & Umfragen', name: 'Die Pinnwand ist' },
  shifts: { setting: 'modules.shifts', label: 'Dienstplan', name: 'Der Dienstplan ist' },
  dispatch: { setting: 'modules.dispatch', label: 'Einsätze & Funk', name: 'Einsätze & Funk sind' },
  bolo: { setting: 'modules.bolo', label: 'Fahndungsboard', name: 'Das Fahndungsboard ist' },
  fines: { setting: 'modules.fines', label: 'Bußgeldrechner', name: 'Der Bußgeldrechner ist' },
  recruiting: { setting: 'modules.recruiting', label: 'Bewerbungen', name: 'Bewerbungen sind' },
  personnel: { setting: 'modules.personnel', label: 'Personalakte', name: 'Die Personalakte ist' },
  absences: { setting: 'modules.absences', label: 'Abwesenheiten', name: 'Abwesenheiten sind' },
  equipment: { setting: 'modules.equipment', label: 'Lager & Ausrüstung', name: 'Das Lager ist' },
  invoices: { setting: 'modules.invoices', label: 'Rechnungen & Angebote', name: 'Rechnungen sind' },
  cash: { setting: 'modules.cash', label: 'Kasse', name: 'Die Kasse ist' },
  payslip: { setting: 'modules.payslip', label: 'Lohnzettel', name: 'Der Lohnzettel ist' },
  speedcams: { setting: 'modules.speedcams', label: 'Blitzer', name: 'Blitzer sind' },
  music: { setting: 'modules.music', label: 'Musik', name: 'Musik ist' },
  discord: { setting: 'modules.discord', label: 'Discord', name: 'Discord ist' },
  search: { setting: 'modules.search', label: 'Globale Suche', name: 'Die globale Suche ist' },
};
export const moduleFeatures = (settings) => Object.fromEntries(Object.entries(MODULE_SWITCHES).map(([k, m]) => [k, settings[m.setting] !== false]));

// Fahndungsboard und Bußgeldrechner haben keine eigenen Routen; sie nutzen Fahndungen und Strafkatalog der Akten
const MODULE_RULES = [
  [/^\/(notices|polls)(\/|$)/, 'board'],
  [/^\/(shift-templates|shifts|shift-assignments)(\/|$)/, 'shifts'],
  [/^\/(dispatch|dispatch-units|dispatch-log|incidents)(\/|$)/, 'dispatch'],
  [/^\/applications(\/|$)/, 'recruiting'],
  [/^\/(personnel|personnel-entries)(\/|$)/, 'personnel'],
  [/^\/absences(\/|$)/, 'absences'],
  [/^\/equipment(\/|$)/, 'equipment'],
  [/^\/invoices(\/|$)/, 'invoices'],
  [/^\/(cash|cash-registers)(\/|$)/, 'cash'],
  [/^\/work-hours\/payslip\.pdf$/, 'payslip'],
  [/^\/speed-cameras(\/|$)/, 'speedcams'],
  [/^\/music(\/|$)/, 'music'],
  [/^\/teams\/:id\/discord(\/|$)/, 'discord'],
  [/^\/search$/, 'search'],
];
export function moduleForRoute(url) {
  const path = url.replace(/^\/api(?=\/)/, '');
  return MODULE_RULES.find(([pattern]) => pattern.test(path))?.[1] || null;
}
