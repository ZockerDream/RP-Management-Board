import { api } from '../api.js';
import { esc, empty, fdatetime, toast } from '../ui.js';

export async function render(view) {
  view.innerHTML = `<div class="page-head"><div><h1>Fehler melden</h1><p id="bug-report-hint"></p></div></div>
    <div class="card">
      <form id="bug-report-form">
        <div class="form">
          <label class="field full">Kurzer Titel<input name="title" required minlength="5" maxlength="120"></label>
          <label class="field full">Was ist passiert?<textarea name="description" rows="4" required minlength="20" maxlength="10000"></textarea></label>
          <label class="field full">Reproduktionsschritte (optional)<textarea name="steps" rows="3" maxlength="5000"></textarea></label>
        </div>
        <div class="modal-foot"><button class="btn" type="submit">Ticket erstellen</button></div>
      </form>
    </div>
    <div class="card" style="margin-top:18px"><div class="card-head"><h2>Meine Tickets</h2></div><div id="bug-report-list"></div></div>`;

  const form = view.querySelector('#bug-report-form');
  const list = view.querySelector('#bug-report-list');
  const refresh = async () => {
    const data = await api.get('/bug-reports');
    view.querySelector('#bug-report-hint').textContent = data.github_enabled
      ? 'Dein Bericht wird als Ticket gespeichert und zusätzlich als GitHub-Issue für das Projektteam angelegt.'
      : 'Dein Bericht wird als internes Ticket gespeichert. GitHub ist nicht konfiguriert.';
    list.innerHTML = data.items.length ? data.items.map((ticket) => `<div class="list-item">
      <div class="grow">
        <b>#${ticket.id} · ${esc(ticket.title)}</b>
        <small>${fdatetime(ticket.created_at)}</small>
        <p style="white-space:pre-wrap;margin-top:8px">${esc(ticket.description)}</p>
        ${ticket.steps ? `<small style="white-space:pre-wrap;display:block;margin-top:6px">Schritte: ${esc(ticket.steps)}</small>` : ''}
        ${ticket.github_url ? `<small><a href="${esc(ticket.github_url)}" target="_blank" rel="noopener noreferrer">GitHub-Issue #${ticket.github_issue_number}</a></small>` : ''}
        ${ticket.github_sync_error ? `<small class="auth-error" style="display:block">GitHub-Synchronisierung fehlgeschlagen: ${esc(ticket.github_sync_error)}</small>` : ''}
      </div>
    </div>`).join('') : empty('Noch keine Tickets gemeldet.');
  };
  await refresh();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const fields = new FormData(form);
      const ticket = await api.post('/bug-reports', {
        title: fields.get('title').trim(),
        description: fields.get('description').trim(),
        steps: fields.get('steps').trim(),
      });
      form.reset();
      await refresh();
      if (ticket.github_sync_error) toast(`Ticket #${ticket.id} erstellt; ${ticket.github_sync_error}`, true);
      else if (ticket.github_issue_number) toast(`Ticket #${ticket.id} erstellt und an GitHub übertragen`);
      else toast(`Ticket #${ticket.id} erstellt`);
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}
