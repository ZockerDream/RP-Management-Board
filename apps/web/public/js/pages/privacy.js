import { api } from '../api.js';
import { esc } from '../ui.js';
import { legalHead } from './imprint.js';

export async function render(view) {
  const i = await api.get('/public/imprint');
  const controller = [i.name, i.street, [i.postalCode, i.city].filter(Boolean).join(' '), i.country].filter(Boolean).map(esc).join('<br>');
  view.innerHTML = `<section class="legal">${legalHead('datenschutz')}<h1>Datenschutzerklärung</h1>
    <p class="legal-lead">Hier steht, welche personenbezogenen Daten diese Anwendung verarbeitet und welche Rechte du hast.</p>
    <div class="legal-grid">
      <div class="legal-card"><h2>Verantwortlicher</h2>${controller ? `<p>${controller}</p>` : '<p>Siehe Impressum.</p>'}${i.email ? `<p>E-Mail: <a href="mailto:${esc(i.email)}">${esc(i.email)}</a></p>` : ''}</div>
      <div class="legal-card"><h2>Rechtsgrundlagen</h2><p>Art. 6 Abs. 1 lit. b DSGVO (Nutzung der Anwendung), lit. f (Sicherheit, Betrieb, Protokollierung) und lit. a (Einwilligung, z. B. Gravatar).</p></div>
      <div class="legal-card wide"><h2>Verarbeitete Daten</h2><ul>
        <li><b>Konto:</b> Name, E-Mail-Adresse, Passwort (nur als Argon2-Hash), optional 2FA-Geheimnis (verschlüsselt), Rollen und Einstellungen.</li>
        <li><b>Inhalte, die du erfasst:</b> Konten, Transaktionen, Budgets, Sparziele, Stundenzettel, Objekte (Häuser, Fahrzeuge, Schlüssel, Personen), Kalendereinträge, Notizen, ToDos, Teams und Sportergebnisse. Inhalte in Teams sind für deren Mitglieder sichtbar.</li>
        <li><b>Angaben über Personen:</b> Akten mit beteiligten Personen, deren Rolle, Einträgen und Anhängen; Lizenzen mit Nummer, Gültigkeit und Sperr- oder Entzugsgrund; Schulungsteilnahmen mit Ergebnis und Gültigkeit. Das betrifft auch Personen ohne eigenen Zugang. Sichtbar sind diese Angaben nur für dich oder die Mitglieder des Teams, dem der Datensatz gehört; Änderungen stehen im Audit-Log. Wer Angaben über Dritte erfasst, ist für deren Rechtmäßigkeit verantwortlich.</li>
        <li><b>Protokolle:</b> Audit-Log mit Zeitpunkt, Benutzer, Aktion und IP-Adresse (Sicherheit und Nachvollziehbarkeit) sowie technische Serverlogs.</li>
        <li><b>Fehlermeldungen:</b> Text, den du im Formular „Fehler melden“ eingibst, und Kommentare zu Tickets. Beides sehen die Administratoren.</li></ul></div>
      <div class="legal-card"><h2>Cookies &amp; lokaler Speicher</h2><p>Es gibt nur technisch notwendige Speicherung: ein Sitzungs-Cookie (<code>bm_refresh</code>, HttpOnly) für die Anmeldung und lokale Browser-Einstellungen (z. B. Design). Kein Tracking, keine Werbung, keine Analyse. Eine Einwilligung ist dafür nicht erforderlich (§ 25 Abs. 2 TDDDG).</p></div>
      <div class="legal-card"><h2>Weitergabe an Dritte</h2><ul>
        <li><b>Gravatar</b> (Automattic): nur wenn du es in den Einstellungen aktivierst; dann wird ein Hash deiner E-Mail-Adresse an gravatar.com gesendet. Standard ist aus.</li>
        <li><b>GitHub:</b> nur wenn Fehlermeldungen als Ticket weitergeleitet werden (Betreiber-Konfiguration).</li>
        <li><b>Have I Been Pwned:</b> nur wenn aktiviert; es werden 5 Zeichen eines Passwort-Hashs gesendet, nie das Passwort.</li>
        <li><b>E-Mail-Server und Anmeldung über Google/Microsoft:</b> nur wenn vom Betreiber eingerichtet.</li></ul></div>
      <div class="legal-card"><h2>Speicherdauer</h2><p>Daten bleiben, solange dein Konto besteht. Audit-Log und Benachrichtigungen werden nach der im Admin-Bereich eingestellten Frist gelöscht. Backups werden nach der konfigurierten Aufbewahrungszeit rotiert.</p></div>
      <div class="legal-card"><h2>Deine Rechte</h2><p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch (Art. 15–21 DSGVO) sowie auf Widerruf einer Einwilligung. Wende dich dazu an den Verantwortlichen. Du kannst dich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren.</p></div>
    </div></section>`;
}
