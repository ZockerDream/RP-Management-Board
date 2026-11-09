import { api } from '../api.js';
import { esc, fdatetime, confirmBox, toast } from '../ui.js';
import { state } from '../app.js';
import { markdownBlock } from '../markdown.js';

const commentHtml = (ticket, comment, admin) => `<div class="ticket-comment">
  <div class="row"><small><b>${esc(comment.user_name)}</b> · ${fdatetime(comment.created_at)}</small>
  ${admin || comment.user_id === state.me.id ? `<button type="button" class="link" data-comment-del="${esc(comment.id)}" data-ticket="${esc(ticket.id)}">Löschen</button>` : ''}</div>
  ${markdownBlock(comment.body)}</div>`;

// Gemeinsame Darstellung für „Tickets“ (Admin) und „Fehler melden“ (eigene Tickets)
export const ticketHtml = (ticket, admin = false) => `<div class="list-item ticket">
  <div class="grow">
    <b>#${esc(ticket.id)} · ${esc(ticket.title)}</b>
    <small>${admin ? `${esc(ticket.user_name)} · ${esc(ticket.user_email)} · ` : ''}${fdatetime(ticket.created_at)}</small>
    ${markdownBlock(ticket.description, 'text-block')}
    ${ticket.steps ? `<small class="muted">Schritte:</small>${markdownBlock(ticket.steps, 'small text-block')}` : ''}
    ${ticket.github_url ? `<small><a href="${esc(ticket.github_url)}" target="_blank" rel="noopener noreferrer">GitHub-Issue #${esc(ticket.github_issue_number)}</a></small>` : ''}
    ${ticket.github_sync_error ? `<small class="auth-error">GitHub-Synchronisierung fehlgeschlagen: ${esc(ticket.github_sync_error)}</small>` : ''}
    <div class="ticket-comments">${(ticket.comments || []).map((comment) => commentHtml(ticket, comment, admin)).join('')}</div>
    <form data-comment-form="${esc(ticket.id)}" class="ticket-comment-form">
      <div class="field md-field"><label for="comment-${esc(ticket.id)}">Kommentar</label><textarea id="comment-${esc(ticket.id)}" name="body" rows="2" maxlength="5000" required data-md="lazy"></textarea></div>
      <div class="row start"><button class="btn ghost sm" type="submit">Kommentieren</button></div>
    </form>
  </div>
  <button type="button" class="btn ghost sm" data-ticket-del="${esc(ticket.id)}" ${ticket.github_url ? 'data-github="1"' : ''}>Löschen</button>
</div>`;

export function bindTickets(root, basePath, reload) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-ticket-del], [data-comment-del]');
    if (!button) return;
    try {
      if (button.dataset.ticketDel) {
        const hint = button.dataset.github ? ' Das GitHub-Issue bleibt bestehen.' : '';
        if (!(await confirmBox('Ticket löschen', `Das Ticket und alle Kommentare werden endgültig gelöscht.${hint}`))) return;
        await api.del(`${basePath}/${button.dataset.ticketDel}`);
        toast('Ticket gelöscht');
      } else {
        if (!(await confirmBox('Kommentar löschen', 'Diesen Kommentar wirklich löschen?'))) return;
        await api.del(`${basePath}/${button.dataset.ticket}/comments/${button.dataset.commentDel}`);
      }
      await reload();
    } catch (error) {
      toast(error.message, true);
    }
  });
  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-comment-form]');
    if (!form) return;
    event.preventDefault();
    const body = form.elements.body.value.trim();
    if (!body) return toast('Bitte einen Kommentar eingeben', true);
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      await api.post(`${basePath}/${form.dataset.commentForm}/comments`, { body });
      await reload();
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
    }
    return undefined;
  });
}
