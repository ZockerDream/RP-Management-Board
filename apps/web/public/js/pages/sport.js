import { api } from '../api.js';
import { $, esc, empty, openForm, confirmBox, toast, todayStr, fdate } from '../ui.js';

const SPORTS = {
  run: { label: 'Laufen', title: 'Laufstrecke' },
  swim: { label: 'Schwimmen', title: 'Schwimmstrecke' },
  bike: { label: 'Biken', title: 'Bike-Strecke' },
};
const num = (value) => Number(value).toLocaleString('de-DE', { maximumFractionDigits: 2 });
const duration = (seconds) => {
  if (seconds == null) return '–';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
};
const parseDuration = (text) => {
  const value = String(text || '').trim();
  if (!value) return null;
  const parts = value.split(':').map(Number);
  if (parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) throw new Error('Dauer im Format mm:ss oder h:mm:ss angeben');
  return parts.reduce((total, part) => total * 60 + part, 0);
};
const optionalInt = (value) => (String(value).trim() === '' ? null : Number(value));

export async function render(view, sportType = 'run') {
  const sport = SPORTS[sportType];
  let routes = [], teams = [];
  view.innerHTML = `<div class="page-head"><div><h1>${sport.label}</h1><p>Strecken deines Teams und gemeinsame Bestenliste</p></div>
    <div class="actions"><button class="btn" id="route-new">Strecke anlegen</button></div></div><div id="sport-body"></div>`;

  async function load() {
    [routes, teams] = await Promise.all([api.get(`/sport/routes?sport_type=${sportType}`), api.get('/teams').catch(() => [])]);
    teams = teams.filter((team) => team.role !== 'viewer');
    $('#route-new').hidden = !teams.length;
    $('#sport-body').innerHTML = routes.length ? routes.map((route) => {
      const manage = route.role !== 'viewer';
      return `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>${esc(route.name)}</h2>
        <div class="row"><button class="btn sm" data-score-new="${route.id}">Ergebnis eintragen</button>${manage ? `<button class="btn ghost sm" data-route-edit="${route.id}">Bearbeiten</button><button class="btn ghost sm" data-route-del="${route.id}">Löschen</button>` : ''}</div></div>
        <div class="chips"><span class="chip">Team: ${esc(route.team_name)}</span><span class="chip">${route.checkpoints} Checkpoints</span>${route.distance_km != null ? `<span class="chip">${num(route.distance_km)} km</span>` : ''}<span class="chip">${route.attempts} Versuche</span><span class="chip">${route.participants} Teilnehmer</span>${route.best_score != null ? `<span class="chip">Bestwert ${num(route.best_score)}</span>` : ''}</div>
        ${route.notes ? `<p class="muted" style="white-space:pre-wrap">${esc(route.notes)}</p>` : ''}
        ${route.scores.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>#</th><th>Name</th><th>Punkte</th><th>Zeit</th><th>Checkpoints</th><th>Datum</th><th>Notiz</th><th></th></tr></thead><tbody>${route.scores.map((score, index) => `<tr><td>${index + 1}</td><td><b>${esc(score.user_name)}</b></td><td>${num(score.score)}</td><td>${duration(score.duration_seconds)}</td><td>${score.checkpoints_reached ?? "–"}</td><td>${fdate(score.achieved_on)}</td><td>${esc(score.note)}</td><td><button class="link" data-score-del="${score.id}">Löschen</button></td></tr>`).join('')}</tbody></table></div>` : empty('Noch keine Ergebnisse.')}</div>`;
    }).join('') : `<div class="card">${empty(`Noch keine Strecken für ${sport.label}. Teameditoren können Strecken anlegen.`)}</div>`;
  }

  const routeForm = (route) => openForm({
    title: route ? `${sport.title} bearbeiten` : `${sport.title} anlegen`,
    fields: [
      { name: 'name', label: 'Name', value: route?.name, required: true, full: true },
      ...(route ? [] : [{ name: 'team_id', label: 'Team', type: 'select', options: teams.map((team) => ({ v: team.id, l: team.name })), value: teams[0]?.id }]),
      { name: 'checkpoints', label: 'Checkpoints', type: 'number', min: 0, step: 1, value: route?.checkpoints ?? 0, required: true },
      { name: 'distance_km', label: 'Distanz (km, optional)', type: 'number', min: 0, step: 0.01, value: route?.distance_km ?? '' },
      { name: 'notes', label: 'Notizen', type: 'textarea', value: route?.notes || '', full: true },
    ],
    onSubmit: async (v) => {
      const body = { name: v.name.trim(), checkpoints: Number(v.checkpoints), distance_km: v.distance_km === '' ? null : Number(v.distance_km), notes: v.notes };
      if (route) await api.patch(`/sport/routes/${route.id}`, body);
      else await api.post('/sport/routes', { ...body, team_id: v.team_id, sport_type: sportType });
    },
  });

  const scoreForm = (route) => openForm({
    title: `Ergebnis · ${route.name}`,
    fields: [
      { name: 'score', label: 'Punkte', type: 'number', min: 0, step: 0.01, required: true },
      { name: 'duration', label: 'Zeit (mm:ss, optional)', placeholder: '12:34' },
      { name: 'checkpoints_reached', label: `Erreichte Checkpoints (max. ${route.checkpoints})`, type: 'number', min: 0, step: 1 },
      { name: 'achieved_on', label: 'Datum', type: 'date', value: todayStr(), required: true },
      { name: 'note', label: 'Notiz', full: true },
    ],
    onSubmit: (v) => api.post(`/sport/routes/${route.id}/scores`, {
      score: Number(v.score), duration_seconds: parseDuration(v.duration), checkpoints_reached: optionalInt(v.checkpoints_reached), achieved_on: v.achieved_on, note: v.note,
    }),
  });

  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const route = (key) => routes.find((item) => item.id === target.dataset[key]);
    try {
      if (target.id === 'route-new') { if (await routeForm()) await load(); }
      else if (target.dataset.routeEdit) { if (await routeForm(route('routeEdit'))) await load(); }
      else if (target.dataset.scoreNew) { if (await scoreForm(route('scoreNew'))) await load(); }
      else if (target.dataset.routeDel && await confirmBox('Strecke löschen', 'Die Strecke samt allen Ergebnissen wird gelöscht.')) {
        await api.del(`/sport/routes/${target.dataset.routeDel}`);
        await load();
      } else if (target.dataset.scoreDel && await confirmBox('Ergebnis löschen', 'Dieses Ergebnis wirklich löschen?')) {
        await api.del(`/sport/scores/${target.dataset.scoreDel}`);
        await load();
      }
    } catch (error) { toast(error.message, true); }
  });
  await load();
}
