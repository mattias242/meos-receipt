import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';

/**
 * KRAV-13: tools/verifiera-drift.sh är det operatören kör dagen före en
 * tävling, och därmed sista chansen att upptäcka en felkonfiguration innan
 * löparna är på plats.
 *
 * Skriptet prövade att tjänsten svarar, att data finns och når disken, och
 * att kvitto och PDF fungerar – men inget om hur den är konfigurerad. En
 * tjänst med öppna skrivändpunkter, där vem som helst kan ersätta hela
 * tävlingen med en MOPComplete, klarade alla kontroller.
 */

const SKRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tools',
  'verifiera-drift.sh'
);

async function startServer(opts = {}) {
  const app = createApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** Kör skriptet och returnerar { kod, ut }. */
function kör(base, bricka) {
  return new Promise((klar) => {
    const proc = spawn('sh', [SKRIPT, base, ...(bricka ? [String(bricka)] : [])]);
    let ut = '';
    proc.stdout.on('data', (d) => (ut += d));
    proc.stderr.on('data', (d) => (ut += d));
    proc.on('close', (kod) => klar({ kod, ut }));
  });
}

test('skriptet upptäcker att skrivändpunkterna står öppna', async (t) => {
  const { server, base } = await startServer({ password: '' });
  t.after(() => server.close());

  const { ut, kod } = await kör(base);
  assert.match(
    ut,
    /lösenord/i,
    `skriptet nämner inte att vem som helst kan skicka in tävlingsdata:\n${ut}`
  );
  assert.notEqual(kod, 0, 'en öppen skrivändpunkt ska räknas som ett fel');
});

test('med lösenord satt godkänns kontrollen', async (t) => {
  const { server, base } = await startServer({ password: 'hemligt' });
  t.after(() => server.close());

  const { ut } = await kör(base);
  assert.match(ut, /✓.*[Ll]ösenord/, `kontrollen saknas eller föll:\n${ut}`);
  assert.doesNotMatch(ut, /✗.*[Ll]ösenord/);
});

/**
 * Sonden får inte lämna spår efter sig. Den skickar därför en zip-signatur:
 * den avvisas med NOZIP *efter* lösenordskontrollen, så svaret skiljer på
 * skyddad och öppen tjänst utan att någonting tolkas eller sparas.
 */
test('kontrollen skapar ingen tävling och rör ingen data', async (t) => {
  const { server, base } = await startServer({ password: 'hemligt' });
  t.after(() => server.close());

  const före = await (await fetch(`${base}/api/competitions`)).json();
  await kör(base);
  const efter = await (await fetch(`${base}/api/competitions`)).json();
  assert.deepEqual(efter, före, 'kontrollen lämnade spår i tävlingsdatan');
});

test('skriptet kontrollerar att kvitton inte får cachas', async (t) => {
  const { server, base } = await startServer({ password: 'hemligt' });
  t.after(() => server.close());

  const { ut } = await kör(base);
  assert.match(
    ut,
    /✓.*cach/i,
    `ingen kontroll av cachning – ett mellanled som sparar kvitton visar ` +
      `fel status och läcker personuppgifter:\n${ut}`
  );
});
