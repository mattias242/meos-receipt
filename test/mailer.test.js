import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, createMailer, createRateLimiter, maskeraAdresser, createMailerFromEnv } from '../lib/mailer.js';

// KRAV-16: kvitto per e-post

test('isValidEmail godtar vanliga adresser', () => {
  for (const ok of [
    'loparen@example.org',
    'anna.andersson@ok-skogen.se',
    'a+kvitto@sub.domain.example',
  ]) {
    assert.ok(isValidEmail(ok), `${ok} borde godtas`);
  }
});

test('isValidEmail avvisar trasiga adresser och header-injektion', () => {
  for (const bad of [
    '',
    'inte-en-adress',
    'utan@domän',
    'a@b',
    'två@adresser.se, tre@adresser.se',
    'namn <adress@example.org>',
    'a@b.se\nBcc: offer@example.org',
    `${'a'.repeat(250)}@example.org`,
  ]) {
    assert.ok(!isValidEmail(bad), `${JSON.stringify(bad)} borde avvisas`);
  }
});

test('createMailer utan transport ger null – funktionen är då avstängd', () => {
  assert.equal(createMailer({ transport: null, from: 'a@b.se' }), null);
});

const RECEIPT = {
  competition: { id: 1, name: 'Testtävlingen', date: '2026-08-06', organizer: 'Testklubben OK' },
  runner: { id: 31, name: 'Anna Andersson', club: 'OK Skogen', class: 'H21', card: 123456 },
  result: { status: 1, statusText: 'Godkänd', time: '35:00', place: 2, finished: 2, after: '+2:30' },
  splits: [{ control: 31, name: '31', status: 'ok', clock: '10:07:30', elapsed: '7:30', leg: '7:30' }],
  updated: '2026-08-06T14:42:36.625Z',
};

test('sendReceipt bifogar kvittot som PDF och sammanfattar i texten', async () => {
  const sent = [];
  const mailer = createMailer({
    from: 'Digitalt kvitto <kvitto@example.test>',
    transport: { async sendMail(m) { sent.push(m); return { messageId: '1' }; } },
  });

  await mailer.sendReceipt({ to: 'loparen@example.org', receipt: RECEIPT });

  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.to, 'loparen@example.org');
  assert.equal(mail.from, 'Digitalt kvitto <kvitto@example.test>');
  assert.ok(mail.subject.includes('Anna Andersson'));
  assert.ok(mail.text.includes('35:00'));
  assert.ok(mail.text.includes('Godkänd'));

  const [attachment] = mail.attachments;
  assert.equal(attachment.contentType, 'application/pdf');
  assert.equal(attachment.filename, 'Kvitto-Anna-Andersson-Testtavlingen.pdf');
  assert.equal(attachment.content.subarray(0, 5).toString(), '%PDF-');
});

// KRAV-16: SMTP-fel innehåller ofta mottagaradressen ("550 <adress>: Recipient
// address rejected"). Tjänsten gallrar personuppgifter efter 90 dagar, men
// loggarna sparas separat och obegränsat – adressen ska inte hamna där i klartext.
test('maskeraAdresser döljer e-postadresser i felmeddelanden', () => {
  assert.equal(
    maskeraAdresser('550 5.1.1 <loparen@example.org>: Recipient address rejected'),
    '550 5.1.1 <l***n@example.org>: Recipient address rejected'
  );
  assert.equal(
    maskeraAdresser('Invalid login: 535 for postmaster@mg.klubben.se'),
    'Invalid login: 535 for p***r@mg.klubben.se'
  );
});

test('maskeraAdresser behåller domänen så felet går att felsöka', () => {
  const maskerad = maskeraAdresser('rejected: anna.andersson@ok-skogen.se');
  assert.match(maskerad, /ok-skogen\.se/, 'domänen behövs för att förstå felet');
  assert.ok(!maskerad.includes('anna.andersson'), 'men inte vem det gäller');
});

test('maskeraAdresser rör inte text utan adresser', () => {
  const text = 'Connection timeout after 30000 ms';
  assert.equal(maskeraAdresser(text), text);
});

// KRAV-16: utan egna timeouts väntar nodemailer i upp till tio minuter på en
// SMTP-server som inte svarar. Löparen står då kvar med "Skickar…" och en låst
// knapp, och anropet är redan avräknat mot hennes kvot.
test('SMTP-transporten ger upp inom rimlig tid', () => {
  const skapade = [];
  const fejkadNodemailer = {
    createTransport(opts) {
      skapade.push(opts);
      return { sendMail: async () => ({}) };
    },
  };
  const mailer = createMailerFromEnv(
    {
      MAILGUN_SMTP: 'smtp.eu.mailgun.org',
      MAILGUN_USER: 'kvitto@example.test',
      MAILGUN_PWD: 'hemligt',
    },
    fejkadNodemailer
  );
  assert.ok(mailer, 'mailern ska skapas');
  assert.equal(skapade.length, 1);

  const o = skapade[0];
  for (const nyckel of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
    assert.equal(typeof o[nyckel], 'number', `${nyckel} måste sättas – standarden är minuter`);
    assert.ok(o[nyckel] <= 30000, `${nyckel} är ${o[nyckel]} ms; löparen väntar inte så länge`);
  }
});

test('rate limiter släpper igenom upp till max och stoppar sedan', () => {
  const limiter = createRateLimiter({ max: 3, windowMs: 1000, now: () => 1000 });
  assert.deepEqual(
    [1, 2, 3, 4].map(() => limiter.allow('1.2.3.4')),
    [true, true, true, false]
  );
});

test('rate limiter räknar per nyckel', () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => 1000 });
  assert.equal(limiter.allow('1.2.3.4'), true);
  assert.equal(limiter.allow('1.2.3.4'), false);
  assert.equal(limiter.allow('5.6.7.8'), true, 'annan IP ska ha egen kvot');
});

test('rate limiter öppnar igen när fönstret passerat', () => {
  let t = 1000;
  const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => t });
  assert.equal(limiter.allow('1.2.3.4'), true);
  assert.equal(limiter.allow('1.2.3.4'), false);
  t += 1001;
  assert.equal(limiter.allow('1.2.3.4'), true);
});
