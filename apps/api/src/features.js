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
