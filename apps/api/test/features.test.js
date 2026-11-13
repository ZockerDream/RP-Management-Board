import test from 'node:test';
import assert from 'node:assert/strict';
import { caseFeatures, featureForRoute, CASE_SWITCHES } from '../src/features.js';

const settings = (off = []) => Object.fromEntries(Object.entries(CASE_SWITCHES).map(([key, setting]) => [setting, !off.includes(key)]));

test('all parts of the case file system are on unless switched off', () => {
  const all = { files: true, wanted: true, codes: true, charges: true, templates: true, types: true };
  assert.deepEqual(caseFeatures({}), all);
  assert.deepEqual(caseFeatures(settings()), all);
});

test('without case files there are no warrants, templates, types or charges, but the penal code stays', () => {
  assert.deepEqual(caseFeatures(settings(['files'])), { files: false, wanted: false, codes: true, charges: false, templates: false, types: false });
});

test('switching off the penal code also hides charges; other parts stay independent', () => {
  assert.deepEqual(caseFeatures(settings(['codes'])), { files: true, wanted: true, codes: false, charges: false, templates: true, types: true });
  assert.deepEqual(caseFeatures(settings(['wanted', 'templates', 'types'])), { files: true, wanted: false, codes: true, charges: true, templates: false, types: false });
});

test('every case file route maps to the part it needs; person files map to none', () => {
  const expect = {
    '/api/case-files': 'files', '/api/case-files/:id': 'files', '/api/case-files/:id/entries': 'files', '/api/case-file-entries/:id': 'files',
    '/api/case-files/:id/attachments': 'files', '/api/case-file-attachments/:id': 'files', '/api/case-files/:id/reports': 'files',
    '/api/case-file-reports/pending': 'files', '/api/case-file-reports/:id/review': 'files', '/api/case-files/:id/evidence': 'files',
    '/api/case-file-evidence/:id/log': 'files', '/api/case-files/:id/vehicles': 'files', '/api/case-file-vehicles/:id': 'files',
    '/api/case-files/:id/links/:linkedId': 'files', '/api/case-files/:id/access': 'files', '/api/case-files/:id/people/:personId': 'files',
    '/api/case-files/:id/warrants': 'wanted', '/api/warrants': 'wanted', '/api/warrants/:id/close': 'wanted',
    '/api/case-files/:id/charges': 'charges', '/api/case-file-charges/:id/decision': 'charges',
    '/api/penal-codes': 'codes', '/api/penal-codes/import': 'codes',
    '/api/report-templates': 'templates', '/api/report-templates/defaults': 'templates',
    '/api/case-file-types': 'types', '/api/case-file-types/:id': 'types',
    '/api/person-files': null, '/api/person-files/:personId/entries': null, '/api/person-file-entries/:id': null, '/api/people/:id/record': null,
    '/api/transactions': null, '/api/casefilesx': null,
  };
  for (const [url, feature] of Object.entries(expect)) assert.equal(featureForRoute(url), feature, url);
});

test('neue Funktionen sind an, bis sie ausgeschaltet werden', async () => {
  const { moduleFeatures, MODULE_SWITCHES } = await import('../src/features.js');
  assert.ok(Object.values(moduleFeatures({})).every(Boolean));
  const off = moduleFeatures({ 'modules.music': false, 'modules.cash': false });
  assert.equal(off.music, false);
  assert.equal(off.cash, false);
  assert.equal(off.shifts, true);
  assert.equal(Object.keys(MODULE_SWITCHES).length, 16);
});

test('Routen der neuen Funktionen gehören zu ihrem Schalter', async () => {
  const { moduleForRoute } = await import('../src/features.js');
  const expect = {
    '/api/notices': 'board', '/api/polls/:id/vote': 'board', '/api/shifts': 'shifts', '/api/shift-assignments/:id/take': 'shifts', '/api/shift-templates/:id': 'shifts',
    '/api/dispatch': 'dispatch', '/api/dispatch-units/:id/status': 'dispatch', '/api/incidents/:id/case-file': 'dispatch', '/api/dispatch-log': 'dispatch',
    '/api/applications/:id/decide': 'recruiting', '/api/personnel/:userId': 'personnel', '/api/personnel-entries/:id': 'personnel', '/api/absences': 'absences',
    '/api/equipment/:id/issue': 'equipment', '/api/invoices/:id/pdf': 'invoices', '/api/cash': 'cash', '/api/cash-registers/:id/close': 'cash',
    '/api/work-hours/payslip.pdf': 'payslip', '/api/speed-cameras/:id/photo': 'speedcams', '/api/music/spotify/callback': 'music',
    '/api/teams/:id/discord/test': 'discord', '/api/search': 'search',
    '/api/teams/:id': null, '/api/work-hours': null, '/api/work-hours/monthly.pdf': null, '/api/org-teams': null, '/api/people': null,
  };
  for (const [url, feature] of Object.entries(expect)) assert.equal(moduleForRoute(url), feature, url);
});
