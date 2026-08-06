import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { MOP_COMPLETE } from './fixtures/mop.js';

/**
 * KRAV-16: taket på mejlutskick gäller per avsändar-IP.
 *
 * Bakom Fly.io:s proxy och nginx (KRAV-13) är socketens adress proxyns, inte
 * löparens – alltså samma för alla. Med taket på fem per tio minuter räcker
 * det då att fem löpare mejlat sitt kvitto för att alla andra ska vara
 * utelåsta resten av tävlingen.
 *
 * Motsatt fel är lika illa: litar tjänsten blint på X-Forwarded-For räcker
 * det med att sätta headern själv för att kringgå taket helt. Därför är det
 * ett uttalat antal hopp som gäller, inte "lita på vad som helst".
 */

async function startServer(opts = {}) {
  const app = createApp({
    mailer: { sendReceipt: async () => {} },
    emailRateLimit: { max: 2, windowMs: 60000 },
    ...opts,
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/meos`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1' },
    body: MOP_COMPLETE,
  });
  return { server, base };
}

/** Ett mejlutskick som utger sig för att komma från `klient`. */
function mejla(base, klient) {
  return fetch(`${base}/api/receipt/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(klient ? { 'x-forwarded-for': klient } : {}),
    },
    body: JSON.stringify({ email: 'loparen@example.org', card: 123456 }),
  });
}

test('bakom en proxy räknas löparen, inte proxyn', async (t) => {
  const { server, base } = await startServer({ trustProxy: 1 });
  t.after(() => server.close());

  assert.equal((await mejla(base, '198.51.100.7')).status, 200);
  assert.equal((await mejla(base, '198.51.100.7')).status, 200);
  assert.equal((await mejla(base, '198.51.100.7')).status, 429, 'taket ska gälla per löpare');

  // En annan löpare bakom samma proxy ska inte drabbas av grannens utskick
  assert.equal(
    (await mejla(base, '203.0.113.9')).status,
    200,
    'alla bakom proxyn delade på taket – efter fem utskick är tävlingen utelåst'
  );
});

test('utan proxy går headern inte att sätta själv', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  // Samma socket varje gång; headern ska inte kunna kringgå taket
  assert.equal((await mejla(base, '1.1.1.1')).status, 200);
  assert.equal((await mejla(base, '2.2.2.2')).status, 200);
  assert.equal(
    (await mejla(base, '3.3.3.3')).status,
    429,
    'en påhittad X-Forwarded-For gav ett nytt tak per anrop – taket är då verkningslöst'
  );
});

test('med proxy går bara det hopp tjänsten litar på att ändra', async (t) => {
  const { server, base } = await startServer({ trustProxy: 1 });
  t.after(() => server.close());

  // Med ett hopp är det yttersta ledet proxyns eget påstående om klienten.
  // Lägger klienten till fler led före sitt eget ska de inte kunna knuffa
  // fram en ny identitet – det är alltid samma position som räknas.
  assert.equal((await mejla(base, '198.51.100.7')).status, 200);
  assert.equal((await mejla(base, 'falsk-1, falsk-2, 198.51.100.7')).status, 200);
  assert.equal(
    (await mejla(base, 'falsk-3, falsk-4, 198.51.100.7')).status,
    429,
    'löparen kunde byta identitet genom att fylla på med egna led i headern'
  );
});
