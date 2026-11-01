import { api } from '../api.js';
import { $, esc, empty, openForm, confirmBox, toast, showSecret, tag } from '../ui.js';
import { can, state } from '../app.js';

const ROLES = [{ v: 'owner', l: 'Owner' }, { v: 'editor', l: 'Editor' }, { v: 'viewer', l: 'Viewer' }];

export async function render(view) {
  let teams = [], sel = null;
  view.innerHTML = `<div class="page-head"><div><h1>Teams</h1><p>Gemeinsam Budgets führen – getrennt von deinen Solo-Budgets</p></div>
    <div class="actions">${can('team:create') ? '<button class="btn" id="t-new">Team erstellen</button>' : ''}</div></div><div id="t-body"></div>`;

  async function load() {
    teams = await api.get('/teams');
    if (!teams.find((t) => t.id === sel)) sel = teams[0]?.id;
    const t = teams.find((x) => x.id === sel);
    if (!t) { $('#t-body').innerHTML = `<div class="card">${empty('Du bist noch in keinem Team.')}</div>`; return; }
    const owner = t.role === 'owner';
    const members = t.members || [], inv = t.invitations || [];
    $('#t-body').innerHTML = `${teams.length > 1 ? `<div class="seg" id="t-sel" style="margin-bottom:16px">${teams.map((x) => `<button data-t="${x.id}" class="${x.id === sel ? 'on' : ''}">${esc(x.name)}</button>`).join('')}</div>` : ''}
    <div class="grid cols-21"><div class="card"><div class="card-head"><h2>${esc(t.name)} · Mitglieder</h2>${tag('', `${members.length} aktiv · ${inv.length} eingeladen`)}</div>
      <div class="scroll-x"><table class="table"><thead><tr><th>Name</th><th>E-Mail</th><th style="width:140px">Teamrolle</th><th></th></tr></thead><tbody>
      ${members.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td>${esc(m.email)}</td><td>${owner ? `<select data-role="${m.id}">${ROLES.map((r) => `<option value="${r.v}" ${r.v === m.role ? 'selected' : ''}>${r.l}</option>`).join('')}</select>` : esc(m.role)}</td>
        <td>${owner || m.id === state.me.id ? `<button class="link" data-rm="${m.id}">${m.id === state.me.id ? 'Verlassen' : 'Entfernen'}</button>` : ''}</td></tr>`).join('')}
      ${inv.map((i) => `<tr><td class="muted">—</td><td>${esc(i.email)}</td><td><span class="tag warn">Einladung offen</span></td><td>${owner ? `<button class="link" data-rminv="${i.id}">Entfernen</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${owner ? `<form class="row" id="t-inv" style="margin-top:16px"><input name="email" type="email" placeholder="E-Mail zum Einladen" required><select name="role" style="width:120px">${ROLES.filter((r) => r.v !== 'owner').map((r) => `<option value="${r.v}">${r.l}</option>`).join('')}</select><button class="btn">Einladen</button></form>
      <div class="row" style="margin-top:16px"><button class="btn ghost sm" id="t-ren">Umbenennen</button><button class="btn ghost sm" id="t-del">Team löschen</button></div>` : ''}</div>
      <div class="card stack"><div class="card-head"><h2>Geteilte Budgets</h2></div>
      <p>${t.budgets} geteilte${t.budgets === 1 ? 's' : ''} Budget${t.budgets === 1 ? '' : 's'} – anzulegen unter „Budgets“.</p>
      <div class="note info">Eigene Summen und Statistiken – kein Vermischen mit Solo-Budgets.</div></div></div>`;
  }

  view.addEventListener('click', async (e) => {
    const g = (s) => e.target.closest(s);
    const t = teams.find((x) => x.id === sel);
    try {
      if (g('#t-new')) {
        if (await openForm({ title: 'Team erstellen', fields: [{ name: 'name', label: 'Name', required: true, full: true }], onSubmit: (v) => api.post('/teams', { name: v.name.trim() }) })) load();
      } else if (g('#t-sel [data-t]')) { sel = g('[data-t]').dataset.t; load(); }
      else if (g('#t-ren')) { if (await openForm({ title: 'Team umbenennen', fields: [{ name: 'name', label: 'Name', value: t.name, required: true, full: true }], onSubmit: (v) => api.patch(`/teams/${t.id}`, { name: v.name.trim() }) })) load(); }
      else if (g('#t-del')) { if (await confirmBox('Team löschen', 'Geteilte Budgets des Teams werden ebenfalls gelöscht.')) { await api.del(`/teams/${t.id}`); load(); } }
      else if (g('[data-rm]')) { if (await confirmBox('Mitglied entfernen', 'Soll das Mitglied aus dem Team entfernt werden?', 'Entfernen')) { await api.del(`/teams/${t.id}/members/${g('[data-rm]').dataset.rm}`); load(); } }
      else if (g('[data-rminv]')) { await api.del(`/teams/${t.id}/invitations/${g('[data-rminv]').dataset.rminv}`); load(); }
    } catch (x) { toast(x.message, true); }
  });
  view.addEventListener('change', async (e) => {
    if (!e.target.dataset.role) return;
    try { await api.patch(`/teams/${sel}/members/${e.target.dataset.role}`, { team_role: e.target.value }); toast('Rolle geändert'); } catch (x) { toast(x.message, true); load(); }
  });
  view.addEventListener('submit', async (e) => {
    if (e.target.id !== 't-inv') return;
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api.post(`/teams/${sel}/members`, { email: f.get('email'), team_role: f.get('role') });
      if (r.link && !r.mail_sent) await showSecret('Einladungslink', 'E-Mail-Versand ist nicht konfiguriert. Gib diesen Link (7 Tage gültig) manuell weiter:', r.link);
      else toast(r.invited ? 'Einladung gesendet' : 'Mitglied hinzugefügt');
      load();
    } catch (x) { toast(x.message, true); }
  });
  await load();
}
