// Globale Suche (Wunsch des Auftraggebers vom 2026-11-13): ein Feld oben durchsucht Personen, Akten, Fahrzeuge,
// Fuhrpark, Notizen, Dokumentationen, Ankündigungen und Blitzer gleichzeitig – jeweils nur, was man sehen darf.
import { z } from 'zod';
import { many } from '../db.js';
import { requireAuth, can } from '../authz.js';
import { levelSql, visibleSql } from '../org.js';
import { currentCaseFeatures } from '../feature-guard.js';

const LIMIT = 6;
// Ausschnitt um den Treffer für Fließtext
const excerpt = (text, term) => {
  const s = String(text || '').replace(/\s+/g, ' ');
  const i = s.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return s.slice(0, 90);
  const from = Math.max(0, i - 30);
  return `${from ? '…' : ''}${s.slice(from, i + term.length + 60)}${i + term.length + 60 < s.length ? '…' : ''}`;
};

export default async function routes(app) {
  app.get('/search', requireAuth, async (req) => {
    const { q: term } = z.object({ q: z.string().trim().min(2).max(100) }).parse(req.query);
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const u = req.user.id;
    const files = can(req, 'casefile:read') && (await currentCaseFeatures()).files;
    const jobs = {
      people: can(req, 'person:read') && many(
        `SELECT id, name, aliases, function FROM people WHERE name ILIKE $1 OR aliases ILIKE $1 ORDER BY active DESC, name LIMIT ${LIMIT}`, [like]),
      files: files && many(
        `SELECT c.id, c.file_number, c.title, c.status FROM case_files c
         WHERE (c.file_number ILIKE $2 OR c.title ILIKE $2) AND case_file_level(c.id, $1) >= 2 ORDER BY c.opened_on DESC LIMIT ${LIMIT}`, [u, like]),
      vehicles: can(req, 'vehicle:read') && many(
        `SELECT v.id, v.plate, v.make_model, v.status FROM vehicles v
         WHERE (v.plate ILIKE $2 OR v.make_model ILIKE $2) AND ${visibleSql('v', 'vehicle')} ORDER BY v.plate LIMIT ${LIMIT}`, [u, like]),
      fleet: can(req, 'fleet:read') && many(
        `SELECT f.id, f.plate, f.model, t.name team_name FROM fleet_vehicles f JOIN teams t ON t.id=f.team_id
         WHERE f.active AND (f.plate ILIKE $2 OR f.model ILIKE $2) AND team_level(f.team_id, $1, 'fleet') >= 2 ORDER BY f.plate LIMIT ${LIMIT}`, [u, like]),
      notes: many(
        `SELECT * FROM (SELECT n.id, n.title, n.body, ${levelSql('n', 'notes')} AS level FROM notes n
           WHERE (n.owner_user_id=$1 OR n.team_id IS NOT NULL) AND (n.title ILIKE $2 OR n.body ILIKE $2)) x
         WHERE x.level >= 2 LIMIT ${LIMIT}`, [u, like]),
      docs: can(req, 'doc:read') && many(
        `SELECT p.id, p.title, p.body, c.name category FROM doc_pages p JOIN doc_categories c ON c.id=p.category_id
         WHERE (p.title ILIKE $2 OR p.body ILIKE $2) AND ${levelSql('c', 'doc', '$1', 'c.id')} >= 2 ORDER BY p.title LIMIT ${LIMIT}`, [u, like]),
      notices: can(req, 'notice:read') && many(
        `SELECT n.id, n.title, n.body, t.name team_name FROM notices n JOIN teams t ON t.id=n.team_id
         WHERE (n.title ILIKE $2 OR n.body ILIKE $2) AND team_level(n.team_id, $1, 'notices') >= 2
           AND (cardinality(n.rank_ids)=0 OR team_level(n.team_id, $1, 'notices') >= 3
             OR (SELECT r.position FROM team_members tm JOIN team_ranks r ON r.id=tm.rank_id WHERE tm.team_id=n.team_id AND tm.user_id=$1)
                >= (SELECT min(r2.position) FROM team_ranks r2 WHERE r2.id = ANY(n.rank_ids)))
         ORDER BY n.created_at DESC LIMIT ${LIMIT}`, [u, like]),
      speedcams: can(req, 'speedcam:read') && many(
        `SELECT id, name, location FROM speed_cameras WHERE name ILIKE $1 OR location ILIKE $1 ORDER BY lower(name) LIMIT ${LIMIT}`, [like]),
    };
    const keys = Object.keys(jobs);
    const values = await Promise.all(keys.map((k) => jobs[k] || []));
    const r = Object.fromEntries(keys.map((k, i) => [k, values[i]]));
    const results = [
      ...r.people.map((p) => ({ type: 'Person', label: p.name, sub: [p.aliases, p.function].filter(Boolean).join(' · '), link: `#/casefiles?person=${p.id}` })),
      ...r.files.map((f) => ({ type: 'Akte', label: `${f.file_number} ${f.title}`, sub: f.status === 'closed' ? 'abgeschlossen' : '', link: `#/casefiles?id=${f.id}` })),
      ...r.vehicles.map((v) => ({ type: 'Fahrzeug', label: v.plate, sub: v.make_model, link: '#/assets-vehicles' })),
      ...r.fleet.map((v) => ({ type: 'Fuhrpark', label: v.plate, sub: [v.model, v.team_name].filter(Boolean).join(' · '), link: '#/fleet' })),
      ...r.notes.map((n) => ({ type: 'Notiz', label: n.title || 'Ohne Titel', sub: excerpt(n.body, term), link: '#/notes' })),
      ...r.docs.map((d) => ({ type: 'Dokumentation', label: d.title, sub: d.category, link: `#/docs?page=${d.id}` })),
      ...r.notices.map((n) => ({ type: 'Ankündigung', label: n.title, sub: n.team_name, link: '#/board' })),
      ...r.speedcams.map((c) => ({ type: 'Blitzer', label: c.name, sub: c.location, link: '#/speedcams' })),
    ];
    return { q: term, results };
  });
}
