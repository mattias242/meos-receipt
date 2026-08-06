import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
