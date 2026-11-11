// Alles, was GET /case-files/:id zu einer Akte liefert. Auch der PDF-Export nutzt es, damit dort dieselben
// Rechte und Filter gelten (Entwürfe, Verknüpfungen nur soweit sichtbar, Zugriffsliste nur für „Verwalten“).
import { one, many } from './db.js';
import { LEVEL } from './org.js';
import { personJoin } from './records.js';
import { fileLevelSql, loadFile } from './casefile-access.js';

export async function loadCaseFileDetail(req, id) {
  const { file, level } = await loadFile(req, id);
  const [team, type, access, people, entries, attachments, lead, members, links, vehicles, evidence, charges, warrants, reports, owner] = await Promise.all([
    file.team_id ? one('SELECT name FROM teams WHERE id=$1', [file.team_id]) : null,
    file.type_id ? one('SELECT name FROM case_file_types WHERE id=$1', [file.type_id]) : null,
    // Wer eine beschränkte Akte sehen darf, zeigt die Akte nur denen, die sie verwalten
    file.team_id && level >= LEVEL.MANAGE ? many(
      `SELECT a.rank_id, a.group_id, a.user_id, COALESCE(r.name, g.name, u.name) AS name FROM case_file_access a
       LEFT JOIN team_ranks r ON r.id=a.rank_id LEFT JOIN team_groups g ON g.id=a.group_id LEFT JOIN users u ON u.id=a.user_id
       WHERE a.case_file_id=$1 ORDER BY name`, [file.id]) : [],
    many(`SELECT cp.person_id, cp.role, pe.name, pe.kind, pe.function, pe.active FROM case_file_people cp
      ${personJoin('pe', 'cp.person_id')} WHERE cp.case_file_id=$1 ORDER BY pe.name NULLS LAST`, [file.id]),
    many(`SELECT e.id, e.entry_date, e.kind, e.body, e.person_id, pe.name person_name, e.created_at, e.updated_at,
        cu.name created_by_name, uu.name updated_by_name
      FROM case_file_entries e ${personJoin('pe', 'e.person_id')}
        LEFT JOIN users cu ON cu.id=e.created_by LEFT JOIN users uu ON uu.id=e.updated_by
      WHERE e.case_file_id=$1 ORDER BY e.entry_date DESC, e.created_at DESC`, [file.id]),
    many(`SELECT a.id, a.original_name, a.mime, a.size, a.caption, a.created_at, u.name uploaded_by_name FROM case_file_attachments a
      LEFT JOIN users u ON u.id=a.uploaded_by WHERE a.case_file_id=$1 ORDER BY a.created_at`, [file.id]),
    file.lead_user_id ? one('SELECT name FROM users WHERE id=$1', [file.lead_user_id]) : null,
    // Auswahl für die Sachbearbeitung nur für die, die die Akte ändern dürfen
    level >= LEVEL.WRITE && file.team_id
      ? many('SELECT u.id, u.name FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=$1 AND u.deleted_at IS NULL ORDER BY u.name', [file.team_id])
      : [],
    // Verknüpfte Akten nur, soweit man sie selbst sehen darf
    many(`SELECT l.linked_id id, l.note, c.file_number, c.title, c.status FROM case_file_links l JOIN case_files c ON c.id=l.linked_id
      WHERE l.case_file_id=$1 AND ${fileLevelSql('c', '$2')} >= 2 ORDER BY c.file_number`, [file.id, req.user.id]),
    many(`SELECT v.*, pe.name owner_name FROM case_file_vehicles v LEFT JOIN people pe ON pe.id=v.owner_person_id
      WHERE v.case_file_id=$1 ORDER BY v.created_at`, [file.id]),
    many(`SELECT ev.*, pe.name person_name, u.name created_by_name,
        (SELECT COALESCE(json_agg(json_build_object('at', l.at, 'action', l.action, 'note', l.note, 'user_name', lu.name) ORDER BY l.at), '[]')
           FROM case_file_evidence_log l LEFT JOIN users lu ON lu.id=l.user_id WHERE l.evidence_id=ev.id) log
      FROM case_file_evidence ev LEFT JOIN people pe ON pe.id=ev.person_id LEFT JOIN users u ON u.id=ev.created_by
      WHERE ev.case_file_id=$1 ORDER BY ev.number`, [file.id]),
    many(`SELECT ch.*, pe.name person_name, du.name decided_by_name FROM case_file_charges ch JOIN people pe ON pe.id=ch.person_id
      LEFT JOIN users du ON du.id=ch.decided_by WHERE ch.case_file_id=$1 ORDER BY pe.name, ch.created_at`, [file.id]),
    many(`SELECT w.*, pe.name person_name, cu.name created_by_name, xu.name closed_by_name FROM warrants w
      LEFT JOIN people pe ON pe.id=w.person_id LEFT JOIN users cu ON cu.id=w.created_by LEFT JOIN users xu ON xu.id=w.closed_by
      WHERE w.case_file_id=$1 ORDER BY w.status='active' DESC, w.issued_on DESC`, [file.id]),
    // Entwürfe sieht nur, wer sie schreibt oder Berichte freigeben darf
    many(`SELECT r.*, au.name author_name, ap.name approved_by_name, am.number amends_number,
        (SELECT COALESCE(json_agg(json_build_object('id', pe.id, 'name', pe.name) ORDER BY pe.name), '[]')
           FROM case_file_report_people rp JOIN people pe ON pe.id=rp.person_id WHERE rp.report_id=r.id) people
      FROM case_file_reports r LEFT JOIN users au ON au.id=r.author_id LEFT JOIN users ap ON ap.id=r.approved_by
        LEFT JOIN case_file_reports am ON am.id=r.amends_report_id
      WHERE r.case_file_id=$1 AND (r.status <> 'draft' OR r.author_id=$2 OR $3::boolean) ORDER BY r.number`, [file.id, req.user.id, level >= LEVEL.MANAGE]),
    // Inhaber dürfen eigene Berichte freigeben (Vier-Augen-Prinzip sonst)
    file.team_id ? one('SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2 AND is_owner', [file.team_id, req.user.id]) : null,
  ]);
  return {
    ...file, team_name: team?.name || null, type_name: type?.name || null, lead_name: lead?.name || null, level, access, people, entries, attachments,
    members, links, vehicles, evidence, charges, warrants, reports, owner: file.team_id ? !!owner : true,
  };
}
