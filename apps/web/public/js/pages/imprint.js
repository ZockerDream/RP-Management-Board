import { api } from '../api.js';
import { esc } from '../ui.js';
import { state } from '../app.js';

export const legalHead = (active) => {
  const loggedIn = !!document.querySelector('.app:not(.hidden)');
  return `<div class="legal-head"><div class="auth-brand"><span data-app-name>${esc(state.appName)}</span></div>
    <nav class="legal-tabs"><a href="#/impressum" class="${active === 'impressum' ? 'on' : ''}">Impressum</a><a href="#/datenschutz" class="${active === 'datenschutz' ? 'on' : ''}">Datenschutz</a><a href="#/${loggedIn ? 'dashboard' : 'login'}">Zurück</a></nav></div>`;
};

const multi = (text) => esc(text).replace(/\\n|\n/g, '<br>');

export async function render(view) {
  const i = await api.get('/public/imprint');
  const site = /^https?:\/\//i.test(i.website || '') ? i.website : i.website ? `https://${i.website}` : '';
  const address = [i.street, [i.postalCode, i.city].filter(Boolean).join(' '), i.country].filter(Boolean).map(esc).join('<br>');
  const contact = [
    i.phone && ['Telefon', esc(i.phone)],
    i.email && ['E-Mail', `<a href="mailto:${esc(i.email)}">${esc(i.email)}</a>`],
    site && ['Web', `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(i.website)}</a>`],
  ].filter(Boolean);
  const cards = [
    (i.name || address) && `<div class="legal-card"><h2>Anbieter (§ 5 DDG)</h2>${i.name ? `<p class="big">${esc(i.name)}</p>` : ''}${address ? `<p>${address}</p>` : ''}${i.representative ? `<p>Vertreten durch: ${esc(i.representative)}</p>` : ''}</div>`,
    contact.length && `<div class="legal-card"><h2>Kontakt</h2><dl>${contact.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`,
    (i.register || i.vatId) && `<div class="legal-card"><h2>Register &amp; Steuer</h2><dl>${i.register ? `<dt>Register</dt><dd>${multi(i.register)}</dd>` : ''}${i.vatId ? `<dt>USt-IdNr.</dt><dd>${esc(i.vatId)}</dd>` : ''}</dl></div>`,
    i.responsible && `<div class="legal-card"><h2>Inhaltlich verantwortlich</h2><p>${multi(i.responsible)}</p></div>`,
    i.supervisory && `<div class="legal-card"><h2>Aufsichtsbehörde</h2><p>${multi(i.supervisory)}</p></div>`,
    i.note && `<div class="legal-card wide"><h2>Hinweis</h2><p>${multi(i.note)}</p></div>`,
  ].filter(Boolean);
  view.innerHTML = `<section class="legal">${legalHead('impressum')}<h1>Impressum</h1><p class="legal-lead">Angaben zum Betreiber dieser Anwendung.</p>
    ${cards.length ? `<div class="legal-grid">${cards.join('')}</div>` : '<div class="legal-card"><p>Die Impressumsangaben sind noch nicht konfiguriert (Datei <code>.env-impressum</code>).</p></div>'}</section>`;
}
