import { api } from '../api.js';
import { openForm, toast, showSecret } from '../ui.js';

export async function render(view) {
  view.innerHTML = `<div class="page-head"><div><h1>Fehler melden</h1><p>Dein Bericht wird als GitHub-Issue für das Projektteam erstellt.</p></div></div>
    <div class="card"><button class="btn" id="bug-new">Fehlerbericht erstellen</button></div>`;
  view.addEventListener('click', async (event) => {
    if (!event.target.closest('#bug-new')) return;
    try {
      const report = await openForm({
        title: 'Fehlerbericht',
        fields: [
          { name: 'title', label: 'Kurzer Titel', required: true, full: true },
          { name: 'description', label: 'Was ist passiert?', type: 'textarea', required: true, full: true },
          { name: 'steps', label: 'Reproduktionsschritte (optional)', type: 'textarea', full: true },
        ],
        onSubmit: async (value) => {
          if (value.description.trim().length < 20) throw new Error('Bitte beschreibe den Fehler mit mindestens 20 Zeichen.');
          return api.post('/bug-reports', { title: value.title.trim(), description: value.description.trim(), steps: value.steps.trim() });
        },
      });
      if (report?.url) {
        toast(`Fehlerbericht #${report.number} erstellt`);
        await showSecret('Fehlerbericht erstellt', 'Der GitHub-Issue-Link:', report.url);
      }
    } catch (error) {
      toast(error.message, true);
    }
  });
}
