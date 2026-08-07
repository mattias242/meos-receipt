import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * KRAV-13: tjänsten ligger på internet.
 *
 * Utan MEOS_PASSWORD kontrolleras ingen `pwd`-header, och /meos och /iof står
 * öppna för vem som helst som hittar adressen – en enda MOPComplete ersätter
 * hela tävlingen mitt under loppet. Det var acceptabelt när tjänsten kördes på
 * arenans wifi (KRAV-12, utgått); det är det inte längre.
 *
 * Varningen som fanns förut hamnade i en logg ingen läser. Att vägra starta
 * märks i stället direkt vid deploy: Fly.io byter inte trafik till en release
 * som inte kommer upp, så den fungerande versionen står kvar.
 */

const ROT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Startar index.js med given miljö och returnerar { kod, ut }. */
function start(env, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['index.js'], {
      cwd: ROT,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        PORT: '0',
        // index.js laddar .env via dotenv oavsett vad som står i miljön här,
        // och utvecklarens egen .env har ett lösenord. Peka den åt en fil som
        // inte finns, annars mäter testet maskinen i stället för koden.
        DOTENV_CONFIG_PATH: path.join(ROT, '.env.finns-inte'),
        // Egen datakatalog: den startade tjänsten läser, gallrar och skriver
        // om DATA_DIR, och dödas dessutom mitt i av testet nedan. Den får
        // inte ha projektets riktiga tävlingsdata under sig.
        DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'meos-start-')),
        ...env,
      },
    });
    let ut = '';
    proc.stdout.on('data', (d) => (ut += d));
    proc.stderr.on('data', (d) => (ut += d));
    // Startar den ändå lyssnar den för alltid – döda den och rapportera det.
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.on('close', (kod) => {
      clearTimeout(timer);
      resolve({ kod, ut });
    });
  });
}

test('tjänsten vägrar starta utan lösenord', async () => {
  const { kod, ut } = await start({});
  assert.notEqual(kod, 0, `startade utan MEOS_PASSWORD:\n${ut}`);
  assert.match(ut, /MEOS_PASSWORD/, 'felet ska säga vilken variabel som saknas');
  assert.match(ut, /ALLOW_NO_PASSWORD/, 'och hur man medvetet kör utan');
});

/**
 * Reservspåret i KRAV-12 – tjänsten på tävlingsdatorn i ett eget nätverk utan
 * internet – har ingen nytta av ett lösenord. Det ska gå att köra så, men som
 * ett uttalat val.
 */
test('ALLOW_NO_PASSWORD låter den starta ändå, med en varning', async () => {
  const { kod, ut } = await start({ ALLOW_NO_PASSWORD: '1' }, { timeoutMs: 3000 });
  assert.match(ut, /lyssnar på/, `startade inte:\n${ut}`);
  assert.match(ut, /VARNING/, 'ett öppet skrivläge ska varnas om');
  assert.notEqual(kod, 0, 'processen dödades av testet, inte av sig själv');
});

test('med lösenord startar den som vanligt', async () => {
  const { ut } = await start({ MEOS_PASSWORD: 'hemligt' }, { timeoutMs: 3000 });
  assert.match(ut, /lyssnar på/, `startade inte:\n${ut}`);
  assert.doesNotMatch(ut, /MEOS_PASSWORD är inte satt/);
});

/** En port OS:et nyss gav oss och som vi genast lämnar tillbaka. */
async function ledigPort() {
  const s = net.createServer();
  await new Promise((klar) => s.listen(0, '127.0.0.1', klar));
  const p = s.address().port;
  await new Promise((klar) => s.close(klar));
  return p;
}

/**
 * KRAV-8: inläst data ska överleva en omstart.
 *
 * Sparningen är debouncad och timern är unref:ad, alltså håller den inte
 * processen vid liv. Utan signalhantering avslutas Node direkt på SIGTERM –
 * det Docker och Fly.io skickar vid varje deploy – och det som väntade på att
 * skrivas är borta. MeOS skickar visserligen om var tionde sekund, men efter
 * dagens sista sändning finns ingen som skickar om.
 */
test('en omstart tappar inte det som väntade på att skrivas', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-sigterm-'));
  const { MOP_COMPLETE } = await import('./fixtures/mop.js');

  const proc = spawn(process.execPath, ['index.js'], {
    cwd: ROT,
    env: {
      PATH: process.env.PATH,
      PORT: String(await ledigPort()),
      DOTENV_CONFIG_PATH: path.join(ROT, '.env.finns-inte'),
      MEOS_PASSWORD: 'hemligt',
      DATA_DIR: dataDir,
    },
  });

  // Vänta ut startraden och läs porten ur den
  const port = await new Promise((klar, fel) => {
    let ut = '';
    proc.stdout.on('data', (d) => {
      ut += d;
      const m = ut.match(/lyssnar på http:\/\/localhost:(\d+)/);
      if (m) klar(Number(m[1]));
    });
    proc.on('close', () => fel(new Error(`tjänsten dog vid start:\n${ut}`)));
  });

  const svar = await fetch(`http://127.0.0.1:${port}/meos`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1', pwd: 'hemligt' },
    body: MOP_COMPLETE,
  });
  assert.equal(await svar.text(), 'OK');

  // Direkt efter mottagningen, innan debouncen hunnit spara
  const avslutad = new Promise((r) => proc.on('close', r));
  proc.kill('SIGTERM');
  assert.equal(await avslutad, 0, 'SIGTERM ska ge en ren avslutning');

  const fil = path.join(dataDir, 'tavlingar', '1.json');
  assert.ok(fs.existsSync(fil), 'ingenting skrevs till disk – tävlingen är borta');
  const sparat = JSON.parse(fs.readFileSync(fil, 'utf8'));
  assert.equal(
    sparat?.info?.name,
    'Testtävlingen',
    'tävlingen nådde aldrig disken innan processen avslutades'
  );
});
