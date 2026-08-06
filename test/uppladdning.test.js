import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';
import { IOF_RESULTLIST } from './fixtures/iof.js';

/**
 * KRAV-11: uppladdningsskriptet på tävlingsdatorn.
 *
 * `.bat`-versionen kan bara provköras manuellt på Windows, men `.sh` speglar
 * samma logik och går att köra här – så beteendet som betyder något (ge inte
 * upp vid ett felsvar) bevakas åtminstone i en av dem.
 */

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tools',
  'ladda-upp-resultat.sh'
);

async function startServer(opts = {}) {
  const app = createApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** Kör skriptet i `ms` millisekunder och returnera dess utskrifter. */
function körSkript(args, ms) {
  return new Promise((resolve) => {
    const proc = spawn('bash', [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let ut = '';
    proc.stdout.on('data', (d) => (ut += d));
    proc.stderr.on('data', (d) => (ut += d));
    const timer = setTimeout(() => proc.kill('SIGKILL'), ms);
    proc.on('close', () => {
      clearTimeout(timer);
      resolve(ut);
    });
  });
}

function tempFil(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-upp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fil = path.join(dir, 'resultat.xml');
  fs.writeFileSync(fil, IOF_RESULTLIST);
  return fil;
}

test('fel lösenord ger nya försök i stället för tystnad', async (t) => {
  const { server, base } = await startServer({ password: 'ratt' });
  t.after(() => server.close());
  const fil = tempFil(t);

  const ut = await körSkript([fil, base, '1', 'fel', '1'], 3500);
  const försök = (ut.match(/BADPWD/g) || []).length;
  assert.ok(
    försök >= 2,
    `skriptet ska fortsätta försöka efter ett felsvar, gjorde ${försök} försök:\n${ut}`
  );
});

test('serverfel ger nya försök', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-upp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fil = path.join(dir, 'trasig.xml');
  fs.writeFileSync(fil, 'inte xml alls'); // ger ERROR från tjänsten

  const ut = await körSkript([fil, base, '1', '', '1'], 3500);
  const försök = (ut.match(/ERROR/g) || []).length;
  assert.ok(försök >= 2, `förväntade nya försök efter ERROR, fick ${försök}:\n${ut}`);
});

test('en lyckad uppladdning laddas inte upp igen i onödan', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const fil = tempFil(t);

  const ut = await körSkript([fil, base, '1', '', '1'], 3500);
  const ok = (ut.match(/OK/g) || []).length;
  assert.equal(ok, 1, `oförändrad fil ska laddas upp en gång, laddades ${ok} gånger:\n${ut}`);

  const r = await (await fetch(`${base}/api/receipt?card=123456`)).json();
  assert.equal(r.runner.name, 'Anna Andersson');
});

test('en ändrad fil laddas upp på nytt', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const fil = tempFil(t);

  const proc = körSkript([fil, base, '1', '', '1'], 4500);
  await new Promise((r) => setTimeout(r, 1800));
  // Ändra Annas första sträcktid 450 s -> 500 s. Namn uppdateras avsiktligt
  // inte av en resultatfil (MOP äger dem), så tiden är det som ska följa med.
  fs.writeFileSync(
    fil,
    IOF_RESULTLIST.replace(
      '<SplitTime><ControlCode>31</ControlCode><Time>450</Time></SplitTime>',
      '<SplitTime><ControlCode>31</ControlCode><Time>500</Time></SplitTime>'
    )
  );
  const ut = await proc;

  assert.ok((ut.match(/OK/g) || []).length >= 2, `ändringen ska ge ny uppladdning:\n${ut}`);
  const r = await (await fetch(`${base}/api/receipt?card=123456`)).json();
  assert.equal(r.splits[0].elapsed, '8:20', 'den nya sträcktiden ska ha slagit igenom');
});

/**
 * De tre varianterna ska följas åt (KRAV-11).
 *
 * `.sh` provkörs ovan, men rättningen "räkna filen som uppladdad först vid OK"
 * gjordes bara i `.sh` och `.bat` – PowerShell-varianten behöll buggen i nio
 * iterationer utan att något märkte det, eftersom varken den eller `.bat` går
 * att köra här. Textkontrollen nedan är trubbig, men den fångar just det som
 * hände: en fix som inte följde med till alla varianter.
 */
test('alla uppladdningsvarianter har kvar de beteenden kravet slår fast', () => {
  const varianter = {
    'ladda-upp-resultat.sh': { ok: /=\s*"OK"/, tvinga: /TVINGA/ },
    'ladda-upp-resultat.bat': { ok: /=="OK"/, tvinga: /TVINGA/ },
    'LaddaUppResultat.ps1': { ok: /-eq\s*'OK'/, tvinga: /TvingaEfter/ },
  };
  for (const [fil, mönster] of Object.entries(varianter)) {
    const kod = fs.readFileSync(path.join(path.dirname(SCRIPT), fil), 'utf8');
    assert.match(
      kod,
      mönster.ok,
      `${fil} räknar inte filen som uppladdad först vid OK – ett BADPWD eller ` +
        'ERROR tystar då uppladdningen resten av tävlingen'
    );
    assert.match(
      kod,
      mönster.tvinga,
      `${fil} laddar aldrig upp om en fil som ser oförändrad ut – ` +
        'ändringsdetektorn bygger på tidsstämpel och kan missa en ändring'
    );
  }
});
