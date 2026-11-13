// Kleine Formatierungen für Texte in Benachrichtigungen, Discord und PDFs (ohne Datenbank)
export const fdateDe = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('.') : '');
export const moneyDe = (v, currency = 'EUR') => Number(v).toLocaleString('de-DE', { style: 'currency', currency });
