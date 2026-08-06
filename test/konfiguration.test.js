import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Miljövariabler måste nå ända fram till den miljö som faktiskt körs.
 *
 * docker-compose.yml vidarebefordrade länge bara MEOS_PASSWORD och DATA_DIR,
 * så en deploy startade utan e-postutskick trots att .env såg komplett ut –
 * containern läser inte .env själv. Felet syntes inte i någon test, eftersom
 * testerna kör mot koden direkt. Det här testet stänger den luckan.
 */

const ROT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const läs = (p) => fs.readFileSync(path.join(ROT, p), 'utf8');

/** Variabler som koden läser, med var de hör hemma. */
const VARIABLER = {
  MEOS_PASSWORD: { compose: true, env: true },
  DATA_DIR: { compose: true, env: true },
  PORT: { compose: false, env: true }, // containern exponerar porten i stället
  RETENTION_DAYS: { compose: true, env: true },
  MAILGUN_SMTP: { compose: true, env: true },
  MAILGUN_USER: { compose: true, env: true },
  MAILGUN_PWD: { compose: true, env: true },
  MAILGUN_PORT: { compose: true, env: false }, // valfri, dokumenterad i README
  MAIL_FROM: { compose: true, env: false },
  MAIL_REPLY_TO: { compose: true, env: false },
  PUBLIC_DIR: { compose: false, env: false }, // bara för den paketerade exe-filen
};

/** Alla miljövariabler koden faktiskt läser. */
function lästaVariabler() {
  const filer = ['index.js', 'server.js', ...fs.readdirSync(path.join(ROT, 'lib')).map((f) => `lib/${f}`)];
  const funna = new Set();
  for (const fil of filer) {
    const kod = läs(fil);
    for (const m of kod.matchAll(/(?:process\.)?env\.([A-Z][A-Z0-9_]+)/g)) funna.add(m[1]);
  }
  return funna;
}

test('varje miljövariabel koden läser är känd och placerad', () => {
  for (const namn of lästaVariabler()) {
    assert.ok(
      VARIABLER[namn],
      `${namn} läses i koden men saknas i den här listan – lägg till den ` +
        'och avgör om den behöver skickas till containern och dokumenteras'
    );
  }
});

test('containern får de variabler som styr funktioner', () => {
  const compose = läs('docker-compose.yml');
  for (const [namn, var_] of Object.entries(VARIABLER)) {
    if (!var_.compose) continue;
    assert.match(
      compose,
      new RegExp(`^\\s*${namn}:`, 'm'),
      `${namn} skickas inte vidare i docker-compose.yml – funktionen blir tyst avstängd i drift`
    );
  }
});

test('alla variabler är dokumenterade i README', () => {
  const readme = läs('README.md');
  for (const namn of Object.keys(VARIABLER)) {
    assert.ok(readme.includes(namn), `${namn} saknas i README:s miljövariabeltabell`);
  }
});

test('.env.example speglar det som behövs för att komma igång', () => {
  const exempel = läs('.env.example');
  for (const [namn, var_] of Object.entries(VARIABLER)) {
    if (!var_.env) continue;
    assert.match(exempel, new RegExp(`^#?\\s*${namn}=`, 'm'), `${namn} saknas i .env.example`);
  }
});

/**
 * Containern kör UTC om inget annat sägs. Kvittots tider kommer från
 * MOP-konventionen och är tidszonsoberoende, men "Uppdaterat" formateras med
 * serverns lokala tid – på en UTC-server ser det ut som att kvittot
 * uppdaterades före målgången. Alpine saknar dessutom tidszonsdata, så TZ har
 * ingen effekt utan tzdata.
 */
test('tidszonen är satt i alla driftmiljöer', () => {
  const dockerfile = läs('Dockerfile');
  assert.match(dockerfile, /ENV TZ=/, 'Dockerfile sätter ingen tidszon');
  assert.match(
    dockerfile,
    /tzdata/,
    'alpine behöver tzdata, annars ignoreras TZ tyst'
  );
  assert.match(läs('docker-compose.yml'), /^\s*TZ:/m, 'docker-compose.yml saknar TZ');
  assert.match(läs('fly.toml'), /^\s*TZ\s*=/m, 'fly.toml saknar TZ');
});

test('inga hemligheter ligger i incheckade konfigurationsfiler', () => {
  for (const fil of ['docker-compose.yml', 'fly.toml', '.env.example']) {
    const innehåll = läs(fil);
    // Ett värde efter MAILGUN_PWD som varken är tomt eller en variabelreferens.
    // Måste stanna på raden – \s* skulle svälja radbrytningen och fånga nästa.
    const träff = innehåll.match(/MAILGUN_PWD[ \t]*[:=][ \t]*(.*)$/m);
    if (träff) {
      const värde = träff[1].trim();
      assert.ok(
        värde === '' || värde.startsWith('${') || värde.startsWith('"${'),
        `${fil} ser ut att innehålla ett riktigt lösenord: ${värde}`
      );
    }
  }
});
