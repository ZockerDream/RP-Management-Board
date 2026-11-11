// Umbuchungen (Wunsch des Auftraggebers vom 2026-11-11). Regeln in transfers.js (planTransfer). Gebucht wird nur über
// bookTransfer: Ausgabe auf dem Quellkonto, Einnahme auf dem Zielkonto, beide mit source='transfer' und transfer_id,
// am Tag der Umbuchung bzw. der Annahme. Bis zur Annahme bucht nichts.
import { z } from 'zod';
import { one, many, q, tx } from '../db.js';
import { authz, bad, notFound, budgetAccess } from '../authz.js';
import { teamUsers } from '../org.js';
import { notify, budgetWatch } from '../lib.js';
import { audit } from '../audit.js';
import { config } from '../config.js';
import { dateInZone } from '../periods.js';
import { planTransfer } from '../transfers.js';

const id = z.string().uuid();
const money = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(',', '.'))
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v) && Number(v) > 0, 'Ungültiger Betrag');
const createBody = z.object({
  from_budget_id: id,
  target: z.enum(['own', 'team', 'user']),
  to_budget_id: id.nullish(),
  to_user_id: id.nullish(),
  amount: money,
  title: z.string().trim().min(1).max(200),
  note: z.string().max(2000).default(''),
  category_id: id.nullish(),
});

// Konto samt eigener Stufe (wie budgetAccess), ohne bei fehlendem Recht abzubrechen
const budgetWithLevel = (budgetId, userId) => one(
  `SELECT b.*, CASE WHEN b.type='solo' THEN (CASE WHEN b.owner_user_id=$2 THEN 4 ELSE 0 END) ELSE team_level(b.team_id, $2, 'budget') END AS level
   FROM budgets b WHERE b.id=$1`,
  [budgetId, userId],
);

async function bookTransfer(client, t, toBudgetId, acceptedBy) {
  const day = dateInZone(config.tz);
  const title = `Umbuchung: ${t.title}`.slice(0, 200);
  await client.query(
    `INSERT INTO transactions(budget_id,category_id,created_by,type,amount,booked_at,title,note,source,transfer_id)
     VALUES ($1,$2,$3,'expense',$4,$5,$6,$7,'transfer',$8), ($9,NULL,$10,'income',$4,$5,$6,$7,'transfer',$8)`,
    [t.from_budget_id, t.category_id, t.created_by, t.amount, day, title, t.note, t.id, toBudgetId, acceptedBy],
  );
}

// Wer eine offene Umbuchung annehmen oder ablehnen darf: der Empfänger bzw. bei Organisationen alle mit
// „Lesen & Schreiben“ auf dem Zielkonto
async function loadIncoming(req) {
  const t = await one("SELECT * FROM transfers WHERE id=$1 AND status='pending'", [req.params.id]);
  if (!t) throw notFound('Umbuchung nicht gefunden oder schon erledigt');
  if (t.to_user_id) {
    if (t.to_user_id !== req.user.id) throw notFound('Umbuchung nicht gefunden oder schon erledigt');
  } else {
    const target = t.to_budget_id ? await budgetWithLevel(t.to_budget_id, req.user.id) : null;
    if (!target || target.level < 3) throw notFound('Umbuchung nicht gefunden oder schon erledigt');
  }
  return t;
}

const LIST_SQL = `SELECT t.id, t.amount, t.currency, t.title, t.note, t.status, t.created_at, t.to_user_id, t.to_team_id, t.to_budget_id,
    t.from_budget_id, cu.name from_name, ru.name to_user_name, tm.name to_team_name, tb.name to_budget_name, fb.name from_budget_name
  FROM transfers t LEFT JOIN users cu ON cu.id=t.created_by LEFT JOIN users ru ON ru.id=t.to_user_id
  LEFT JOIN teams tm ON tm.id=t.to_team_id LEFT JOIN budgets tb ON tb.id=t.to_budget_id LEFT JOIN budgets fb ON fb.id=t.from_budget_id`;

export default async function routes(app) {
  app.get('/transfers/targets', authz('transaction:create'), async (req) => {
    const [own, teamBudgets] = await Promise.all([
      many("SELECT id, name, currency FROM budgets WHERE type='solo' AND owner_user_id=$1 AND NOT archived ORDER BY name", [req.user.id]),
      // Nur Organisationen, in denen man Mitglied ist; Kontostände bleiben verborgen
      many(
        `SELECT b.id, b.name, b.currency, b.team_id, t.name team_name, team_level(b.team_id, $1, 'budget') >= 3 AS direct
         FROM budgets b JOIN team_members m ON m.team_id=b.team_id AND m.user_id=$1 JOIN teams t ON t.id=b.team_id
         WHERE b.type='shared' AND NOT b.archived ORDER BY t.name, b.name`,
        [req.user.id],
      ),
    ]);
    const teams = [];
    for (const b of teamBudgets) {
      let team = teams.find((t) => t.team_id === b.team_id);
      if (!team) teams.push((team = { team_id: b.team_id, team_name: b.team_name, budgets: [] }));
      team.budgets.push({ id: b.id, name: b.name, currency: b.currency, direct: b.direct });
    }
    return { own, teams };
  });

  app.get('/transfers/users', authz('transaction:create'), async (req) => {
    const { q: term } = z.object({ q: z.string().trim().max(60).default('') }).parse(req.query);
    if (term.length < 2) return [];
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return many(
      `SELECT id, name FROM users WHERE status='active' AND deleted_at IS NULL AND id<>$1 AND name ILIKE $2 ORDER BY name LIMIT 20`,
      [req.user.id, like],
    );
  });

  app.get('/transfers', authz('transaction:read'), async (req) => {
    const [incoming, outgoing] = await Promise.all([
      many(
        `${LIST_SQL} WHERE t.status='pending' AND t.created_by IS DISTINCT FROM $1 AND (t.to_user_id=$1
           OR (t.to_budget_id IS NOT NULL AND t.to_user_id IS NULL AND tb.type='shared' AND team_level(tb.team_id, $1, 'budget') >= 3))
         ORDER BY t.created_at DESC`,
        [req.user.id],
      ),
      many(`${LIST_SQL} WHERE t.status='pending' AND t.created_by=$1 ORDER BY t.created_at DESC`, [req.user.id]),
    ]);
    return { incoming, outgoing };
  });

  app.post('/transfers', authz('transaction:create'), async (req) => {
    const b = createBody.parse(req.body);
    const { budget: from } = await budgetAccess(req.user.id, b.from_budget_id, true);
    if (b.category_id && !(await one('SELECT 1 FROM categories WHERE id=$1 AND budget_id=$2', [b.category_id, from.id]))) throw bad('Kategorie gehört nicht zum Quellkonto');
    const target = { kind: b.target };
    if (b.target === 'user') {
      if (!b.to_user_id) throw bad('Bitte einen Empfänger wählen');
      const u = await one('SELECT id, status, deleted_at FROM users WHERE id=$1', [b.to_user_id]);
      target.user = u ? { id: u.id, active: u.status === 'active' && !u.deleted_at } : null;
    } else {
      if (!b.to_budget_id) throw bad('Bitte ein Zielkonto wählen');
      target.budget = await budgetWithLevel(b.to_budget_id, req.user.id);
      if (target.budget?.team_id) target.isMember = !!(await one('SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2', [target.budget.team_id, req.user.id]));
      // Fremde persönliche Konten nicht verraten
      if (!target.budget || (target.budget.type === 'solo' && target.budget.owner_user_id !== req.user.id)) {
        if (b.target === 'own' && target.budget) throw bad('Das ist nicht dein persönliches Konto');
        throw notFound('Zielkonto nicht gefunden');
      }
    }
    const { mode } = planTransfer({ me: req.user.id, from, target });
    const status = mode === 'direct' ? 'accepted' : 'pending';
    const toTeam = target.budget?.team_id ?? null;
    const t = await tx(async (client) => {
      const { rows: [row] } = await client.query(
        `INSERT INTO transfers(from_budget_id,to_budget_id,to_user_id,to_team_id,amount,currency,title,note,category_id,status,created_by,decided_by,decided_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [from.id, b.target === 'user' ? null : b.to_budget_id, b.target === 'user' ? b.to_user_id : null, toTeam, b.amount, from.currency,
          b.title, b.note, b.category_id || null, status, req.user.id, mode === 'direct' ? req.user.id : null, mode === 'direct' ? new Date() : null],
      );
      if (mode === 'direct') await bookTransfer(client, row, b.to_budget_id, req.user.id);
      return row;
    });
    await audit(req, 'transfer.created', 'transfer', t.id, { status, amount: t.amount, target: b.target });
    if (mode === 'direct') {
      await budgetWatch(from.id, req.log);
    } else {
      const body = `${req.user.name} möchte dir ${t.amount} ${t.currency} überweisen: „${t.title}“. Annehmen unter Konten.`;
      const recipients = t.to_user_id ? [t.to_user_id] : (await teamUsers(toTeam, 'budget', 3)).filter((u) => u !== req.user.id);
      for (const u of recipients) await notify(u, 'transfer_received', 'Umbuchung erhalten', body, `transfer:${t.id}:${u}`, req.log);
    }
    return { id: t.id, status };
  });

  app.post('/transfers/:id/accept', authz('transaction:create'), async (req) => {
    const t = await loadIncoming(req);
    const b = z.object({ budget_id: id.nullish() }).parse(req.body || {});
    let toBudgetId = t.to_budget_id;
    if (t.to_user_id) {
      if (!b.budget_id) throw bad('Bitte ein Zielkonto wählen');
      const own = await one("SELECT * FROM budgets WHERE id=$1 AND type='solo' AND owner_user_id=$2", [b.budget_id, req.user.id]);
      if (!own) throw bad('Bitte eines deiner persönlichen Konten wählen');
      if (own.archived) throw bad('Zielkonto ist archiviert');
      if (own.currency !== t.currency) throw bad(`Du brauchst ein persönliches Konto in ${t.currency}`);
      toBudgetId = own.id;
    } else {
      const target = await budgetWithLevel(t.to_budget_id, req.user.id);
      if (target.archived) throw bad('Zielkonto ist archiviert');
    }
    // Quellkonto erneut prüfen: Es kann seitdem archiviert sein oder der Absender sein Schreibrecht verloren haben
    const source = t.from_budget_id && t.created_by ? await budgetWithLevel(t.from_budget_id, t.created_by) : null;
    if (!source || source.level < 3 || source.archived) {
      const reason = 'Das Quellkonto ist nicht mehr verfügbar';
      await q("UPDATE transfers SET status='declined', decline_reason=$2, decided_at=now() WHERE id=$1 AND status='pending'", [t.id, reason]);
      if (t.created_by) await notify(t.created_by, 'transfer_decided', 'Umbuchung abgelehnt', `„${t.title}“ (${t.amount} ${t.currency}): ${reason}.`, `transfer-decided:${t.id}`, req.log);
      throw bad(`${reason} – Umbuchung abgelehnt`);
    }
    const done = await tx(async (client) => {
      const r = await client.query(
        "UPDATE transfers SET status='accepted', to_budget_id=$2, decided_by=$3, decided_at=now() WHERE id=$1 AND status='pending' RETURNING *",
        [t.id, toBudgetId, req.user.id],
      );
      if (!r.rowCount) return false;
      await bookTransfer(client, r.rows[0], toBudgetId, req.user.id);
      return true;
    });
    if (!done) throw bad('Die Umbuchung ist schon erledigt');
    await audit(req, 'transfer.accepted', 'transfer', t.id);
    await budgetWatch(t.from_budget_id, req.log);
    if (t.created_by) await notify(t.created_by, 'transfer_decided', 'Umbuchung angenommen', `${req.user.name} hat „${t.title}“ (${t.amount} ${t.currency}) angenommen.`, `transfer-decided:${t.id}`, req.log);
    return { ok: true };
  });

  app.post('/transfers/:id/decline', authz('transaction:read'), async (req) => {
    const t = await loadIncoming(req);
    const r = await q("UPDATE transfers SET status='declined', decided_by=$2, decided_at=now() WHERE id=$1 AND status='pending'", [t.id, req.user.id]);
    if (!r.rowCount) throw bad('Die Umbuchung ist schon erledigt');
    await audit(req, 'transfer.declined', 'transfer', t.id);
    if (t.created_by) await notify(t.created_by, 'transfer_decided', 'Umbuchung abgelehnt', `${req.user.name} hat „${t.title}“ (${t.amount} ${t.currency}) abgelehnt.`, `transfer-decided:${t.id}`, req.log);
    return { ok: true };
  });

  app.post('/transfers/:id/revoke', authz('transaction:read'), async (req) => {
    const r = await q("UPDATE transfers SET status='revoked', decided_by=$2, decided_at=now() WHERE id=$1 AND created_by=$2 AND status='pending'", [req.params.id, req.user.id]);
    if (!r.rowCount) throw notFound('Umbuchung nicht gefunden oder schon erledigt');
    await audit(req, 'transfer.revoked', 'transfer', req.params.id);
    return { ok: true };
  });
}
