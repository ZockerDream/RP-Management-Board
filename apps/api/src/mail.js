import nodemailer from 'nodemailer';
import { config } from './config.js';
import { getSetting } from './settings.js';

let transport;
const t = () => {
  if (!config.smtp.host) return null;
  transport ||= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transport;
};

export const mailConfigured = () => !!config.smtp.host;

export async function sendMail({ to, subject, text, log = console }) {
  const tr = t();
  if (!tr || !(await getSetting('mail.enabled'))) {
    log.warn?.(`SMTP nicht konfiguriert – Mail an ${to} ("${subject}") nicht gesendet`);
    return false;
  }
  try {
    await tr.sendMail({ from: config.smtp.from, to, subject, text });
    return true;
  } catch (e) {
    log.error?.({ err: e }, 'Mailversand fehlgeschlagen');
    return false;
  }
}

export async function verifyMail() {
  const tr = t();
  if (!tr) throw new Error('SMTP_HOST nicht gesetzt');
  await tr.verify();
}
