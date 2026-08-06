/**
 * Utskick av kvitto per e-post (KRAV-16), via Mailgun EU SMTP.
 *
 * Transporten kan injiceras (`transport`) så att tester kan köras utan att
 * något mejl lämnar maskinen. Utan konfiguration returneras null från
 * createMailerFromEnv() och endpointen svarar att funktionen är avstängd.
 */
import nodemailer from 'nodemailer';
import { renderReceiptPdf, receiptFilename } from './pdf.js';

/** Enkel adresskontroll – tillräcklig för att sålla bort uppenbara fel. */
export function isValidEmail(value) {
  const s = String(value ?? '').trim();
  if (s.length < 3 || s.length > 254) return false;
  if (/[\s,;<>"]/.test(s)) return false; // stoppar även header-injektion
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(s);
}

/**
 * Maskerar e-postadresser i text som ska loggas.
 *
 * SMTP-fel innehåller ofta mottagaradressen ("550 <adress>: Recipient address
 * rejected"). Tävlingsdata gallras efter 90 dagar (KRAV-14), men loggarna
 * sparas separat och obegränsat – en adress där blir kvar långt efter att
 * tävlingen är glömd. Domänen behålls, eftersom felet annars inte går att
 * felsöka.
 */
export function maskeraAdresser(text) {
  return String(text ?? '').replace(
    /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    (_, lokal, domän) => {
      const dolt = lokal.length <= 2 ? '***' : `${lokal[0]}***${lokal.at(-1)}`;
      return `${dolt}@${domän}`;
    }
  );
}

export function createMailer({ transport, from, replyTo = '' }) {
  if (!transport) return null;

  return {
    /** Skickar kvittot som PDF-bilaga. Kastar vid fel – anroparen översätter. */
    async sendReceipt({ to, receipt }) {
      const pdf = renderReceiptPdf(receipt);
      const name = receipt.runner?.name || 'Löpare';
      const cmp = receipt.competition?.name || 'tävlingen';
      const res = receipt.result || {};

      const summary = [
        `${name} – ${cmp}`,
        res.time ? `Tid: ${res.time}` : '',
        res.statusText ? `Status: ${res.statusText}` : '',
        res.place ? `Placering: ${res.place} av ${res.finished} i mål` : '',
      ].filter(Boolean);

      return transport.sendMail({
        from,
        to,
        ...(replyTo ? { replyTo } : {}),
        subject: `Ditt kvitto: ${name} – ${cmp}`,
        text: `${summary.join('\n')}\n\nHela sträcktidsutläsningen finns i den bifogade PDF:en.\n`,
        attachments: [
          { filename: receiptFilename(receipt), content: pdf, contentType: 'application/pdf' },
        ],
      });
    },
  };
}

/**
 * Bygger en mailer från miljövariabler. Mailgun EU kräver
 * smtp.eu.mailgun.org – US-endpointen ger "Authentication failed" för
 * EU-domäner.
 */
export function createMailerFromEnv(env = process.env, smtp = nodemailer) {
  const host = env.MAILGUN_SMTP;
  const user = env.MAILGUN_USER;
  const pass = env.MAILGUN_PWD;
  if (!host || !user || !pass) return null;

  const port = Number(env.MAILGUN_PORT) || 587;
  const transport = smtp.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    // Utan egna värden väntar nodemailer i minuter (två på anslutningen, tio
    // på hela transaktionen). Löparen står under tiden med "Skickar…" och en
    // låst knapp. Hellre ett tydligt fel efter tjugo sekunder.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return createMailer({
    transport,
    from: env.MAIL_FROM || `Digitalt kvitto <${user}>`,
    replyTo: env.MAIL_REPLY_TO || '',
  });
}

/**
 * Enkel takt-begränsning i minnet. Tjänsten ligger öppen mot internet
 * (KRAV-13) och skickar mejl med bilaga – utan tak vore endpointen en
 * gratis spam-relä på arrangörens Mailgun-konto.
 */
export function createRateLimiter({ max = 5, windowMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
  const hits = new Map(); // nyckel -> [tidsstämplar]

  return {
    /** true om anropet ryms inom kvoten (och räknas då in). */
    allow(key) {
      const t = now();
      const recent = (hits.get(key) || []).filter((ts) => t - ts < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);

      // Städa bort nycklar som inte använts på ett tag.
      if (hits.size > 5000) {
        for (const [k, list] of hits) {
          if (!list.some((ts) => t - ts < windowMs)) hits.delete(k);
        }
      }
      return true;
    },
  };
}
