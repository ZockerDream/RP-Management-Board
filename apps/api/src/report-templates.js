// Fertige Berichtsvorlagen, die eine Organisation mit einem Klick übernehmen kann (Markdown, wird beim Schreiben ausgefüllt)
const section = (...parts) => parts.map(([title, body]) => `## ${title}\n${body}`).join('\n\n');

export const TEMPLATE_SETS = {
  police: {
    label: 'Polizei',
    templates: [
      ['Einsatzbericht', section(['Einsatzanlass', 'Was wurde gemeldet, von wem, wann?'], ['Eingesetzte Kräfte', '- '], ['Verlauf', 'Chronologisch, mit Uhrzeiten.'], ['Maßnahmen', '- '], ['Ergebnis', ''])],
      ['Festnahmebericht', section(['Festgenommene Person', ''], ['Grund der Festnahme', 'Tatvorwurf, Haftbefehl oder Gefahr im Verzug'], ['Belehrung', '- [ ] Über Rechte belehrt um __:__ Uhr\n- [ ] Anwalt verlangt'], ['Durchsuchung', 'Was wurde gefunden und sichergestellt?'], ['Verbleib', 'Gewahrsam, Haftanstalt, entlassen um __:__ Uhr'])],
      ['Vernehmungsprotokoll', section(['Vernommene Person', 'Name, Rolle (Zeuge, Beschuldigter)'], ['Belehrung', '- [ ] Belehrt über Aussageverweigerungsrecht'], ['Aussage', '> Wörtlich oder sinngemäß'], ['Nachfragen', '- '], ['Abschluss', 'Vorgelesen und genehmigt um __:__ Uhr'])],
      ['Durchsuchungsbericht', section(['Grundlage', 'Durchsuchungsbeschluss Nr. … oder Gefahr im Verzug'], ['Objekt', 'Person, Fahrzeug oder Gebäude'], ['Anwesende', '- '], ['Fundstücke', '| Nr. | Gegenstand | Fundort |\n| --- | --- | --- |\n|  |  |  |'])],
      ['Unfallbericht', section(['Unfallort und Zeit', ''], ['Beteiligte', '| Person | Fahrzeug | Kennzeichen |\n| --- | --- | --- |\n|  |  |  |'], ['Hergang', ''], ['Verletzte', ''], ['Maßnahmen', '- '])],
    ],
  },
  medic: {
    label: 'Rettungsdienst',
    templates: [
      ['Einsatzprotokoll Rettungsdienst', section(['Alarmierung', 'Meldebild, Uhrzeit'], ['Auffindesituation', ''], ['Erstbefund (ABCDE)', '- A: \n- B: \n- C: \n- D: \n- E: '], ['Vitalwerte', '| Zeit | Puls | RR | SpO₂ | AF | GCS |\n| --- | --- | --- | --- | --- | --- |\n|  |  |  |  |  |  |'], ['Maßnahmen und Medikamente', '- '], ['Transport und Übergabe', 'Zielklinik, Übergabe an …, Uhrzeit'])],
      ['Behandlungsbericht', section(['Diagnose', ''], ['Behandlung', '- '], ['Medikation', '- '], ['Verlauf', ''], ['Empfehlung', 'Weiterbehandlung, Kontrolle, Arbeitsunfähigkeit'])],
      ['Leichenschau', section(['Feststellung des Todes', 'Zeitpunkt, sichere Todeszeichen'], ['Todesart', '- [ ] natürlich\n- [ ] nicht natürlich\n- [ ] ungeklärt'], ['Befund', ''], ['Benachrichtigt', '- [ ] Polizei\n- [ ] Angehörige'])],
      ['Ärztliches Attest', section(['Untersuchung', 'Datum, Anlass'], ['Befund', ''], ['Bescheinigung', ''])],
    ],
  },
  general: {
    label: 'Allgemein',
    templates: [
      ['Aktenvermerk', section(['Sachverhalt', ''], ['Veranlasst', '- '])],
      ['Gesprächsnotiz', section(['Gesprächspartner', ''], ['Inhalt', ''], ['Vereinbart', '- '])],
    ],
  },
};
