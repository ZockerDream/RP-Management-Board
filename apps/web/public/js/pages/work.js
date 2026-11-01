import { api } from '../api.js';
import { $, esc, empty, openForm, confirmBox, toast, todayStr } from '../ui.js';

const hoursText = (hours) => `${Number(hours).toLocaleString('de-DE', { maximumFractionDigits: 2 })} Std.`;
const dateText = (date) => String(date).slice(0, 10).split('-').reverse().join('.');

async function entryForm(entry) {
  return openForm({
    title: entry ? 'Stundeneintrag bearbeiten' : 'Stunden erfassen',
    fields: [
      { name: 'work_date', label: 'Datum', type: 'date', value: entry?.work_date?.slice(0, 10) || todayStr(), required: true },
      { name: 'hours', label: 'Arbeitsstunden', type: 'number', min: 0.01, max: 24, step: 0.25, value: entry?.hours || '', required: true },
      { name: 'note', label: 'Notiz (optional)', type: 'textarea', value: entry?.note || '', full: true },
    ],
    onSubmit: async (v) => {
      const body = { work_date: v.work_date, hours: Number(v.hours), note: v.note };
      if (entry) await api.patch(`/work-hours/${entry.id}`, body);
      else await api.post('/work-hours', body);
    },
  });
}

export async function render(view) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('sv-SE');
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('sv-SE');
  let entries = [];
  view.innerHTML = `<div class="page-head"><div><h1>Stundenerfassung</h1><p>Arbeitszeit getrennt von Gehaltsbuchungen erfassen</p></div>
    <button class="btn" id="work-new">Stunden erfassen</button></div>
    <div class="card"><div class="toolbar" style="gap:8px;flex-wrap:wrap"><label class="field">Von<input id="work-from" type="date" value="${from}"></label>
    <label class="field">Bis<input id="work-to" type="date" value="${to}"></label><b id="work-total" class="up"></b></div>
    <div id="work-list"></div></div>`;

  async function load() {
    const params = new URLSearchParams(Object.entries({ from: $('#work-from').value, to: $('#work-to').value }).filter(([, value]) => value));
    const result = await api.get(`/work-hours?${params}`);
    entries = result.items;
    $('#work-total').textContent = `Gesamt: ${hoursText(result.total_hours)}`;
    $('#work-list').innerHTML = entries.length ? `<div class="scroll-x"><table class="table"><thead><tr><th>Datum</th><th>Stunden</th><th>Notiz</th><th></th></tr></thead><tbody>${entries.map((item) => `<tr>
      <td>${dateText(item.work_date)}</td><td><b>${hoursText(item.hours)}</b></td><td>${esc(item.note || '–')}</td>
      <td style="white-space:nowrap"><button class="btn ghost sm" data-edit="${item.id}">Bearbeiten</button> <button class="btn ghost sm" data-del="${item.id}">Löschen</button></td></tr>`).join('')}</tbody></table></div>` : empty('Keine Stunden im gewählten Zeitraum erfasst.');
  }

  view.addEventListener('change', (event) => {
    if (event.target.matches('#work-from, #work-to')) load().catch((error) => toast(error.message, true));
  });
  view.addEventListener('click', async (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    try {
      if (target.id === 'work-new') {
        if (await entryForm()) await load();
      } else if (target.dataset.edit) {
        if (await entryForm(entries.find((item) => item.id === target.dataset.edit))) await load();
      } else if (target.dataset.del && await confirmBox('Stundeneintrag löschen', 'Diesen Eintrag wirklich löschen?')) {
        await api.del(`/work-hours/${target.dataset.del}`);
        await load();
      }
    } catch (error) {
      toast(error.message, true);
    }
  });
  await load();
}
