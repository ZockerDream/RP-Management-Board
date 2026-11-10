import { api } from '../api.js';
import { openForm, todayStr, toast, parseAmount, eur, esc, budgetTag, tag } from '../ui.js';
import { can } from '../app.js';

export const loadBudgets = () => api.get('/budgets');

const TYPES = [{ v: 'expense', l: 'Ausgabe' }, { v: 'income', l: 'Einnahme' }, { v: 'deposit', l: 'Einzahlung Sparziel' }];

export async function txForm(tx, defaults = {}) {
  const [budgets, goals] = await Promise.all([loadBudgets(), api.get('/goals').catch(() => [])]);
  if (!budgets.length) { toast('Bitte zuerst ein Konto anlegen', true); return false; }
  const bid = tx?.budget_id || defaults.budget_id || budgets[0].id;
  const catOpts = (id) => [{ v: '', l: '– Keine –' }, ...(budgets.find((b) => b.id === id)?.categories || []).map((c) => ({ v: c.id, l: c.name }))];
  const fields = [
    { name: 'title', label: 'Titel', value: tx?.title ?? defaults.title, full: true, required: true },
    { name: 'type', label: 'Art', type: 'select', options: TYPES, value: tx?.type || defaults.type || 'expense' },
    { name: 'income_kind', label: 'Einnahmeart', type: 'select', options: [{ v: 'other', l: 'Sonstige Einnahme' }, { v: 'salary', l: 'Gehalt' }], value: tx?.income_kind || defaults.income_kind || 'other' },
    { name: 'amount', label: 'Betrag', value: tx?.amount ? String(tx.amount).replace('.', ',') : '', required: true, placeholder: '0,00' },
    { name: 'budget_id', label: 'Konto', type: 'select', options: budgets.map((b) => ({ v: b.id, l: b.name })), value: bid },
    { name: 'category_id', label: 'Kategorie', type: 'select', options: catOpts(bid), value: tx?.category_id || '' },
    { name: 'booked_at', label: 'Datum', type: 'date', value: tx?.booked_at?.slice(0, 10) || todayStr(), required: true },
    { name: 'goal_id', label: 'Sparziel (bei Einzahlung)', type: 'select', options: [{ v: '', l: '– Keines –' }, ...goals.map((g) => ({ v: g.id, l: g.name }))], value: tx?.goal_id || defaults.goal_id || '' },
    { name: 'tags', label: 'Tags (Komma-getrennt)', value: (tx?.tags || []).join(', '), full: true },
    { name: 'note', label: 'Notiz', type: 'textarea', value: tx?.note, full: true },
  ];
  const p = openForm({
    title: tx ? 'Buchung bearbeiten' : 'Neue Buchung', fields,
    onSubmit: async (v) => {
      const body = {
        title: v.title.trim(), type: v.type, income_kind: v.type === 'income' ? v.income_kind : 'other', amount: parseAmount(v.amount), category_id: v.category_id || null, booked_at: v.booked_at,
        goal_id: v.type === 'deposit' ? v.goal_id || null : null, note: v.note, tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (tx) await api.patch(`/transactions/${tx.id}`, body);
      else await api.post('/transactions', { ...body, budget_id: v.budget_id }, { headers: { 'Idempotency-Key': crypto.randomUUID() } });
      toast('Buchung gespeichert');
    },
  });
  const sel = document.querySelector('#f-budget_id');
  const typeSel = document.querySelector('#f-type');
  const incomeKind = document.querySelector('#f-income_kind')?.closest('label');
  const updateIncomeKind = () => { if (incomeKind) incomeKind.hidden = typeSel?.value !== 'income'; };
  typeSel?.addEventListener('change', updateIncomeKind);
  updateIncomeKind();
  if (sel) {
    if (tx) sel.disabled = true;
    sel.addEventListener('change', () => {
      document.querySelector('#f-category_id').innerHTML = catOpts(sel.value).map((o) => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('');
    });
  }
  return p;
}

// Gehaltskonto: gebucht wird nur auf ein eigenes aktives persönliches Konto in Profilwährung.
// Andere Konten bleiben mit Begründung sichtbar, damit klar ist, warum sie nicht wählbar sind.
export function payrollAccountOptions(budgets, me, currency = me.currency || 'EUR') {
  const blocked = (b) => {
    if (b.type !== 'solo' || b.owner_user_id !== me.id) return 'Konto einer Organisation';
    return b.currency === currency ? '' : `in ${b.currency}`;
  };
  return [{ v: '', l: 'Kein Konto ausgewählt' }, ...budgets.filter((b) => !b.archived).map((b) => {
    const reason = blocked(b);
    return { v: b.id, l: reason ? `${b.name} – nicht wählbar (${reason})` : `${b.name} (${b.currency})`, disabled: Boolean(reason) };
  })];
}
export const payrollAccountHint = (options, currency) => (options.some((o) => o.v && !o.disabled)
  ? 'Tägliche Basisgutschrift inklusive Wochenende; Auszahlung um 03:45 Uhr. Wählbar sind eigene persönliche Konten in Profilwährung.'
  : `Du hast noch kein persönliches Konto in ${currency}. Lege es unter „Konten“ an (neue Konten erhalten deine Profilwährung) und wähle es dann hier aus.`);

// Solo oder Organisation: Organisationen, in denen die Person in dieser Funktion mindestens `min` hat
// (anlegen meist ab „Lesen & Schreiben“ = 3); die aktuelle Organisation bleibt beim Bearbeiten immer wählbar
export const orgsWithLevel = async (module, min = 3) => (can('team:read') ? (await api.get('/teams')).filter((team) => (team.levels?.[module] ?? 0) >= min) : []);
export const writableTeams = orgsWithLevel;
export function visibilityField(teams, item) {
  const options = [{ v: '', l: 'Solo (nur für mich)' }, ...teams.map((team) => ({ v: team.id, l: `Organisation: ${team.name}` }))];
  if (item?.team_id && !teams.some((team) => team.id === item.team_id)) options.push({ v: item.team_id, l: `Organisation: ${item.team_name}` });
  return { name: 'team_id', label: 'Sichtbarkeit', type: 'select', options, value: item?.team_id || '' };
}
// Notiz-Tags: Farbe aus dem Server-Management, Klasse für .tag
export const NOTE_TAG_COLORS = { neutral: ['', 'Grau'], primary: ['primary', 'Blau'], ok: ['ok', 'Grün'], warn: ['warn', 'Gelb'], bad: ['bad', 'Rot'] };
export const noteTagHtml = (noteTag) => tag(NOTE_TAG_COLORS[noteTag.color]?.[0] ?? '', noteTag.name);
export const scopeTag = (item) => budgetTag(item.team_id ? 'shared' : 'solo', item.team_name || 'Solo');

export const money = eur;
export const sumBy = (list, k) => list.reduce((a, x) => a + Number(x[k] || 0), 0);
