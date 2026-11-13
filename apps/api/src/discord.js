// Discord-Anbindung (Wunsch des Auftraggebers vom 2026-11-13): je Organisation ein Webhook, Ereignisse wählbar.
// Regeln ohne Datenbank (Unit-Test); gesendet wird in discord-send.js.

export const DISCORD_EVENTS = {
  notice: 'Neue Ankündigung',
  poll: 'Neue Umfrage',
  shift: 'Dienstplan: freie, getauschte und abgesagte Schichten',
  absence: 'Abwesenheit gemeldet',
  incident: 'Einsatz angelegt und abgeschlossen',
  warrant: 'Fahndung ausgeschrieben und erledigt',
  fleet: 'Fuhrpark-Runde erledigt',
  application: 'Bewerbung angenommen',
  invoice: 'Rechnung bezahlt',
};

// Nur echte Discord-Webhooks; verhindert, dass der Server beliebige Adressen aufruft
export const webhookOk = (url) => /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,30}\/[\w-]{20,200}$/.test(String(url || ''));

// Text für Discord kürzen; @everyone/@here und Erwähnungen unschädlich machen
export const clean = (s, max) => String(s ?? '').replace(/@(everyone|here)/g, '@​$1').replace(/<@[!&]?\d+>/g, '@…').slice(0, max);

export function discordPayload(teamName, { title, description = '', url = '', fields = [] }) {
  return {
    username: clean(teamName || 'RP-Management-Board', 80),
    allowed_mentions: { parse: [] },
    embeds: [{
      title: clean(title, 256),
      description: clean(description, 2000),
      ...(url ? { url } : {}),
      fields: fields.filter((f) => f && f.value !== undefined && f.value !== '').slice(0, 10).map((f) => ({ name: clean(f.name, 256), value: clean(f.value, 1024), inline: f.inline !== false })),
      timestamp: new Date().toISOString(),
    }],
  };
}

