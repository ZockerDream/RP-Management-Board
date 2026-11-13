// Organisationen für Auswahllisten je Funktion und Discord-Webhook je Organisation (Wunsch vom 2026-11-13).
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { authz, bad } from '../authz.js';
import { LEVEL, MODULE_KEYS } from '../org.js';
import { audit } from '../audit.js';
import { uuid } from '../records.js';
import { encrypt, decrypt } from '../security.js';
import { teamsFor, teamFor } from '../orgfeature.js';
import { DISCORD_EVENTS, webhookOk } from '../discord.js';
import { sendDiscord } from '../discord-send.js';

export default async function routes(app) {
  // Organisationen, in denen ich Mitglied bin, mit meiner Stufe für die Funktion (min 0 = jede Mitgliedschaft)
  app.get('/org-teams', authz('team:read'), async (req) => {
    const f = z.object({ module: z.enum(MODULE_KEYS), min: z.coerce.number().int().min(0).max(4).default(2) }).parse(req.query);
    return teamsFor(req.user.id, f.module, f.min);
  });

  // Mitglieder einer Organisation für Auswahllisten (Einteilen, Ausgeben, für andere eintragen); nur Name und Rang
  app.get('/org-members', authz('team:read'), async (req) => {
    const f = z.object({ team_id: uuid, module: z.enum(MODULE_KEYS), min: z.coerce.number().int().min(1).max(4).default(3) }).parse(req.query);
    await teamFor(req, f.team_id, f.module, f.min);
    return many(
      `SELECT tm.user_id, u.name, r.name rank_name, r.position FROM team_members tm JOIN users u ON u.id=tm.user_id AND u.status='active' AND u.deleted_at IS NULL
       LEFT JOIN team_ranks r ON r.id=tm.rank_id WHERE tm.team_id=$1 ORDER BY r.position DESC NULLS LAST, u.name`, [f.team_id]);
  });

  // ---------- Discord: verwalten wie Ränge und Rechte (Mitglieder & Ränge „Verwalten“ oder Inhaber)
  const discordTeam = async (req) => {
    const teamId = uuid.parse(req.params.id);
    await teamFor(req, teamId, 'members', LEVEL.MANAGE);
    return teamId;
  };
  app.get('/teams/:id/discord', authz('team:update'), async (req) => {
    const teamId = await discordTeam(req);
    const row = await one('SELECT webhook_enc, events, updated_at FROM team_discord WHERE team_id=$1', [teamId]);
    let hint = '';
    if (row) { try { const url = decrypt(row.webhook_enc); hint = `…${url.slice(-6)}`; } catch { hint = '(nicht lesbar)'; } }
    return { configured: Boolean(row), webhook_hint: hint, events: row?.events || [], available: DISCORD_EVENTS, updated_at: row?.updated_at || null };
  });
  app.put('/teams/:id/discord', authz('team:update'), async (req) => {
    const teamId = await discordTeam(req);
    const b = z.object({ webhook_url: z.string().trim().max(300).optional(), events: z.array(z.enum(Object.keys(DISCORD_EVENTS))).max(20) }).parse(req.body);
    const existing = await one('SELECT webhook_enc FROM team_discord WHERE team_id=$1', [teamId]);
    if (b.webhook_url === '') {
      await q('DELETE FROM team_discord WHERE team_id=$1', [teamId]);
      await audit(req, 'team.discord_removed', 'team', teamId, {});
      return { ok: true };
    }
    if (b.webhook_url !== undefined && !webhookOk(b.webhook_url)) throw bad('Kein Discord-Webhook. In Discord: Kanal bearbeiten → Integrationen → Webhooks → „Webhook-URL kopieren“.');
    if (b.webhook_url === undefined && !existing) throw bad('Webhook-URL fehlt');
    const enc = b.webhook_url !== undefined ? encrypt(b.webhook_url) : existing.webhook_enc;
    await q(`INSERT INTO team_discord(team_id, webhook_enc, events, updated_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT (team_id) DO UPDATE SET webhook_enc=$2, events=$3, updated_by=$4, updated_at=now()`, [teamId, enc, [...new Set(b.events)], req.user.id]);
    await audit(req, 'team.discord_saved', 'team', teamId, { events: b.events });
    return { ok: true };
  });
  app.post('/teams/:id/discord/test', authz('team:update'), async (req) => {
    const teamId = await discordTeam(req);
    if (!(await one('SELECT 1 FROM team_discord WHERE team_id=$1', [teamId]))) throw bad('Zuerst einen Webhook speichern');
    const ok = await sendDiscord(teamId, 'test', { title: 'Testnachricht', description: `Die Verbindung zum RP-Management-Board funktioniert (ausgelöst von ${req.user.name}).` }, req.log, { force: true });
    if (!ok) throw bad('Discord hat die Nachricht nicht angenommen. Ist der Webhook noch gültig?');
    return { ok: true };
  });
}
