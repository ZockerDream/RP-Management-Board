import { api } from '../api.js';
import { $, esc, empty, openForm, confirmBox, toast, todayStr } from '../ui.js';
import { can, state, reloadMe } from '../app.js';
import { payrollAccountOptions, payrollAccountHint } from './common.js';

const hoursText = (hours) => `${Number(hours).toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.`;
const dateText = (date) => String(date).slice(0, 10).split('-').reverse().join('.');
const timeText = (time) => (time ? String(time).slice(0, 5) : '–');
const asDate = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const localDate = (date) => date.toLocaleDateString('sv-SE');
function range(mode, value) {
  const selected = asDate(value);
  if (mode === 'day') return [value, value];
  if (mode === 'month') {
    const start = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const end = new Date(selected.getFullYear(), selected.getMonth() + 1, 0);
    return [localDate(start), localDate(end)];
  }
  const start = new Date(selected);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return [localDate(start), localDate(end)];
}

async function entryForm(entry, projects) {
  const projectOptions = entry?.project_id && !projects.some((project) => project.id === entry.project_id)
    ? [...projects, { id: entry.project_id, name: entry.project_name }]
    : projects;
  return openForm({
    title: entry ? 'Stundeneintrag bearbeiten' : 'Stunden manuell erfassen',
    fields: [
      { name: 'work_date', label: 'Datum', type: 'date', value: entry?.work_date?.slice(0, 10) || todayStr(), required: true },
      { name: 'project_id', label: 'Projekt / Kunde', type: 'select', options: [{ v: '', l: '– Ohne Projekt –' }, ...projectOptions.map((p) => ({ v: p.id, l: `${p.name}${p.team_name ? ` · ${p.team_name}` : ''}` }))], value: entry?.project_id || '' },
      { name: 'hours', label: 'Arbeitsstunden', type: 'number', min: 0.01, max: 24, step: 0.01, value: entry?.hours || '', required: true },
      { name: 'started_at', label: 'Beginn (optional)', type: 'time', value: entry?.started_at?.slice(0, 5) || '' },
      { name: 'ended_at', label: 'Ende (optional)', type: 'time', value: entry?.ended_at?.slice(0, 5) || '', help: 'Ende vor Beginn heißt über Mitternacht: Die Stunden werden auf beide Tage aufgeteilt.' },
      { name: 'break_minutes', label: 'Pause in Minuten', type: 'number', min: 0, max: 1440, value: entry?.break_minutes || 0 },
      { name: 'note', label: 'Notiz', type: 'textarea', value: entry?.note || '', full: true },
    ],
    onSubmit: async (v) => {
      const body = { work_date: v.work_date, hours: Number(v.hours), project_id: v.project_id || null, started_at: v.started_at || null, ended_at: v.ended_at || null, break_minutes: Number(v.break_minutes) || 0, note: v.note };
      const result = entry ? await api.patch(`/work-hours/${entry.id}`, body) : await api.post('/work-hours', body);
      if (result?.entries > 1) toast('Über Mitternacht: auf zwei Tage aufgeteilt');
    },
  });
}

export async function render(view) {
  let entries = [];
  let projects = [];
  let accounts = [];
  const teamEntries = new Map();
  let timer = null;
  const teams = can('team:read') ? (await api.get('/teams')).filter((team) => team.role !== 'viewer') : [];
  const today = todayStr();
  view.innerHTML = `<div class="page-head"><div><h1>Stundenzettel</h1><p>Ein- und ausstempeln, Pausen erfassen und Arbeitszeiten im Überblick behalten</p></div>
    <div class="actions"><button class="btn ghost" id="work-export">CSV-Export</button><button class="btn ghost" id="work-pdf">Monats-PDF</button><button class="btn ghost" id="project-new">Projekt anlegen</button><button class="btn" id="work-new">Manuell erfassen</button></div></div>
    <div class="card"><div class="card-head"><h2>Zeiterfassung</h2><span id="timer-state" class="tag">Inaktiv</span></div>
      <div class="toolbar" style="gap:8px;flex-wrap:wrap"><select id="timer-project"><option value="">Ohne Projekt</option></select>
      <input id="timer-note" maxlength="500" placeholder="Notiz (optional)" style="flex:1;min-width:180px">
      <b id="timer-clock" class="value">00:00:00</b><button class="btn" id="timer-start">Einstempeln</button>
      <button class="btn ghost" id="timer-pause" hidden>Pause</button><button class="btn ghost" id="timer-stop" hidden>Ausstempeln</button><button class="btn ghost" id="timer-discard" hidden>Verwerfen</button></div>
      <small id="timer-hint" class="muted"></small></div>
    <div class="grid cols-5" id="work-kpis">
      <div class="card kpi"><span class="label">Arbeitsstunden</span><span class="value" id="work-kpi-hours">–</span></div>
      <div class="card kpi"><span class="label">Einträge im Zeitraum</span><span class="value" id="work-kpi-entries">–</span></div>
      <div class="card kpi"><span class="label">Wochen-Soll</span><span class="value" id="work-kpi-target">–</span></div>
      <div class="card kpi" id="work-kpi-overtime" hidden><span class="label">Überstunden-Saldo</span><span class="value" id="work-kpi-overtime-value">–</span></div>
      <div class="card kpi" id="work-kpi-pay" hidden><span class="label">Vergütung</span><span class="value" id="work-kpi-pay-value">–</span></div>
    </div>
    <div class="card"><div class="card-head"><h2>Gehalt</h2><button class="btn ghost sm" id="pay-settings">Gehalt einstellen</button></div><div id="pay-summary"></div></div>
    <div class="card"><div class="card-head"><h2>Auswertung</h2><b id="work-total" class="up"></b></div>
      <div class="toolbar" style="gap:8px;flex-wrap:wrap"><select id="work-mode"><option value="week">Woche</option><option value="day">Tag</option><option value="month">Monat</option></select>
      <input id="work-date" type="date" value="${today}"><span id="work-range" class="muted"></span></div><div id="work-list"></div></div>
    ${teams.length ? `<div class="card"><div class="card-head"><h2>Team-Stundenzettel</h2><div class="toolbar"><select id="work-team">${teams.map((team) => `<option value="${team.id}">${esc(team.name)}</option>`).join('')}</select><input id="team-work-month" type="month" value="${today.slice(0, 7)}"></div></div><div id="team-work-report"></div></div>` : ''}
    <div class="card"><div class="card-head"><h2>Projekte / Kunden</h2></div><div id="project-list"></div></div>`;

  function updateProjectOptions() {
    $('#timer-project').innerHTML = `<option value="">Ohne Projekt</option>${projects.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.name)}${p.team_name ? ` · ${esc(p.team_name)}` : ''}</option>`).join('')}`;
  }
  function elapsedSeconds() {
    if (!timer) return 0;
    const now = timer.paused_at ? new Date(timer.paused_at).getTime() : Date.now();
    return Math.max(0, Math.floor((now - new Date(timer.started_at).getTime()) / 1000) - Number(timer.paused_seconds || 0));
  }
  function drawTimer() {
    const running = Boolean(timer);
    $('#timer-state').textContent = !running ? 'Inaktiv' : timer.paused_at ? 'Pausiert' : 'Läuft';
    $('#timer-state').className = `tag ${running ? timer.paused_at ? 'warn' : 'ok' : ''}`;
    $('#timer-start').hidden = running;
    $('#timer-project').disabled = running;
    $('#timer-note').disabled = running;
    $('#timer-pause').hidden = !running;
    $('#timer-pause').textContent = timer?.paused_at ? 'Fortsetzen' : 'Pause';
    $('#timer-stop').hidden = !running;
    $('#timer-discard').hidden = !running;
    $('#timer-clock').textContent = new Date(elapsedSeconds() * 1000).toISOString().slice(11, 19);
    $('#timer-hint').textContent = running
      ? `Gestartet: ${new Date(timer.started_at).toLocaleString('de-DE')}${timer.project_name ? ` · ${timer.project_name}` : ''}`
      : 'Pausen werden nicht als Arbeitszeit gezählt. Über Mitternacht entsteht je Kalendertag ein Eintrag.';
  }
  async function loadProjects() {
    projects = await api.get('/work-projects');
    updateProjectOptions();
        $('#project-list').innerHTML = projects.length ? projects.map((p) => `<div class="list-item"><div class="grow"><b>${esc(p.name)}</b><small>${p.team_name ? `Team: ${esc(p.team_name)}` : 'Privat'} · ${p.active ? 'Aktiv' : 'Archiviert'}</small></div>
      <button class="btn ghost sm" data-project-toggle="${p.id}">${p.active ? 'Archivieren' : 'Aktivieren'}</button> <button class="btn ghost sm" data-project-delete="${p.id}">Löschen</button></div>`).join('') : empty('Noch keine Projekte angelegt.');
  }
  async function loadTimer() {
    timer = await api.get('/work-hours/timer');
    drawTimer();
  }
  const payText = (value, currency = state.me.currency || 'EUR') => new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(Number(value || 0));
  // Rechnet wie der Gehaltslauf in Cent, damit hier nie ein anderer Bonus steht als gebucht wird
  const bonusPerHour = (salary, percent) => Math.round(Math.round(Number(salary || 0) * 100) * Number(percent || 0) / 100) / 100;
  const salaryText = (salary, target, percent, currency) => `Festgehalt ${payText(salary, currency)} pro Tag · Wochen-Soll ${hoursText(target)} · Bonus ${Number(percent || 0).toLocaleString('de-DE')} % = ${payText(bonusPerHour(salary, percent), currency)} je Stunde über dem Soll`;
  function entriesTable(items) {
    return items.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Datum</th><th>Projekt / Kunde</th><th>Zeitraum</th><th>Pause</th><th>Arbeitszeit</th><th>Notiz</th><th></th></tr></thead><tbody>${items.map((item) => `<tr>
      <td>${dateText(item.work_date)}</td><td>${esc(item.project_name || '–')}</td><td>${timeText(item.started_at)} – ${timeText(item.ended_at)}</td>
      <td>${item.break_minutes || 0} Min.</td><td><b>${hoursText(item.hours)}</b></td><td>${esc(item.note || '–')}</td>
      <td style="white-space:nowrap"><button class="btn ghost sm" data-edit="${item.id}">Bearbeiten</button> <button class="btn ghost sm" data-del="${item.id}">Löschen</button></td></tr>`).join('')}</tbody></table></div>` : empty('Keine Arbeitszeit im gewählten Zeitraum erfasst.');
  }
  const salaryFields = (values, currency) => [
    { name: 'daily_salary', label: `Festgehalt pro Tag (${currency})`, type: 'number', min: 0, step: 0.01, value: values.daily_salary ?? 0, required: true, help: 'Jeden Tag, auch am Wochenende und unabhängig von den Stunden.' },
    { name: 'weekly_work_hours', label: 'Wochen-Sollzeit (Std.)', type: 'number', min: 1, step: 0.25, value: values.weekly_work_hours ?? 40, required: true, help: 'Ab dieser Stundenzahl (Montag bis Sonntag) gibt es den Bonus.' },
    { name: 'hourly_bonus_percent', label: 'Bonus je Stunde über dem Soll (% vom Festgehalt)', type: 'number', min: 0, step: 0.01, value: values.hourly_bonus_percent ?? 0, required: true, full: true, help: 'Beispiel: 17 % von 1.669 sind 283,73 je Stunde über dem Soll. Montags beginnt die Zählung neu.' },
  ];
  const salaryBody = (values) => ({
    daily_salary: Number(values.daily_salary),
    weekly_work_hours: Number(values.weekly_work_hours),
    hourly_bonus_percent: Number(values.hourly_bonus_percent),
  });
  async function loadPay() {
    accounts = can('budget:read') ? await api.get('/budgets') : [];
    const me = state.me;
    const account = accounts.find((item) => item.id === me.payroll_budget_id);
    $('#pay-summary').innerHTML = `${account ? `<p>Gutschrift auf <b>${esc(account.name)}</b></p>` : '<span class="tag warn">Kein Konto für die Gehaltsgutschrift gewählt</span>'}
      <p class="muted" style="margin-top:8px">${salaryText(me.daily_salary, me.weekly_work_hours ?? 40, me.hourly_bonus_percent)}</p>`;
  }
  function payForm() {
    const me = state.me;
    const currency = me.currency || 'EUR';
    const options = payrollAccountOptions(accounts, me, currency);
    return openForm({
      title: 'Gehalt einstellen',
      fields: [
        { name: 'payroll_budget_id', label: 'Konto für Gehaltsgutschrift', type: 'select', options, value: me.payroll_budget_id || '', full: true, help: payrollAccountHint(options, currency) },
        ...salaryFields(me, currency),
      ],
      onSubmit: async (values) => {
        await api.patch('/me', { payroll_budget_id: values.payroll_budget_id || null, ...salaryBody(values) });
        await reloadMe();
        toast('Gehalt gespeichert');
      },
    });
  }
  async function load() {
    const mode = $('#work-mode').value;
    const [from, to] = range(mode, $('#work-date').value);
    $('#work-range').textContent = `${dateText(from)} – ${dateText(to)}`;
    const result = mode === 'month'
      ? await api.get(`/work-hours/monthly?${new URLSearchParams({ month: $('#work-date').value.slice(0, 7) })}`)
      : await api.get(`/work-hours?${new URLSearchParams({ from, to })}`);
    entries = result.items;
    $('#work-total').textContent = mode === 'month'
      ? `Saldo: ${result.overtime_balance >= 0 ? '+' : ''}${hoursText(result.overtime_balance)}`
      : `Gesamt: ${hoursText(result.total_hours)}`;
    $('#work-kpi-hours').textContent = hoursText(result.total_hours);
    $('#work-kpi-entries').textContent = entries.length;
    $('#work-kpi-overtime').hidden = mode !== 'month';
    $('#work-kpi-pay').hidden = mode !== 'month';
    $('#work-kpi-target').textContent = hoursText(state.me.weekly_work_hours ?? 40);
    $('#work-kpi-overtime-value').textContent = mode === 'month' ? `${result.overtime_balance >= 0 ? '+' : ''}${hoursText(result.overtime_balance)}` : '–';
    $('#work-kpi-pay-value').textContent = mode === 'month' ? payText(result.total_pay) : '–';
    const generalEntries = entries.filter((item) => !item.project_id);
    const projectEntries = entries.filter((item) => item.project_id);
    const separatedEntries = `<h3>Allgemeine Arbeitszeiten</h3>${entriesTable(generalEntries)}<h3 style="margin-top:20px">Projektzeiten</h3>${entriesTable(projectEntries)}`;
    $('#work-list').innerHTML = mode === 'month'
      ? `<h3>Monatsübersicht</h3>${result.daily.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Datum</th><th>Arbeitszeit</th></tr></thead><tbody>${result.daily.map((day) => `<tr><td>${dateText(day.work_date)}</td><td><b>${hoursText(day.hours)}</b></td></tr>`).join('')}</tbody></table></div>` : empty('Keine Arbeitszeit im Monat erfasst.')}
        <p class="muted">${salaryText(result.daily_salary, result.weekly_target, result.hourly_bonus_percent)} · Stunden über dem Soll: ${hoursText(result.overtime_hours)}</p>
        <p><b>Festgehalt: ${payText(result.base_pay)} · Bonus: ${payText(result.overtime_pay)} · Gesamt: ${payText(result.total_pay)}</b></p>
        ${separatedEntries}`
      : separatedEntries;
  }
  async function loadTeamHours() {
    if (!teams.length) return;
    const report = await api.get(`/work-hours/team/monthly?${new URLSearchParams({ team_id: $('#work-team').value, month: $('#team-work-month').value })}`);
    teamEntries.clear();
    $('#team-work-report').innerHTML = report.members.length ? report.members.map((member) => {
      const general = member.items.filter((item) => !item.project_id);
      const project = member.items.filter((item) => item.project_id);
      for (const item of member.items) teamEntries.set(item.id, item);
      return `<div class="card"><div class="card-head"><div class="grow"><h3>${esc(member.name)}</h3>
        <small>Gesamt ${hoursText(member.total_hours)} · Über dem Soll ${hoursText(member.overtime_hours)} · Vergütung ${payText(member.total_pay, member.currency)}</small></div>
        <button class="btn ghost sm" data-team-settings="${member.user_id}">Mitarbeitereinstellungen</button></div>
        <p class="muted">${salaryText(member.daily_salary, member.weekly_target, member.hourly_bonus_percent, member.currency)}</p>
        <h4>Allgemeine Arbeitszeiten</h4>${entriesTable(general)}<h4 style="margin-top:16px">Projektzeiten</h4>${entriesTable(project)}</div>`;
    }).join('') : empty('Keine aktiven Teammitglieder gefunden.');
  }
  async function employeeSettingsForm(userId) {
    const member = (await api.get(`/work-hours/team/monthly?${new URLSearchParams({ team_id: $('#work-team').value, month: $('#team-work-month').value })}`)).members.find((item) => item.user_id === userId);
    if (!member) return toast('Mitarbeiter nicht gefunden.', true);
    return openForm({
      title: `Einstellungen: ${member.name}`,
      fields: [
        { type: 'html', html: '<small class="muted">Diese Einstellungen gelten für den Mitarbeiter global in allen Teams. Das Konto für die Gehaltsgutschrift wählt jeder Mitarbeiter selbst unter „Gehalt einstellen“.</small>' },
        ...salaryFields({ daily_salary: member.daily_salary, weekly_work_hours: member.weekly_target, hourly_bonus_percent: member.hourly_bonus_percent }, member.currency),
      ],
      onSubmit: async (values) => api.patch(`/work-hours/team/${$('#work-team').value}/members/${userId}/settings`, salaryBody(values)),
    });
  }
  async function projectForm() {
    return openForm({
      title: 'Projekt / Kunde anlegen',
      fields: [
        { name: 'name', label: 'Name', required: true, full: true },
        { name: 'team_id', label: 'Sichtbarkeit', type: 'select', options: [{ v: '', l: 'Privat' }, ...teams.map((team) => ({ v: team.id, l: `Team: ${team.name}` }))], value: '' },
      ],
      onSubmit: async (v) => api.post('/work-projects', { name: v.name.trim(), team_id: v.team_id || null }),
    });
  }

  view.addEventListener('change', (event) => {
    if (event.target.matches('#work-mode, #work-date')) load().catch((error) => toast(error.message, true));
    if (event.target.matches('#work-team, #team-work-month')) loadTeamHours().catch((error) => toast(error.message, true));
  });
  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    try {
      if (target.id === 'work-new') {
        if (await entryForm(null, projects)) await load();
      } else if (target.id === 'pay-settings') {
        if (await payForm()) { await loadPay(); await load(); }
      } else if (target.id === 'project-new') {
        if (await projectForm()) { await loadProjects(); await load(); }
      } else if (target.id === 'work-export') {
        const [from, to] = range($('#work-mode').value, $('#work-date').value);
        await api.download(`/work-hours/export.csv?${new URLSearchParams({ from, to })}`, 'arbeitszeiten.csv');
      } else if (target.id === 'work-pdf') {
        await api.download(`/work-hours/monthly.pdf?${new URLSearchParams({ month: $('#work-date').value.slice(0, 7) })}`, `stundenzettel-${$('#work-date').value.slice(0, 7)}.pdf`);
      } else if (target.id === 'timer-start') {
        await api.post('/work-hours/timer/start', { project_id: $('#timer-project').value || null, note: $('#timer-note').value });
        await loadTimer();
      } else if (target.id === 'timer-pause') {
        await api.post(`/work-hours/timer/${timer.paused_at ? 'resume' : 'pause'}`);
        await loadTimer();
      } else if (target.id === 'timer-stop') {
        const result = await api.post('/work-hours/timer/stop');
        if (result?.entries > 1) toast(`Über Mitternacht: ${result.entries} Einträge, einer je Kalendertag`);
        await loadTimer();
        await load();
        await loadTeamHours();
      } else if (target.id === 'timer-discard' && await confirmBox('Timer verwerfen', 'Der Timer wird beendet, ohne einen Eintrag anzulegen. Erfasse die Zeit danach bei Bedarf manuell.', 'Verwerfen')) {
        await api.del('/work-hours/timer');
        await loadTimer();
      } else if (target.dataset.edit) {
        const entry = entries.find((item) => item.id === target.dataset.edit) || teamEntries.get(target.dataset.edit);
        if (entry && await entryForm(entry, projects)) {
          await load();
          await loadTeamHours();
        }
      } else if (target.dataset.del && await confirmBox('Stundeneintrag löschen', 'Diesen Eintrag wirklich löschen?')) {
        await api.del(`/work-hours/${target.dataset.del}`);
        await load();
        await loadTeamHours();
      } else if (target.dataset.teamSettings) {
        if (await employeeSettingsForm(target.dataset.teamSettings)) await loadTeamHours();
      } else if (target.dataset.projectToggle) {
        const project = projects.find((item) => item.id === target.dataset.projectToggle);
        await api.patch(`/work-projects/${project.id}`, { active: !project.active });
        await loadProjects();
      } else if (target.dataset.projectDelete && await confirmBox('Projekt löschen', 'Das Projekt wird entfernt; erfasste Stunden bleiben ohne Projektzuordnung erhalten.')) {
        await api.del(`/work-projects/${target.dataset.projectDelete}`);
        await loadProjects();
        await load();
      }
    } catch (error) {
      toast(error.message, true);
    }
  });
  await Promise.all([loadProjects(), loadTimer(), load(), loadTeamHours(), loadPay()]);
  const tick = setInterval(() => {
    if (!view.isConnected) clearInterval(tick);
    else if (timer && !timer.paused_at) drawTimer();
  }, 1000);
}
