import { api } from '../api.js';
import { esc, empty } from '../ui.js';

export async function render(view) {
  const info = await api.get('/public/imprint');
  const rows = [
    ['Angaben gemäß § 5 DDG', info.name],
    ['Vertreten durch', info.representative],
    ['Anschrift', [info.street, [info.postalCode, info.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
    ['Kontakt', info.email ? `<a href="mailto:${esc(info.email)}">${esc(info.email)}</a>` : ''],
    ['Telefon', info.phone],
    ['Registereintrag', info.register],
    ['Umsatzsteuer-ID', info.vatId],
    ['Verantwortlich für den Inhalt', info.responsible],
  ].filter(([, value]) => value);
  view.innerHTML = `<section class="auth-card"><div class="auth-brand"><span>Budget Manager</span></div><h1>Impressum</h1>
    ${rows.length ? rows.map(([label, value]) => `<p><b>${esc(label)}</b><br>${label === 'Kontakt' ? value : esc(value)}</p>`).join('') : empty('Impressumsangaben sind noch nicht konfiguriert.')}
    <p class="auth-lead" style="margin-top:16px"><a href="#/login">Zurück</a></p></section>`;
}
