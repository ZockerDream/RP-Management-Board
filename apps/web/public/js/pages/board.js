// Pinnwand (Wunsch des Auftraggebers vom 2026-11-13): Ankündigungen an die ganze Organisation oder an Ränge, mit
// „gelesen von“, und Umfragen. Funktion „Pinnwand & Umfragen“: 2 lesen und abstimmen, 3 schreiben, 4 Fremdes verwalten.
import { api } from '../api.js';
import { $, $$, esc, empty, tag, fdatetime, openForm, confirmBox, toast } from '../ui.js';
import { can } from '../app.js';
import { markdownBlock } from '../markdown.js';
import { loadTeams, pickTeam, rememberTeam, teamSelect, noTeam } from './org-pick.js';
import { fromLocalInput } from './case-parts.js';

export async function render(view, params) {
  const teams = await loadTeams('notices');
  let teamId = pickTeam(teams, 'board', params?.get?.('team'));
  let tab = params?.get?.('tab') === 'polls' ? 'polls' : 'notices';
  let notices = [];
  let polls = [];
  let ranks = [];
  const level = () => teams.find((t) => t.id === teamId)?.level || 0;
  view.innerHTML = `<div class="page-head"><div><h1>Pinnwand</h1><p>Ankündigungen und Umfragen deiner Organisation</p></div>
    <div class="actions">${teamSelect(teams, teamId)}<span id="b-actions"></span></div></div>
    ${teams.length ? `<div><div class="tabs"><button data-tab="notices" class="${tab === 'notices' ? 'on' : ''}">Ankündigungen</button><button data-tab="polls" class="${tab === 'polls' ? 'on' : ''}">Umfragen</button></div>
    <div class="tab-panel ${tab === 'notices' ? 'on' : ''}" data-panel="notices"><div id="b-notices"></div></div>
    <div class="tab-panel ${tab === 'polls' ? 'on' : ''}" data-panel="polls"><div id="b-polls"></div></div></div>` : noTeam('die Pinnwand')}`;
  if (!teams.length) return;

  const actions = () => {
    const write = level() >= 3;
    $('#b-actions', view).innerHTML = write && can('notice:create') ? (tab === 'polls' ? '<button class="btn" id="b-poll-new">Neue Umfrage</button>' : '<button class="btn" id="b-new">Neue Ankündigung</button>') : '';
  };

  function drawNotices() {
    $('#b-notices', view).innerHTML = notices.length ? notices.map((n) => `<article class="card notice ${n.pinned ? 'pinned' : ''} ${n.read_at ? '' : 'unread'}" data-notice="${n.id}" style="margin-bottom:14px">
      <div class="card-head"><div><h2>${n.pinned ? '📌 ' : ''}${esc(n.title)}</h2><small>${esc(n.created_by_name || '–')} · ${fdatetime(n.created_at)}${n.rank_names.length ? ` · an ${esc(n.rank_names.join(', '))} und höher` : ' · an alle'}</small></div>
        <div class="row start" style="gap:6px;flex-wrap:wrap">${n.read_at ? '' : `${tag('primary', 'Neu')}<button class="btn ghost sm" data-read="${n.id}">Gelesen</button>`}
        ${n.read_count !== undefined ? `<button class="btn ghost sm" data-reads="${n.id}">Gelesen von ${n.read_count}</button>` : ''}
        ${n.can_edit ? `<button class="btn ghost sm" data-edit="${n.id}">Bearbeiten</button><button class="btn ghost sm" data-del="${n.id}">Löschen</button>` : ''}</div></div>
      ${n.body ? markdownBlock(n.body) : ''}</article>`).join('') : `<div class="card">${empty('Noch keine Ankündigungen.')}</div>`;
  }

  function pollHtml(p) {
    const total = p.voters || 0;
    const opts = p.options.map((o) => {
      const r = p.results?.find((x) => x.id === o.id);
      const pct = r && total ? Math.round((r.count / total) * 100) : 0;
      const mine = p.my_vote?.includes(o.id);
      return `<label class="poll-opt ${mine ? 'mine' : ''}">${p.can_vote ? `<input type="${p.multiple ? 'checkbox' : 'radio'}" name="poll-${p.id}" value="${esc(o.id)}" ${mine ? 'checked' : ''}>` : ''}
        <span class="grow">${esc(o.text)}${r?.names?.length ? `<br><small class="muted">${esc(r.names.join(', '))}</small>` : ''}</span>
        ${r ? `<span class="poll-bar"><i style="width:${pct}%"></i></span><b class="poll-n">${r.count}</b>` : ''}</label>`;
    }).join('');
    return `<article class="card" style="margin-bottom:14px"><div class="card-head"><div><h2>${esc(p.question)}</h2>
      <small>${esc(p.created_by_name || '–')} · ${fdatetime(p.created_at)} · ${p.multiple ? 'mehrere Antworten' : 'eine Antwort'} · ${p.anonymous ? 'anonym' : 'namentlich'}${p.closes_at && !p.closed ? ` · endet ${fdatetime(p.closes_at)}` : ''}</small></div>
      <div class="row start" style="gap:6px">${p.closed ? tag('', 'Beendet') : tag('ok', 'Offen')}${p.can_edit && !p.closed ? `<button class="btn ghost sm" data-poll-close="${p.id}">Beenden</button>` : ''}${p.can_edit ? `<button class="btn ghost sm" data-poll-del="${p.id}">Löschen</button>` : ''}</div></div>
      ${p.description ? markdownBlock(p.description) : ''}
      <div class="poll-opts">${opts}</div>
      <div class="row" style="margin-top:10px"><small class="muted">${total} ${total === 1 ? 'Stimme' : 'Stimmen'}${p.results ? '' : ' · Ergebnis nach deiner Stimme'}</small>
        ${p.can_vote ? `<button class="btn sm" data-vote="${p.id}">${p.my_vote ? 'Stimme ändern' : 'Abstimmen'}</button>` : ''}</div></article>`;
  }
  const drawPolls = () => { $('#b-polls', view).innerHTML = polls.length ? polls.map(pollHtml).join('') : `<div class="card">${empty('Noch keine Umfragen.')}</div>`; };

  async function load() {
    [notices, polls] = await Promise.all([api.get(`/notices?team_id=${teamId}`), api.get(`/polls?team_id=${teamId}`)]);
    actions();
    drawNotices();
    drawPolls();
  }
  // Rangliste für die Zielgruppe: über GET /teams (voll) nur, wenn nötig
  async function rankOptions() {
    if (ranks.length) return ranks;
    const t = (await api.get('/teams')).find((x) => x.id === teamId);
    ranks = (t?.ranks || []).slice().sort((a, b) => b.position - a.position);
    return ranks;
  }

  async function noticeForm(n) {
    const list = await rankOptions();
    return openForm({
      title: n ? 'Ankündigung bearbeiten' : 'Neue Ankündigung', wide: true,
      fields: [
        { name: 'title', label: 'Titel', value: n?.title, required: true, maxlength: 200, full: true },
        { name: 'body', label: 'Text', type: 'textarea', value: n?.body, maxlength: 20000, full: true, markdown: true, rows: 8 },
        { name: 'rank_ids', label: 'An (leer = alle Mitglieder; ein Rang gilt samt allen höheren)', type: 'multi', options: list.map((r) => ({ v: r.id, l: r.name })), value: n?.rank_ids || [], full: true },
        { name: 'pinned', label: 'Oben anheften', type: 'checkbox', value: n?.pinned || false },
      ],
      onSubmit: async (v) => {
        const body = { title: v.title.trim(), body: v.body, rank_ids: v.rank_ids, pinned: v.pinned };
        if (n) { await api.patch(`/notices/${n.id}`, body); toast('Gespeichert'); return; }
        const r = await api.post('/notices', { ...body, team_id: teamId });
        toast(`Veröffentlicht, ${r.recipients} ${r.recipients === 1 ? 'Empfänger' : 'Empfänger'} benachrichtigt`);
      },
    });
  }
  const pollForm = () => openForm({
    title: 'Neue Umfrage', wide: true,
    fields: [
      { name: 'question', label: 'Frage', required: true, maxlength: 300, full: true },
      { name: 'description', label: 'Beschreibung (optional)', type: 'textarea', maxlength: 5000, full: true, markdown: true },
      { name: 'options', label: 'Antworten (eine je Zeile, 2 bis 20)', type: 'textarea', required: true, rows: 5, full: true, placeholder: 'Freitag 20 Uhr\nSamstag 18 Uhr' },
      { name: 'multiple', label: 'Mehrere Antworten erlaubt', type: 'checkbox' },
      { name: 'anonymous', label: 'Anonym (nur Zahlen, keine Namen)', type: 'checkbox' },
      { name: 'closes_at', label: 'Endet am (optional)', type: 'datetime-local' },
    ],
    onSubmit: async (v) => {
      const options = v.options.split('\n').map((x) => x.trim()).filter(Boolean);
      if (options.length < 2) throw new Error('Mindestens zwei Antworten');
      await api.post('/polls', { team_id: teamId, question: v.question.trim(), description: v.description, options, multiple: v.multiple, anonymous: v.anonymous, closes_at: v.closes_at ? fromLocalInput(v.closes_at) : null });
      toast('Umfrage gestartet');
    },
  });

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !view.contains(b)) return;
    try {
      if (b.matches('.tabs [data-tab]')) { tab = b.dataset.tab; actions(); return; }
      const d = b.dataset;
      const notice = (id) => notices.find((n) => n.id === id);
      let changed = false;
      if (b.id === 'b-new') changed = await noticeForm(null);
      else if (b.id === 'b-poll-new') changed = await pollForm();
      else if (d.edit) changed = await noticeForm(notice(d.edit));
      else if (d.del && await confirmBox('Ankündigung löschen', `„${notice(d.del).title}“ wird für alle gelöscht.`)) { await api.del(`/notices/${d.del}`); changed = true; }
      else if (d.read) { await api.post(`/notices/${d.read}/read`); changed = true; }
      else if (d.reads) {
        const list = await api.get(`/notices/${d.reads}/reads`);
        const read = list.filter((x) => x.read_at), open = list.filter((x) => !x.read_at);
        await openForm({ title: 'Gelesen von', submit: 'Schließen', fields: [{ type: 'html', html: `<p><b>${read.length} von ${list.length}</b> haben gelesen.</p>
          ${read.map((x) => `<div class="list-item"><span class="grow">${esc(x.name)}</span><small class="muted">${fdatetime(x.read_at)}</small></div>`).join('')}
          ${open.length ? `<p class="muted" style="margin-top:12px">Noch nicht gelesen: ${esc(open.map((x) => x.name).join(', '))}</p>` : ''}` }], onSubmit: async () => true });
      } else if (d.vote) {
        const picked = $$(`input[name="poll-${d.vote}"]:checked`, view).map((i) => i.value);
        if (!picked.length) throw new Error('Wähle eine Antwort');
        await api.post(`/polls/${d.vote}/vote`, { option_ids: picked });
        toast('Abgestimmt');
        changed = true;
      } else if (d.pollClose && await confirmBox('Umfrage beenden', 'Danach kann niemand mehr abstimmen.', 'Beenden')) { await api.post(`/polls/${d.pollClose}/close`); changed = true; }
      else if (d.pollDel && await confirmBox('Umfrage löschen', 'Die Umfrage wird samt Stimmen gelöscht.')) { await api.del(`/polls/${d.pollDel}`); changed = true; }
      if (changed) await load();
    } catch (error) { toast(error.message, true); }
  });
  $('#org-team', view)?.addEventListener('change', async (e) => { teamId = e.target.value; rememberTeam('board', teamId); ranks = []; await load(); });
  await load();
}
