// Discord senden (Regeln in discord.js). Im Hintergrund: ein Fehler bei Discord hält keine Anfrage auf.
import { one } from './db.js';
import { decrypt } from './security.js';
import { config } from './config.js';
import { webhookOk, discordPayload } from './discord.js';
import { getSetting } from './settings.js';

export async function sendDiscord(teamId, event, message, log, { force = false } = {}) {
  try {
    if ((await getSetting('modules.discord')) === false) return false;
    const row = await one('SELECT d.webhook_enc, d.events, t.name FROM team_discord d JOIN teams t ON t.id=d.team_id WHERE d.team_id=$1', [teamId]);
    if (!row || (!force && !row.events.includes(event))) return false;
    const url = decrypt(row.webhook_enc);
    if (!webhookOk(url)) return false;
    const link = message.path ? `${config.appUrl}/#/${message.path}` : '';
    const res = await fetch(`${url}?wait=false`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(discordPayload(row.name, { ...message, url: link })), signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) log?.warn?.({ status: res.status, event }, 'Discord-Webhook abgelehnt');
    return res.ok;
  } catch (err) {
    log?.warn?.({ err: err.message, event }, 'Discord-Webhook fehlgeschlagen');
    return false;
  }
}
// Für Routen: nicht abwarten
export const discord = (teamId, event, message, log) => { sendDiscord(teamId, event, message, log); };
