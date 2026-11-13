// Blitzer (Wünsche des Auftraggebers vom 2026-11-13): systemweit, Rechte über die Rollenrechte speedcam:*.
// Standorte fester und mobiler Blitzer mit je einem Bild. Rechnungen gibt es nicht mehr.
import { api } from '../api.js';
import { $, esc, empty, tag, openForm, confirmBox, toast, debounce } from '../ui.js';
import { can } from '../app.js';
import { imageSrc, forgetImage } from '../gallery.js';

const KIND = { fixed: 'Fest', mobile: 'Mobil' };
const photoUrl = (id) => `/speed-cameras/${id}/photo`;

// Formular mit optionalem Bild; das Bild geht nach dem Speichern als eigene Anfrage hoch
const cameraForm = (camera) => openForm({
  title: camera ? 'Standort bearbeiten' : 'Neuer Blitzer-Standort',
  fields: [
    { name: 'name', label: 'Name', value: camera?.name, required: true, maxlength: 100, placeholder: 'z. B. Highway Nord' },
    { name: 'kind', label: 'Art', type: 'select', options: Object.entries(KIND).map(([v, l]) => ({ v, l })), value: camera?.kind || 'fixed' },
    { name: 'location', label: 'Ort', value: camera?.location, maxlength: 200, full: true, placeholder: 'Straße, Kreuzung, Postleitzahl…' },
    { name: 'speed_limit', label: 'Erlaubt (km/h)', type: 'number', min: 1, max: 400, step: 1, value: camera?.speed_limit ?? 50, required: true },
    { name: 'active', label: 'Aktiv', type: 'checkbox', value: camera ? camera.active : true },
    { name: 'photo', label: camera?.has_photo ? 'Neues Bild (PNG oder JPEG, ersetzt das alte)' : 'Bild (PNG oder JPEG, optional)', type: 'file', accept: 'image/png,image/jpeg', full: true },
    ...(camera?.has_photo ? [{ name: 'remove_photo', label: 'Bild entfernen', type: 'checkbox', value: false }] : []),
    { name: 'note', label: 'Notiz', type: 'textarea', value: camera?.note, maxlength: 2000, full: true },
  ],
  onSubmit: async (v, modal) => {
    const body = { name: v.name.trim(), kind: v.kind, location: v.location.trim(), speed_limit: Number(v.speed_limit), active: v.active, note: v.note };
    const id = camera ? camera.id : (await api.post('/speed-cameras', body)).id;
    if (camera) await api.patch(`/speed-cameras/${id}`, body);
    const file = $('[name=photo]', modal).files[0];
    try {
      if (file) {
        const form = new FormData();
        form.append('file', file);
        await api.post(`/speed-cameras/${id}/photo`, form);
        forgetImage(photoUrl(id));
      } else if (v.remove_photo) {
        await api.del(`/speed-cameras/${id}/photo`);
        forgetImage(photoUrl(id));
      }
    } catch (error) {
      // Standort ist gespeichert; nur das Bild fehlt
      toast(`Standort gespeichert, Bild nicht: ${error.message}`, true);
      return;
    }
    toast('Standort gespeichert');
  },
});

export async function render(view) {
  let cameras = [];
  const filter = { q: '', state: 'active' };
  view.innerHTML = `<div class="page-head"><div><h1>Blitzer</h1><p>Standorte fester und mobiler Blitzer mit Bild</p></div>
    <div class="actions">${can('speedcam:create') ? '<button class="btn" id="sc-cam-new">Neuer Standort</button>' : ''}</div></div>
    <div class="toolbar" style="gap:8px;flex-wrap:wrap"><input id="sc-q" type="search" class="search" placeholder="Name, Ort oder Notiz…" aria-label="Standorte durchsuchen">
      <div class="seg" id="sc-state"><button data-s="active" class="on">Aktiv</button><button data-s="off">Abgeschaltet</button><button data-s="all">Alle</button></div></div>
    <div id="sc-cams"></div>`;

  const shown = () => cameras.filter((c) => (filter.state === 'all' || (filter.state === 'active') === c.active)
    && (!filter.q || `${c.name} ${c.location} ${c.note}`.toLowerCase().includes(filter.q)));

  function draw() {
    const list = shown();
    $('#sc-cams', view).innerHTML = list.length ? `<div class="cam-grid">${list.map((c) => `<article class="card cam-card">
      ${c.has_photo ? `<button type="button" class="cam-photo" data-photo="${c.id}" aria-label="Bild von ${esc(c.name)} groß anzeigen"><span class="muted">Lädt…</span></button>` : '<div class="cam-photo empty"><span class="muted">Kein Bild</span></div>'}
      <div class="cam-body"><div class="row" style="align-items:flex-start"><div class="grow" style="min-width:0"><b>${esc(c.name)}</b>${c.location ? `<br><small class="muted">${esc(c.location)}</small>` : ''}</div>
        <span class="cam-limit" title="Erlaubt">${c.speed_limit}</span></div>
        <div class="row start" style="gap:6px;margin-top:8px;flex-wrap:wrap">${tag('', KIND[c.kind])}${c.active ? tag('ok', 'Aktiv') : tag('', 'Abgeschaltet')}</div>
        ${c.note ? `<p class="muted" style="margin:8px 0 0;white-space:pre-line">${esc(c.note)}</p>` : ''}
        ${can('speedcam:update') || can('speedcam:delete') ? `<div class="row start" style="gap:6px;margin-top:12px;flex-wrap:wrap">${can('speedcam:update') ? `<button class="btn ghost sm" data-cam-edit="${c.id}">Bearbeiten</button>` : ''}${can('speedcam:delete') ? `<button class="btn ghost sm" data-cam-del="${c.id}">Löschen</button>` : ''}</div>` : ''}</div>
    </article>`).join('')}</div>`
      : empty(cameras.length ? 'Keine passenden Standorte.' : 'Noch keine Standorte. Lege den ersten an, z. B. „Highway Nord, 120 km/h“, mit einem Bild der Stelle.');
    // Bilder brauchen die Anmeldung: als data:-URL nachladen
    list.filter((c) => c.has_photo).forEach((c) => imageSrc(photoUrl(c.id)).then((src) => {
      const b = $(`[data-photo="${c.id}"]`, view);
      if (b) b.innerHTML = `<img src="${src}" alt="Bild von ${esc(c.name)}" decoding="async">`;
    }).catch(() => {
      const b = $(`[data-photo="${c.id}"]`, view);
      if (b) b.innerHTML = '<span class="muted">Nicht verfügbar</span>';
    }));
  }
  async function load() {
    cameras = await api.get('/speed-cameras');
    draw();
  }

  view.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.closest('#sc-state') && b.dataset.s) {
        filter.state = b.dataset.s;
        $('#sc-state', view).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        draw();
        return;
      }
      const camera = (k) => cameras.find((c) => c.id === b.dataset[k]);
      if (b.dataset.photo) {
        const c = camera('photo');
        const src = await imageSrc(photoUrl(c.id));
        await openForm({ title: c.name, wide: true, submit: 'Schließen', fields: [{ type: 'html', html: `<img class="lightbox-img" src="${src}" alt="Bild von ${esc(c.name)}">${c.location ? `<small class="muted">${esc(c.location)}</small>` : ''}` }], onSubmit: async () => true });
        return;
      }
      let changed = false;
      if (b.id === 'sc-cam-new') changed = await cameraForm(null);
      else if (b.dataset.camEdit) changed = await cameraForm(camera('camEdit'));
      else if (b.dataset.camDel) {
        const c = camera('camDel');
        if (await confirmBox('Standort löschen', `„${c.name}“ wird samt Bild gelöscht.`)) { await api.del(`/speed-cameras/${c.id}`); forgetImage(photoUrl(c.id)); changed = true; }
      }
      if (changed) await load();
    } catch (error) {
      toast(error.message, true);
    }
  });
  $('#sc-q', view).addEventListener('input', debounce((e) => { filter.q = e.target.value.trim().toLowerCase(); draw(); }, 200));
  await load();
}
