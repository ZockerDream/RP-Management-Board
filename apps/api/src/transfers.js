// Umbuchungen (Wunsch des Auftraggebers vom 2026-11-11): Regeln, ob eine Umbuchung sofort bucht oder auf Annahme
// wartet. Ohne Datenbank, damit der Unit-Test alle Fälle prüfen kann; die Routen stehen in routes/transfers.js.
//  - eigenes persönliches Konto: sofort
//  - Konto einer Organisation, in der man Mitglied ist: mit „Lesen & Schreiben“ (budget ≥ 3) sofort, sonst Annahme
//  - jeder andere aktive Benutzer: Annahme; das Zielkonto wählt der Empfänger
const fail = (message) => Object.assign(new Error(message), { statusCode: 400, code: 'transfer' });

export function planTransfer({ me, from, target }) {
  if (from.archived) throw fail('Quellkonto ist archiviert');
  if (target.kind === 'user') {
    const user = target.user;
    if (!user || !user.active) throw fail('Benutzer nicht gefunden');
    if (user.id === me) throw fail('An dich selbst bitte als eigenes Konto umbuchen');
    return { mode: 'pending' };
  }
  const budget = target.budget;
  if (!budget) throw fail('Zielkonto nicht gefunden');
  if (budget.id === from.id) throw fail('Quell- und Zielkonto sind gleich');
  if (target.kind === 'own') {
    if (budget.type !== 'solo' || budget.owner_user_id !== me) throw fail('Das ist nicht dein persönliches Konto');
  } else if (target.kind === 'team') {
    if (!budget.team_id || !target.isMember) throw fail('Du bist in dieser Organisation kein Mitglied');
  } else throw fail('Unbekanntes Ziel');
  if (budget.archived) throw fail('Zielkonto ist archiviert');
  if (budget.currency !== from.currency) throw fail('Beide Konten brauchen dieselbe Währung');
  return { mode: target.kind === 'own' || budget.level >= 3 ? 'direct' : 'pending' };
}
