import { z } from 'zod';
import { many, one, q, tx } from '../db.js';
import { requireAuth, adminOnly, bad, notFound } from '../authz.js';
import { config } from '../config.js';
import { encrypt, decrypt, randomToken, sha256 } from '../security.js';

const providers = ['google', 'microsoft'];
const providerSchema = z.enum(providers);
const callbackUrl = (provider) => `${config.appUrl}/api/integrations/${provider}/callback`;
const clientCredentials = (provider) => {
  const credentials = provider === 'google'
    ? [config.oauth.googleClientId, config.oauth.googleClientSecret]
    : [config.oauth.microsoftClientId, config.oauth.microsoftClientSecret];
  if (!credentials[0] || !credentials[1]) throw bad(`${provider === 'google' ? 'Google' : 'Microsoft'} OAuth ist nicht konfiguriert`);
  return credentials;
};

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error?.message || data.error || `Provider-Fehler (${response.status})`);
  return data;
}

function providerEndpoints(provider) {
  return provider === 'google'
    ? { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token' }
    : { auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token' };
}

async function tokenFor(userId, provider) {
  const connection = await one('SELECT * FROM provider_connections WHERE user_id=$1 AND provider=$2', [userId, provider]);
  if (!connection) throw notFound('Konto nicht verbunden');
  if (new Date(connection.expires_at).getTime() > Date.now() + 60_000) return { connection, token: decrypt(connection.access_token_enc) };
  const [clientId, clientSecret] = clientCredentials(provider);
  const endpoint = providerEndpoints(provider).token;
  const refresh = decrypt(connection.refresh_token_enc);
  const data = await jsonRequest(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token',
      ...(provider === 'microsoft' ? { scope: 'offline_access User.Read Contacts.Read Calendars.Read' } : {}),
    }),
  });
  await q('UPDATE provider_connections SET access_token_enc=$3, refresh_token_enc=$4, expires_at=now()+($5||\' seconds\')::interval WHERE user_id=$1 AND provider=$2',
    [userId, provider, encrypt(data.access_token), encrypt(data.refresh_token || refresh), Math.max(60, Number(data.expires_in) || 3600)]);
  return { connection, token: data.access_token };
}

async function providerPages(provider, token, endpoint) {
  const results = [];
  let url = endpoint;
  for (let page = 0; url && page < 20; page++) {
    const parsed = new URL(url);
    if (provider === 'google' ? parsed.hostname !== 'www.googleapis.com' && parsed.hostname !== 'people.googleapis.com' : parsed.hostname !== 'graph.microsoft.com') {
      throw new Error('Unerwartetes Ziel in der Provider-Antwort');
    }
    const data = await jsonRequest(parsed, { headers: { authorization: `Bearer ${token}`, ...(provider === 'microsoft' ? { Prefer: 'outlook.timezone="UTC"' } : {}) } });
    results.push(...(provider === 'google' ? data.connections || data.items || [] : data.value || []));
    url = provider === 'google'
      ? (data.nextPageToken ? `${parsed.origin}${parsed.pathname}?${new URLSearchParams({ ...Object.fromEntries(parsed.searchParams), pageToken: data.nextPageToken })}` : null)
      : data['@odata.nextLink'] || null;
  }
  if (url) throw new Error('Synchronisierungslimit erreicht; es wurden keine Daten geändert');
  return results;
}

const googleDate = (event) => {
  const value = event.start?.dateTime || event.start?.date;
  return value ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : null;
};
const microsoftDate = (event) => event.start?.dateTime ? new Date(`${event.start.dateTime}${event.start.timeZone === 'UTC' ? 'Z' : ''}`) : null;

export default async function routes(app) {
  app.get('/integrations', requireAuth, async (req) => many(
    'SELECT provider,email,last_sync_at FROM provider_connections WHERE user_id=$1 ORDER BY provider',
    [req.user.id],
  ));

  app.get('/integrations/:provider/connect', requireAuth, async (req) => {
    const provider = providerSchema.parse(req.params.provider);
    const [clientId] = clientCredentials(provider);
    const state = randomToken(32);
    await q('DELETE FROM oauth_states WHERE expires_at<=now()');
    await q('INSERT INTO oauth_states(state_hash,user_id,provider,expires_at) VALUES ($1,$2,$3,now()+interval \'10 minutes\')',
      [sha256(state), req.user.id, provider]);
    const endpoints = providerEndpoints(provider);
    const params = provider === 'google'
      ? { client_id: clientId, redirect_uri: callbackUrl(provider), response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', scope: 'openid email https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/calendar.readonly', state }
      : { client_id: clientId, redirect_uri: callbackUrl(provider), response_type: 'code', response_mode: 'query', scope: 'openid email offline_access User.Read Contacts.Read Calendars.Read', state };
    return { url: `${endpoints.auth}?${new URLSearchParams(params)}` };
  });

  app.get('/integrations/:provider/callback', async (req, reply) => {
    const provider = providerSchema.parse(req.params.provider);
    const query = z.object({ state: z.string().min(20).max(200), code: z.string().min(1).optional(), error: z.string().optional() }).parse(req.query);
    if (query.error || !query.code) throw bad('Verknüpfung wurde abgebrochen oder vom Anbieter abgelehnt');
    const state = await one('DELETE FROM oauth_states WHERE state_hash=$1 AND provider=$2 AND expires_at>now() RETURNING user_id',
      [sha256(query.state), provider]);
    if (!state) throw bad('OAuth-Status ist ungültig oder abgelaufen');
    const [clientId, clientSecret] = clientCredentials(provider);
    const token = await jsonRequest(providerEndpoints(provider).token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: query.code, redirect_uri: callbackUrl(provider), grant_type: 'authorization_code' }),
    });
    const authHeader = { authorization: `Bearer ${token.access_token}` };
    const profile = await jsonRequest(provider === 'google'
      ? 'https://www.googleapis.com/oauth2/v2/userinfo'
      : 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: authHeader });
    const email = profile.email || profile.mail || profile.userPrincipalName || '';
    const previous = await one('SELECT refresh_token_enc FROM provider_connections WHERE user_id=$1 AND provider=$2', [state.user_id, provider]);
    const refresh = token.refresh_token ? encrypt(token.refresh_token) : previous?.refresh_token_enc;
    if (!refresh) throw bad('Provider hat kein Refresh-Token geliefert; bitte Verbindung erneut autorisieren');
    await q(
      `INSERT INTO provider_connections(user_id,provider,email,access_token_enc,refresh_token_enc,expires_at)
       VALUES ($1,$2,$3,$4,$5,now()+($6||' seconds')::interval)
       ON CONFLICT(user_id,provider) DO UPDATE SET email=$3,access_token_enc=$4,refresh_token_enc=$5,expires_at=now()+($6||' seconds')::interval`,
      [state.user_id, provider, email, encrypt(token.access_token), refresh, Math.max(60, Number(token.expires_in) || 3600)],
    );
    return reply.redirect(`${config.appUrl}/#/settings?integration=${provider}`);
  });

  app.post('/integrations/:provider/sync', requireAuth, async (req) => {
    const provider = providerSchema.parse(req.params.provider);
    const { token } = await tokenFor(req.user.id, provider);
    const contactsUrl = provider === 'google'
      ? 'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers&pageSize=1000'
      : 'https://graph.microsoft.com/v1.0/me/contacts?$select=id,displayName,emailAddresses,mobilePhone,businessPhones&$top=250';
    const from = new Date(Date.now() - 180 * 86400_000).toISOString();
    const to = new Date(Date.now() + 730 * 86400_000).toISOString();
    const eventsUrl = provider === 'google'
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&showDeleted=false&maxResults=2500&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}`
      : `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}&$select=id,subject,start,end,isAllDay&$top=250`;
    const [rawContacts, rawEvents] = await Promise.all([providerPages(provider, token, contactsUrl), providerPages(provider, token, eventsUrl)]);
    const contacts = rawContacts.map((item) => provider === 'google' ? {
      id: item.resourceName, name: item.names?.[0]?.displayName || '', email: item.emailAddresses?.[0]?.value || '', phone: item.phoneNumbers?.[0]?.value || '',
    } : {
      id: item.id, name: item.displayName || '', email: item.emailAddresses?.[0]?.address || '', phone: item.mobilePhone || item.businessPhones?.[0] || '',
    }).filter((item) => item.id);
    const events = rawEvents.map((item) => {
      const start = provider === 'google' ? googleDate(item) : microsoftDate(item);
      const end = provider === 'google'
        ? (item.end?.dateTime || item.end?.date ? new Date((item.end.dateTime || item.end.date) + ((item.end.dateTime || item.end.date).length === 10 ? 'T00:00:00Z' : '')) : null)
        : (item.end?.dateTime ? new Date(`${item.end.dateTime}${item.end.timeZone === 'UTC' ? 'Z' : ''}`) : null);
      return { id: item.id, title: provider === 'google' ? item.summary || '(Ohne Titel)' : item.subject || '(Ohne Titel)', start, end, allDay: provider === 'google' ? Boolean(item.start?.date) : Boolean(item.isAllDay) };
    }).filter((item) => item.id && item.start && !Number.isNaN(item.start.getTime()));
    await tx(async (client) => {
      for (const contact of contacts) {
        await client.query(`INSERT INTO synced_contacts(user_id,provider,external_id,name,email,phone) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT(user_id,provider,external_id) DO UPDATE SET name=$4,email=$5,phone=$6,updated_at=now()`, [req.user.id, provider, contact.id, contact.name, contact.email, contact.phone]);
      }
      for (const event of events) {
        await client.query(`INSERT INTO synced_calendar_events(user_id,provider,external_id,title,starts_at,ends_at,all_day) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(user_id,provider,external_id) DO UPDATE SET title=$4,starts_at=$5,ends_at=$6,all_day=$7,updated_at=now()`, [req.user.id, provider, event.id, event.title, event.start.toISOString(), event.end?.toISOString() || null, event.allDay]);
      }
      const contactIds = contacts.map((contact) => contact.id);
      const eventIds = events.map((event) => event.id);
      await client.query('DELETE FROM synced_contacts WHERE user_id=$1 AND provider=$2 AND NOT (external_id=ANY($3::text[]))', [req.user.id, provider, contactIds]);
      await client.query(`DELETE FROM synced_calendar_events
        WHERE user_id=$1 AND provider=$2 AND starts_at >= $3 AND starts_at < $4
          AND NOT (external_id=ANY($5::text[]))`,
      [req.user.id, provider, new Date(from), new Date(to), eventIds]);
      await client.query('UPDATE provider_connections SET last_sync_at=now() WHERE user_id=$1 AND provider=$2', [req.user.id, provider]);
    });
    return { contacts: contacts.length, events: events.length };
  });

  app.get('/integrations/:provider/contacts', requireAuth, async (req) => {
    const provider = providerSchema.parse(req.params.provider);
    return many('SELECT external_id,name,email,phone FROM synced_contacts WHERE user_id=$1 AND provider=$2 ORDER BY name', [req.user.id, provider]);
  });

  app.delete('/integrations/:provider', requireAuth, async (req) => {
    const provider = providerSchema.parse(req.params.provider);
    await tx(async (client) => {
      await client.query('DELETE FROM synced_contacts WHERE user_id=$1 AND provider=$2', [req.user.id, provider]);
      await client.query('DELETE FROM synced_calendar_events WHERE user_id=$1 AND provider=$2', [req.user.id, provider]);
      await client.query('DELETE FROM provider_connections WHERE user_id=$1 AND provider=$2', [req.user.id, provider]);
    });
    return { ok: true };
  });

  app.get('/bug-reports', requireAuth, async (req) => ({
    github_enabled: Boolean(config.githubIssues.token),
    items: await many(
      `SELECT id, title, description, steps, github_issue_number, github_url, github_sync_error, created_at
       FROM bug_reports WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id],
    ),
  }));

  app.get('/admin/bug-reports', adminOnly(), async () => ({
    items: await many(
      `SELECT br.id, br.title, br.description, br.steps, br.github_issue_number, br.github_url,
         br.github_sync_error, br.created_at, u.name user_name, u.email user_email
       FROM bug_reports br JOIN users u ON u.id=br.user_id
       ORDER BY br.created_at DESC LIMIT 200`,
    ),
  }));

  app.post('/bug-reports', requireAuth, async (req) => {
    const report = z.object({
      title: z.string().trim().min(5).max(120),
      description: z.string().trim().min(20).max(10000),
      steps: z.string().max(5000).default(''),
    }).parse(req.body);
    let ticket = await one(
      `INSERT INTO bug_reports(user_id,title,description,steps) VALUES ($1,$2,$3,$4)
       RETURNING id,title,description,steps,github_issue_number,github_url,github_sync_error,created_at`,
      [req.user.id, report.title, report.description, report.steps],
    );
    if (!config.githubIssues.token) return { ...ticket, github_enabled: false };
    try {
    const [owner, repo] = config.githubIssues.repository.split('/');
    if (!owner || !repo || config.githubIssues.repository.split('/').length !== 2) throw new Error('GITHUB_ISSUES_REPOSITORY muss owner/repo sein');
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.githubIssues.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
      body: JSON.stringify({
        title: report.title,
        body: `Interne Ticket-ID: ${ticket.id}\n\n${report.description}\n\n${report.steps ? `### Reproduktionsschritte\n${report.steps}\n\n` : ''}---\nGemeldet über Budget Manager.`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GitHub konnte keinen Eintrag anlegen (${response.status}): ${result.message || 'Unbekannter Fehler'}`);
    if (!result.number || new URL(result.html_url).origin !== 'https://github.com') throw new Error('GitHub lieferte keinen gültigen Issue-Link zurück');
    ticket = await one(
      `UPDATE bug_reports SET github_issue_number=$2,github_url=$3,github_sync_error=''
       WHERE id=$1 RETURNING id,title,description,steps,github_issue_number,github_url,github_sync_error,created_at`,
      [ticket.id, result.number, result.html_url],
    );
    } catch (error) {
      const message = error.message || 'Unbekannter GitHub-Fehler';
      app.log.error({ err: error, ticketId: ticket.id }, 'Fehlerbericht konnte nicht an GitHub übertragen werden');
      ticket = await one(
        `UPDATE bug_reports SET github_sync_error=$2
         WHERE id=$1 RETURNING id,title,description,steps,github_issue_number,github_url,github_sync_error,created_at`,
        [ticket.id, message.slice(0, 1000)],
      );
    }
    return { ...ticket, github_enabled: true };
  });
}
