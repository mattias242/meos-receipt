import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

/**
 * KRAV-12 (utgånget): den fristående exe-filen är kvar som reserv för drift
 * utan internet. Bygget bundlar index.js med esbuild, så ett beroende som inte
 * går att bundla skulle knäcka reservspåret – men först den dag någon faktiskt
 * försöker bygga det, alltså när internet redan saknas.
 *
 * Bundlingen tar ~120 ms, så den får kosta i den vanliga sviten.
 */
test('index.js går att bundla för den fristående exe-filen', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meos-bundle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ut = path.join(dir, 'bundle.cjs');

  const resultat = await build({
    entryPoints: ['index.js'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: ut,
    define: { 'import.meta.url': '__importMetaUrl' },
    banner: {
      js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;",
    },
    logLevel: 'silent',
  });

  assert.deepEqual(resultat.errors, []);
  assert.deepEqual(
    resultat.warnings.map((w) => w.text),
    [],
    'varningar döljer ofta ett beroende som inte följer med'
  );

  const kod = fs.readFileSync(ut, 'utf8');
  assert.ok(kod.length > 100_000, 'bundlen ser för liten ut för att innehålla servern');
  // Modulerna som tillkommit efter att exe-spåret skrevs ska följa med
  for (const spår of ['renderReceiptPdf', 'createMailerFromEnv', 'purgeExpired']) {
    assert.ok(kod.includes(spår), `${spår} saknas i bundlen`);
  }
});
