import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

/**
 * KRAV-16: TRUST_PROXY måste sättas manuellt när något står framför tjänsten.
 *
 * Görs det inte räknar takt-begränsaren proxyns adress för samtliga löpare,
 * och när fem mejlat sitt kvitto är resten av tävlingen utelåst. Ingenting
 * felar, ingenting loggas – det märks först när en löpare säger att det inte
 * går, mitt under tävlingen.
 *
 * Men tjänsten kan se det själv: kommer anropen med X-Forwarded-For finns det
 * en proxy där framme, och då är inställningen fel. Det syns i /api/health, så
 * att tools/verifiera-drift.sh fångar det dagen före i stället.
 */

async function startServer(opts = {}) {
  const app = createApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const hälsa = (base) => fetch(`${base}/api/health`).then((r) => r.json());

test('en proxy utan TRUST_PROXY upptäcks och rapporteras', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  assert.equal((await hälsa(base)).proxyvarning, undefined, 'inget setts än');

  await fetch(`${base}/api/competitions`, { headers: { 'x-forwarded-for': '198.51.100.7' } });

  const h = await hälsa(base);
  assert.ok(
    h.proxyvarning,
    'anrop kom via en proxy men hälsokontrollen säger ingenting – ' +
      'mejlutskicken slutar fungera för alla utom de fem första'
  );
  assert.match(String(h.proxyvarning), /TRUST_PROXY/, 'varningen ska säga vad som ska sättas');
});

test('med TRUST_PROXY satt varnas det inte', async (t) => {
  const { server, base } = await startServer({ trustProxy: 1 });
  t.after(() => server.close());

  await fetch(`${base}/api/competitions`, { headers: { 'x-forwarded-for': '198.51.100.7' } });
  assert.equal((await hälsa(base)).proxyvarning, undefined, 'inställningen är ju rätt');
});

test('utan proxy varnas det inte', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  await fetch(`${base}/api/competitions`);
  assert.equal((await hälsa(base)).proxyvarning, undefined);
});

test('varningen loggas en gång, inte per anrop', async (t) => {
  const rader = [];
  const original = console.warn;
  console.warn = (...a) => rader.push(a.join(' '));
  t.after(() => { console.warn = original; });

  const { server, base } = await startServer();
  t.after(() => server.close());

  for (let i = 0; i < 5; i++) {
    await fetch(`${base}/api/competitions`, { headers: { 'x-forwarded-for': '198.51.100.7' } });
  }
  const proxyrader = rader.filter((r) => r.includes('TRUST_PROXY'));
  assert.equal(
    proxyrader.length,
    1,
    `loggades ${proxyrader.length} gånger – en rad per anrop dränker loggen ` +
      'under tävling, när den behövs som mest'
  );
});

/**
 * KRAV-16: bakom Cloudflare *och* nginx är det två hopp, inte ett.
 *
 * Med TRUST_PROXY=1 blir löparens adress i stället Cloudflares, gemensam för
 * alla – och mejltaket låser ute hela tävlingen efter fem utskick. Det är
 * samma fel som fanns före rättningen, bara ett steg längre ut, och den
 * tidigare varningen fångar det inte: inställningen *är* ju satt.
 *
 * Tjänsten räknar därför hur många led som faktiskt rapporteras och säger
 * vad TRUST_PROXY borde vara. Antalet är en mätning att gå efter, inte något
 * att ställa in automatiskt: en klient kan lägga till egna led i headern, och
 * därför används det minsta observerade – infrastrukturens egna led.
 */

const medHopp = (base, ...adresser) =>
  fetch(`${base}/api/competitions`, { headers: { 'x-forwarded-for': adresser.join(', ') } });

test('tjänsten rapporterar hur många proxyhopp den ser', async (t) => {
  const { server, base } = await startServer({ trustProxy: 2 });
  t.after(() => server.close());

  await medHopp(base, '198.51.100.7', '203.0.113.1');
  const h = await hälsa(base);
  assert.equal(h.proxyhopp, 2, 'Cloudflare + nginx ger två led i X-Forwarded-For');
});

test('en för låg inställning upptäcks', async (t) => {
  const { server, base } = await startServer({ trustProxy: 1 });
  t.after(() => server.close());

  await medHopp(base, '198.51.100.7', '203.0.113.1');
  const h = await hälsa(base);
  assert.match(
    String(h.proxyvarning),
    /2/,
    `två led rapporteras men TRUST_PROXY är 1 – alla löpare räknas som samma ` +
      `avsändare, och ingenting sa ifrån: ${JSON.stringify(h)}`
  );
});

test('rätt inställning varnar inte', async (t) => {
  const { server, base } = await startServer({ trustProxy: 2 });
  t.after(() => server.close());
  await medHopp(base, '198.51.100.7', '203.0.113.1');
  assert.equal((await hälsa(base)).proxyvarning, undefined);
});

/**
 * En klient kan fylla på headern med egna led. Räknades det högsta talet
 * skulle vem som helst kunna få tjänsten att varna – eller värre, få en
 * arrangör att höja TRUST_PROXY och därmed börja lita på klientens påhitt.
 */
test('påhittade led i headern höjer inte det rapporterade antalet', async (t) => {
  const { server, base } = await startServer({ trustProxy: 2 });
  t.after(() => server.close());

  await medHopp(base, '198.51.100.7', '203.0.113.1');
  await medHopp(base, 'påhittad-1', 'påhittad-2', '198.51.100.7', '203.0.113.1');
  const h = await hälsa(base);
  assert.equal(h.proxyhopp, 2, 'det minsta observerade är infrastrukturens egna led');
  assert.equal(h.proxyvarning, undefined, 'och det ska inte gå att framkalla en varning');
});
