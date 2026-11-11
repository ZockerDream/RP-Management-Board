// Berichte zu einer Akte und Berichtsvorlagen eines Bereichs.
// Ablauf: Entwurf (nur Verfasser und wer freigeben darf, sieht ihn) → eingereicht → freigegeben oder zurück an den Entwurf.
// Freigegebene Berichte sind unveränderlich und lassen sich nicht löschen; Korrekturen kommen als Nachtrag.
// Freigeben mit „Verwalten“ und nach dem Vier-Augen-Prinzip: nicht den eigenen Bericht, außer als Inhaber oder privat.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, forbidden, notFound } from '../authz.js';
import { LEVEL, levelSql, needMessage } from '../org.js';
import { audit } from '../audit.js';
import { patchSchema } from '../validation.js';
import { notify } from '../lib.js';
import { uuid, isoDateTime } from '../records.js';
import { loadFile, loadChild, assertInvolved, area, areaRecord } from '../casefile-access.js';
import { TEMPLATE_SETS } from '../report-templates.js';
import { reportPdf } from '../casefile-pdf.js';

const reportFields = z.object({
  kind: z.string().trim().max(100).default(''), title: z.string().trim().min(1).max(200), body: z.string().max(50000).default(''),
  occurred_at: isoDateTime.nullish(), person_ids: z.array(uuid).max(50).default([]),
});
const templateFields = z.object({ name: z.string().trim().min(1).max(100), body: z.string().max(20000).default(''), sort: z.number().int().min(-1000).max(1000).default(0) });
const uniqueTemplate = (e) => {
  if (e.code === '23505') throw bad('Eine Vorlage mit diesem Namen gibt es hier schon');
  throw e;
};

async function setPeople(client, reportId, fileId, personIds) {
  const ids = [...new Set(personIds)];
  for (const id of ids) await assertInvolved(fileId, id);
  await client.query('DELETE FROM case_file_report_people WHERE report_id=$1', [reportId]);
  for (const id of ids) await client.query('INSERT INTO case_file_report_people(report_id,person_id) VALUES ($1,$2)', [reportId, id]);
}
const label = (file, report) => `${file.file_number} · B-${report.number} ${report.title}`;

export default async function routes(app) {
  const write = LEVEL.WRITE;
  const manage = LEVEL.MANAGE;

  // ---------- Vorlagen
  app.get('/report-templates', authz('casefile:read'), async (req) => many(
    `SELECT rt.*, t.name team_name, ${levelSql('rt', 'casefile')} AS level FROM report_templates rt LEFT JOIN teams t ON t.id=rt.team_id
     WHERE ${levelSql('rt', 'casefile')} >= 2 ORDER BY t.name NULLS FIRST, rt.sort, rt.name`, [req.user.id]));
  app.post('/report-templates', authz('casefile:create'), async (req) => {
    const b = templateFields.extend({ team_id: uuid.nullish() }).parse(req.body);
    const owner = await area(req, b.team_id, manage);
    const row = await one('INSERT INTO report_templates(owner_user_id,team_id,name,body,sort) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [owner.owner_user_id, owner.team_id, b.name, b.body, b.sort]).catch(uniqueTemplate);
    await audit(req, 'report_template.created', 'report_template', row.id, { name: b.name });
    return row;
  });
  // Fertige Vorlagen für Polizei, Rettungsdienst oder allgemein; vorhandene Namen bleiben unangetastet
  app.post('/report-templates/defaults', authz('casefile:create'), async (req) => {
    const b = z.object({ team_id: uuid.nullish(), set: z.enum(Object.keys(TEMPLATE_SETS)) }).parse(req.body);
    const owner = await area(req, b.team_id, manage);
    let created = 0;
    await tx(async (client) => {
      for (const [i, [name, body]] of TEMPLATE_SETS[b.set].templates.entries()) {
        const r = await client.query(
          `INSERT INTO report_templates(owner_user_id,team_id,name,body,sort) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [owner.owner_user_id, owner.team_id, name, body, i * 10],
        );
        created += r.rowCount;
      }
    });
    await audit(req, 'report_template.defaults', 'report_template', null, { set: b.set, created });
    return { created };
  });
  async function loadTemplate(req) {
    const row = await one('SELECT * FROM report_templates WHERE id=$1', [uuid.parse(req.params.id)]);
    await areaRecord(req, row, manage);
    return row;
  }
  app.patch('/report-templates/:id', authz('casefile:update'), async (req) => {
    const row = await loadTemplate(req);
    const b = patchSchema(templateFields).parse(req.body);
    const m = { ...row, ...b };
    await q('UPDATE report_templates SET name=$2, body=$3, sort=$4 WHERE id=$1', [row.id, m.name, m.body, m.sort]).catch(uniqueTemplate);
    return { ok: true };
  });
  app.delete('/report-templates/:id', authz('casefile:delete'), async (req) => {
    const row = await loadTemplate(req);
    await q('DELETE FROM report_templates WHERE id=$1', [row.id]);
    await audit(req, 'report_template.deleted', 'report_template', row.id, { name: row.name });
    return { ok: true };
  });

  // ---------- Berichte
  app.post('/case-files/:id/reports', authz('casefile:update'), async (req) => {
    const { file } = await loadFile(req, req.params.id, write);
    const b = reportFields.extend({ amends_report_id: uuid.nullish() }).parse(req.body);
    if (b.amends_report_id) {
      const amended = await one('SELECT case_file_id, status FROM case_file_reports WHERE id=$1', [b.amends_report_id]);
      if (!amended || amended.case_file_id !== file.id || amended.status !== 'approved') throw bad('Ein Nachtrag gehört zu einem freigegebenen Bericht derselben Akte');
    }
    const row = await tx(async (client) => {
      await client.query('SELECT id FROM case_files WHERE id=$1 FOR UPDATE', [file.id]);
      const { n } = (await client.query('SELECT COALESCE(max(number), 0) + 1 n FROM case_file_reports WHERE case_file_id=$1', [file.id])).rows[0];
      const r = (await client.query(
        `INSERT INTO case_file_reports(case_file_id,number,kind,title,body,occurred_at,amends_report_id,author_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, number`,
        [file.id, n, b.kind, b.title, b.body, b.occurred_at || null, b.amends_report_id || null, req.user.id],
      )).rows[0];
      await setPeople(client, r.id, file.id, b.person_ids);
      await client.query('UPDATE case_files SET updated_at=now() WHERE id=$1', [file.id]);
      return r;
    });
    await audit(req, 'report.created', 'case_file', file.id, { report: row.id, number: row.number });
    return row;
  });

  async function loadReport(req, need = write) {
    const { row: report, file, level } = await loadChild(req, 'case_file_reports', req.params.id, need);
    // Fremde Entwürfe sind unsichtbar, auch für Schreibende
    if (report.status === 'draft' && report.author_id !== req.user.id && level < manage) throw forbidden('Den Entwurf sieht nur, wer ihn schreibt oder Berichte freigibt');
    return { report, file, level };
  }

  // Einzelner Bericht als PDF (Wunsch des Auftraggebers vom 2026-11-11): jeder Bericht, den man sehen darf;
  // Entwürfe und nicht freigegebene tragen einen Vermerk
  app.get('/case-file-reports/:id/pdf', authz('casefile:read'), async (req, reply) => {
    const { row, file, level } = await loadChild(req, 'case_file_reports', req.params.id, LEVEL.READ);
    if (row.status === 'draft' && row.author_id !== req.user.id && level < manage) throw notFound();
    const report = await one(
      `SELECT r.*, au.name author_name, ap.name approved_by_name, am.number amends_number,
         (SELECT COALESCE(json_agg(json_build_object('id', pe.id, 'name', pe.name) ORDER BY pe.name), '[]')
            FROM case_file_report_people rp JOIN people pe ON pe.id=rp.person_id WHERE rp.report_id=r.id) people
       FROM case_file_reports r LEFT JOIN users au ON au.id=r.author_id LEFT JOIN users ap ON ap.id=r.approved_by
         LEFT JOIN case_file_reports am ON am.id=r.amends_report_id WHERE r.id=$1`,
      [row.id],
    );
    await audit(req, 'case_file_report.exported_pdf', 'case_file', file.id, { report: row.id, number: row.number });
    const name = `bericht-${String(file.file_number).replace(/[^A-Za-z0-9_-]+/g, '_')}-${row.number}.pdf`;
    reply.type('application/pdf').header('content-disposition', `attachment; filename="${name}"`);
    return reply.send(reportPdf(report, file, { exportedBy: req.user.name }));
  });

  app.patch('/case-file-reports/:id', authz('casefile:update'), async (req) => {
    const { report, file } = await loadReport(req);
    if (report.status !== 'draft') throw bad(report.status === 'approved' ? 'Freigegebene Berichte sind gesperrt – lege einen Nachtrag an' : 'Eingereichte Berichte lassen sich erst nach dem Zurückgeben ändern');
    const b = patchSchema(reportFields).parse(req.body);
    const m = { ...report, ...b };
    await tx(async (client) => {
      await client.query('UPDATE case_file_reports SET kind=$2, title=$3, body=$4, occurred_at=$5, updated_at=now() WHERE id=$1', [report.id, m.kind, m.title, m.body, m.occurred_at || null]);
      if (b.person_ids) await setPeople(client, report.id, file.id, b.person_ids);
    });
    await audit(req, 'report.updated', 'case_file', file.id, { report: report.id });
    return { ok: true };
  });

  app.post('/case-file-reports/:id/submit', authz('casefile:update'), async (req) => {
    const { report, file } = await loadReport(req);
    if (report.status !== 'draft') throw bad('Der Bericht ist schon eingereicht');
    if (report.author_id !== req.user.id) throw forbidden('Einreichen kann nur, wer den Bericht schreibt');
    if (!report.body.trim()) throw bad('Ein leerer Bericht lässt sich nicht einreichen');
    // Privat gibt es niemanden, der zusätzlich prüft: dort gilt Einreichen als Freigabe
    const status = file.team_id ? 'submitted' : 'approved';
    const done = await one(
      `UPDATE case_file_reports SET status=$2, submitted_at=now(), review_note='', approved_by=$3, approved_at=$4, updated_at=now() WHERE id=$1 RETURNING submitted_at`,
      [report.id, status, status === 'approved' ? req.user.id : null, status === 'approved' ? new Date() : null],
    );
    if (file.team_id) {
      const reviewers = await many(
        `SELECT tm.user_id FROM team_members tm JOIN users u ON u.id=tm.user_id AND u.status='active' AND u.deleted_at IS NULL
         WHERE tm.team_id=$1 AND tm.user_id<>$3 AND case_file_level($2, tm.user_id) >= 4`, [file.team_id, file.id, req.user.id]);
      for (const { user_id: userId } of reviewers) {
        await notify(userId, 'report_review', `Bericht wartet auf Freigabe: ${label(file, report)}`, `Eingereicht von ${req.user.name}`,
          `report:${report.id}:${new Date(done.submitted_at).toISOString()}`, req.log);
      }
    }
    await audit(req, status === 'approved' ? 'report.approved' : 'report.submitted', 'case_file', file.id, { report: report.id });
    return { status };
  });

  app.post('/case-file-reports/:id/review', authz('casefile:update'), async (req) => {
    const { report, file } = await loadReport(req, manage);
    const b = z.object({ decision: z.enum(['approve', 'return']), note: z.string().trim().max(2000).default('') }).parse(req.body);
    if (report.status !== 'submitted') throw bad('Nur eingereichte Berichte lassen sich freigeben oder zurückgeben');
    if (b.decision === 'return' && !b.note) throw bad('Beim Zurückgeben bitte kurz sagen, was fehlt');
    if (b.decision === 'approve' && report.author_id === req.user.id) {
      const owner = await one('SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND is_owner', [file.team_id, req.user.id]);
      if (!owner) throw forbidden('Vier-Augen-Prinzip: Den eigenen Bericht gibt jemand anderes frei');
    }
    const approved = b.decision === 'approve';
    await q(
      `UPDATE case_file_reports SET status=$2, review_note=$3, approved_by=$4, approved_at=$5, updated_at=now() WHERE id=$1`,
      [report.id, approved ? 'approved' : 'draft', b.note, approved ? req.user.id : null, approved ? new Date() : null],
    );
    if (report.author_id && report.author_id !== req.user.id) {
      await notify(report.author_id, 'report_decided', `${approved ? 'Bericht freigegeben' : 'Bericht zurückgegeben'}: ${label(file, report)}`,
        b.note ? `${req.user.name}: ${b.note}` : `von ${req.user.name}`, `report:${report.id}:${b.decision}:${Date.now()}`, req.log);
    }
    await audit(req, approved ? 'report.approved' : 'report.returned', 'case_file', file.id, { report: report.id });
    return { ok: true };
  });

  // Entwürfe löscht, wer sie schreibt; Eingereichtes nur mit „Verwalten“; Freigegebenes gar nicht
  app.delete('/case-file-reports/:id', authz('casefile:update'), async (req) => {
    const { report, file, level } = await loadReport(req);
    if (report.status === 'approved') throw bad('Freigegebene Berichte bleiben in der Akte');
    if (report.status === 'submitted' && level < manage) throw forbidden(needMessage('casefile', manage));
    if (report.status === 'draft' && report.author_id !== req.user.id && level < manage) throw forbidden('Den Entwurf löscht nur, wer ihn schreibt');
    await q('DELETE FROM case_file_reports WHERE id=$1', [report.id]);
    await audit(req, 'report.deleted', 'case_file', file.id, { number: report.number, title: report.title });
    return { ok: true };
  });

  // Offene Freigaben über alle Akten, die man verwalten darf (für die Übersicht)
  app.get('/case-file-reports/pending', authz('casefile:read'), async (req) => many(
    `SELECT r.id, r.number, r.title, r.kind, r.submitted_at, au.name author_name, c.id case_file_id, c.file_number, c.title file_title
     FROM case_file_reports r JOIN case_files c ON c.id=r.case_file_id LEFT JOIN users au ON au.id=r.author_id
     WHERE r.status='submitted' AND case_file_level(c.id, $1) >= 4 ORDER BY r.submitted_at LIMIT 200`, [req.user.id]));
}
