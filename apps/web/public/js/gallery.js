// Bilder zu Fahrzeugen und Akten: Raster mit Vorschau, Großansicht, Bildunterschrift, Hochladen und Löschen.
// Bilder kommen mit Anmeldung per api.blob und werden als data:-URL gezeigt (img src hätte kein Token, die CSP erlaubt kein blob:).
import { api } from './api.js';
import { $, esc, fdatetime, empty, openForm, confirmBox, toast } from './ui.js';

const cache = new Map();
const MAX_CACHE = 60;

export async function imageSrc(url) {
  if (cache.has(url)) return cache.get(url);
  const blob = await api.blob(url);
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(url, src);
  return src;
}
export const forgetImage = (url) => cache.delete(url);

export const isImage = (item) => ['image/png', 'image/jpeg'].includes(item.mime);

// Raster; Knöpfe tragen data-img-open|caption|download|del mit der Bild-ID
export function galleryHtml(images, { writable = false, none = 'Noch keine Bilder.' } = {}) {
  if (!images.length) return empty(none);
  return `<div class="gallery">${images.map((image) => `<figure class="gallery-item">
    <button type="button" class="gallery-thumb" data-img-open="${image.id}" aria-label="Bild ${esc(image.caption || image.original_name)} groß anzeigen"><span class="muted">Lädt…</span></button>
    <figcaption>${image.caption ? `<b>${esc(image.caption)}</b>` : ''}<small class="muted">${fdatetime(image.created_at)}${image.uploaded_by_name ? ` · ${esc(image.uploaded_by_name)}` : ''}</small></figcaption>
    <div class="row wrap no-print"><button type="button" class="btn ghost sm" data-img-download="${image.id}">Herunterladen</button>${writable ? `<button type="button" class="btn ghost sm" data-img-caption="${image.id}">Beschriften</button><button type="button" class="btn ghost sm" data-img-del="${image.id}">Löschen</button>` : ''}</div>
  </figure>`).join('')}</div>`;
}

// Vorschaubilder erst laden, wenn sie in die Nähe des sichtbaren Bereichs kommen (bis zu 50 Bilder je Fahrzeug oder
// Akte, jedes in voller Größe). Ohne IntersectionObserver lädt alles sofort.
export function fillGallery(root, images, urlOf) {
  const load = (image) => imageSrc(urlOf(image.id)).then((src) => {
    const button = root.querySelector(`[data-img-open="${image.id}"]`);
    if (button) button.innerHTML = `<img src="${src}" alt="${esc(image.caption || image.original_name)}" decoding="async">`;
  }).catch(() => {
    const button = root.querySelector(`[data-img-open="${image.id}"]`);
    if (button) button.innerHTML = '<span class="muted">Nicht verfügbar</span>';
  });
  if (typeof IntersectionObserver !== 'function') { images.forEach(load); return; }
  const byId = new Map(images.map((image) => [image.id, image]));
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const image = byId.get(entry.target.dataset.imgOpen);
      if (image) load(image);
    }
  }, { rootMargin: '300px 0px' });
  for (const image of images) {
    const button = root.querySelector(`[data-img-open="${image.id}"]`);
    if (button) observer.observe(button); else load(image);
  }
}

export async function showImage(image, url) {
  const src = await imageSrc(url);
  return openForm({
    title: image.caption || image.original_name, wide: true, submit: 'Schließen',
    fields: [{ type: 'html', html: `<img class="lightbox-img" src="${src}" alt="${esc(image.caption || image.original_name)}"><small class="muted">${esc(image.original_name)} · ${fdatetime(image.created_at)}</small>` }],
    onSubmit: async () => true,
  });
}

export function uploadImageForm(title, url) {
  return openForm({
    title,
    fields: [
      { name: 'file', label: 'Bild (PNG oder JPEG)', type: 'file', accept: 'image/png,image/jpeg', required: true, full: true },
      { name: 'caption', label: 'Bildunterschrift (optional)', maxlength: 200, full: true },
    ],
    submit: 'Hochladen',
    onSubmit: async (values, modal) => {
      const file = $('#f-file', modal).files[0];
      if (!file) throw new Error('Bitte ein Bild auswählen');
      const form = new FormData();
      // Die Bildunterschrift muss vor der Datei stehen, damit der Server sie mitliest
      form.append('caption', values.caption.trim());
      form.append('file', file);
      await api.post(url, form);
      toast('Bild gespeichert');
    },
  });
}

export const captionForm = (image, url) => openForm({
  title: 'Bildunterschrift',
  fields: [{ name: 'caption', label: 'Bildunterschrift', value: image.caption, maxlength: 200, full: true }],
  onSubmit: (values) => api.patch(url, { caption: values.caption.trim() }),
});

// Klicks im Raster; liefert true, wenn sich etwas geändert hat. urls: file(id), item(id) für PATCH/DELETE
export async function galleryAction(target, images, urls) {
  const d = target.dataset;
  const find = (imageId) => images.find((image) => image.id === imageId);
  if (d.imgOpen) { await showImage(find(d.imgOpen), urls.file(d.imgOpen)); return false; }
  if (d.imgDownload) { const image = find(d.imgDownload); await api.download(urls.file(image.id), image.original_name); return false; }
  if (d.imgCaption) return Boolean(await captionForm(find(d.imgCaption), urls.item(d.imgCaption)));
  if (d.imgDel && await confirmBox('Bild löschen', 'Das Bild wird endgültig gelöscht.')) {
    await api.del(urls.item(d.imgDel));
    forgetImage(urls.file(d.imgDel));
    return true;
  }
  return false;
}

// Eigenes Fenster mit allen Bildern eines Fahrzeugs; löst beim Schließen auf, ob sich etwas geändert hat
export function openGalleryModal({ title, listUrl, uploadUrl, urls, writable }) {
  return new Promise((resolve) => {
    let images = [];
    let changed = false;
    const modal = document.createElement('div');
    modal.className = 'modal open';
    modal.innerHTML = `<div class="card" style="width:820px"><div class="card-head"><h2>${esc(title)}</h2>${writable ? '<button type="button" class="btn sm" data-img-add>Bild hochladen</button>' : ''}</div>
      <div data-gallery><p class="muted">Lädt…</p></div><div class="modal-foot"><button type="button" class="btn ghost" data-x>Schließen</button></div></div>`;
    $('#modals').append(modal);
    const close = () => { modal.remove(); resolve(changed); };
    const draw = async () => {
      images = await api.get(listUrl);
      const box = $('[data-gallery]', modal);
      box.innerHTML = galleryHtml(images, { writable, none: writable ? 'Noch keine Bilder. Lade das erste hoch.' : 'Noch keine Bilder.' });
      fillGallery(box, images, (imageId) => urls.file(imageId));
    };
    modal.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal === $('#modals .modal:last-child')) close(); });
    modal.addEventListener('click', async (event) => {
      if (event.target === modal || event.target.closest('[data-x]')) { close(); return; }
      const target = event.target.closest('button');
      if (!target) return;
      try {
        if (target.matches('[data-img-add]')) {
          if (await uploadImageForm(`Bild hochladen · ${title}`, uploadUrl)) { changed = true; await draw(); }
        } else if (await galleryAction(target, images, urls)) { changed = true; await draw(); }
      } catch (error) {
        toast(error.message, true);
      }
    });
    draw().catch((error) => { $('[data-gallery]', modal).innerHTML = `<p class="auth-error">${esc(error.message)}</p>`; });
  });
}
