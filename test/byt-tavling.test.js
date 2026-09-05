import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * KRAV-20: peka om värdnamnets bindning inför ett nytt arrangemang.
 *
 * Det här är handgreppet som görs oftast av allt i driften – en gång per
 * tävling – och det görs under tidspress dagarna före start. Att redigera
 * .env för hand är just då som sämst: en andra VARDNAMN_TAVLINGAR-rad ser
 * riktig ut i en diff men gör att den ena tyst vinner över den andra, och
 * felet märks först när löparen står i målfållan och ser fel tävling.
 *
 * Skriptet ska därför vara idempotent: samma bindning skrivs om, andra
 * värdnamn lämnas i fred, och ett ogiltigt id får inte röra filen alls.
 */

const SKRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tools',
  'byt-tavling.sh'
);

const GRUND = [
  '# Lösenord som MeOS skickar',
  'MEOS_PASSWORD=hemligt',
  'TRUST_PROXY=2',
  'HOST_PORT=3459',
  '',
].join('\n');

function medEnv(innehall) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byt-tavling-'));
  const fil = path.join(dir, '.env');
  fs.writeFileSync(fil, innehall);
  return fil;
}

/** Kör skriptet utan att röra någon container. */
function kor(fil, args) {
  const r = spawnSync('bash', [SKRIPT, '--utan-omstart', ...args], {
    env: { ...process.env, ENV_FIL: fil },
    encoding: 'utf8',
  });
  return { kod: r.status, ut: (r.stdout || '') + (r.stderr || ''), env: fs.readFileSync(fil, 'utf8') };
}

/** Bindningsraderna, i den ordning de står i filen. */
const bindningar = (env) => env.split('\n').filter((r) => r.startsWith('VARDNAMN_TAVLINGAR='));

test('lägger till bindningen när den saknas', () => {
  const fil = medEnv(GRUND);
  const r = kor(fil, ['26091401', 'kvitto.klubben.se']);
  assert.equal(r.kod, 0, r.ut);
  assert.deepEqual(bindningar(r.env), ['VARDNAMN_TAVLINGAR=kvitto.klubben.se=26091401']);
});

test('byter tävlings-id utan att skapa en andra rad', () => {
  const fil = medEnv(GRUND + 'VARDNAMN_TAVLINGAR=kvitto.klubben.se=26082002\n');
  const r = kor(fil, ['26091401', 'kvitto.klubben.se']);
  assert.equal(r.kod, 0, r.ut);
  assert.deepEqual(bindningar(r.env), ['VARDNAMN_TAVLINGAR=kvitto.klubben.se=26091401']);
});

test('kört två gånger ger samma resultat som en gång', () => {
  const fil = medEnv(GRUND);
  kor(fil, ['26091401', 'kvitto.klubben.se']);
  const r = kor(fil, ['26091401', 'kvitto.klubben.se']);
  assert.equal(r.kod, 0, r.ut);
  assert.deepEqual(bindningar(r.env), ['VARDNAMN_TAVLINGAR=kvitto.klubben.se=26091401']);
});

test('andra värdnamns bindningar lämnas i fred', () => {
  const fil = medEnv(
    GRUND + 'VARDNAMN_TAVLINGAR=kvitto.klubben.se=26082002,kvitto.grannen.se=26070101\n'
  );
  const r = kor(fil, ['26091401', 'kvitto.klubben.se']);
  assert.equal(r.kod, 0, r.ut);
  assert.deepEqual(bindningar(r.env), [
    'VARDNAMN_TAVLINGAR=kvitto.klubben.se=26091401,kvitto.grannen.se=26070101',
  ]);
});

test('övriga rader i .env rörs inte', () => {
  const fil = medEnv(GRUND + 'VARDNAMN_TAVLINGAR=kvitto.klubben.se=26082002\n');
  const r = kor(fil, ['26091401', 'kvitto.klubben.se']);
  assert.match(r.env, /^MEOS_PASSWORD=hemligt$/m);
  assert.match(r.env, /^TRUST_PROXY=2$/m);
  assert.match(r.env, /^HOST_PORT=3459$/m);
  assert.match(r.env, /^# Lösenord som MeOS skickar$/m);
});

// Id:t hamnar i /t/<id>, som bara släpper igenom siffror (KRAV-18).
test('ett id som inte är siffror avvisas och filen lämnas orörd', () => {
  const fore = GRUND + 'VARDNAMN_TAVLINGAR=kvitto.klubben.se=26082002\n';
  const fil = medEnv(fore);
  const r = kor(fil, ['vt-2026', 'kvitto.klubben.se']);
  assert.notEqual(r.kod, 0);
  assert.equal(r.env, fore, '.env ska vara oförändrad när id:t avvisas');
});

test('utan argument beskriver skriptet hur det används', () => {
  const fil = medEnv(GRUND);
  const r = kor(fil, []);
  assert.notEqual(r.kod, 0);
  assert.match(r.ut, /Användning/i);
});

// Vanligaste fallet: en enda klubb, ett enda värdnamn. Då ska id:t räcka.
test('värdnamnet härleds när det bara finns ett', () => {
  const fil = medEnv(GRUND + 'VARDNAMN_TAVLINGAR=kvitto.klubben.se=26082002\n');
  const r = kor(fil, ['26091401']);
  assert.equal(r.kod, 0, r.ut);
  assert.deepEqual(bindningar(r.env), ['VARDNAMN_TAVLINGAR=kvitto.klubben.se=26091401']);
});

test('med flera bindningar krävs värdnamnet uttryckligen', () => {
  const fore = GRUND + 'VARDNAMN_TAVLINGAR=a.se=1,b.se=2\n';
  const fil = medEnv(fore);
  const r = kor(fil, ['26091401']);
  assert.notEqual(r.kod, 0);
  assert.equal(r.env, fore);
  assert.match(r.ut, /värdnamn/i);
});

test('saknas .env sägs det rakt ut i stället för att en ny skapas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byt-tavling-'));
  const fil = path.join(dir, '.env');
  const r = spawnSync('bash', [SKRIPT, '--utan-omstart', '26091401', 'kvitto.klubben.se'], {
    env: { ...process.env, ENV_FIL: fil },
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.equal(fs.existsSync(fil), false, 'en ny .env utan MEOS_PASSWORD hade hindrat starten');
});

/**
 * Skriptet är ett *serverskript*, men ingenting hindrade att det kördes i en
 * arbetskopia på en utvecklingsmaskin: katalogen heter likadant där. Då hann
 * .env skrivas om innan `docker compose up -d` stupade på att det inte finns
 * någon daemon – arbetskopian fick en bindning den inte skulle ha, och den
 * riktiga bindningen på servern stod kvar orörd fast utskriften sagt att den
 * ändrats. Hände skarpt 2026-09-04 inför Stenungsund-tävlingen.
 *
 * Kontrollen görs därför *före* filen rörs: svarar ingen Docker-daemon, eller
 * finns inte tjänstens container på maskinen, ska .env vara oförändrad.
 */

/** En docker som svarar som vi säger åt den att svara. */
function fejkDocker(dir, { daemon = true, container = true } = {}) {
  const fil = path.join(dir, 'docker');
  fs.writeFileSync(
    fil,
    [
      '#!/bin/bash',
      `[ "$1" = "info" ] && exit ${daemon ? 0 : 1}`,
      `if [ "$1" = "ps" ]; then ${container ? 'echo meos-kvitto' : 'true'}; exit 0; fi`,
      'exit 0',
    ].join('\n')
  );
  fs.chmodSync(fil, 0o755);
  return fil;
}

/** Kör skriptet skarpt – alltså med omstartssteget – mot en fejkad docker. */
function korMedDocker(fil, args, lage) {
  const r = spawnSync('bash', [SKRIPT, ...args], {
    env: { ...process.env, ENV_FIL: fil, DOCKER: fejkDocker(path.dirname(fil), lage) },
    encoding: 'utf8',
  });
  return { kod: r.status, ut: (r.stdout || '') + (r.stderr || ''), env: fs.readFileSync(fil, 'utf8') };
}

test('svarar ingen Docker-daemon vägrar skriptet och lämnar .env orörd', () => {
  const fore = GRUND + 'VARDNAMN_TAVLINGAR=kvitto.klubben.se=26082002\n';
  const fil = medEnv(fore);
  const r = korMedDocker(fil, ['26091401', 'kvitto.klubben.se'], { daemon: false });
  assert.notEqual(r.kod, 0);
  assert.equal(r.env, fore, '.env ska inte ändras på en maskin som inte är servern');
  assert.match(r.ut, /servern/i, 'meddelandet ska säga var skriptet hör hemma');
});

test('finns inte containern på maskinen vägrar skriptet och lämnar .env orörd', () => {
  const fore = GRUND + 'VARDNAMN_TAVLINGAR=kvitto.klubben.se=26082002\n';
  const fil = medEnv(fore);
  const r = korMedDocker(fil, ['26091401', 'kvitto.klubben.se'], { container: false });
  assert.notEqual(r.kod, 0);
  assert.equal(r.env, fore, '.env ska inte ändras när tjänsten inte finns här');
  assert.match(r.ut, /servern/i);
});

// Luckan för den som medvetet bara vill ändra filen – och det testerna ovan
// använder för att slippa en container.
test('--utan-omstart går förbi maskinkontrollen', () => {
  const fil = medEnv(GRUND);
  const r = spawnSync('bash', [SKRIPT, '--utan-omstart', '26091401', 'kvitto.klubben.se'], {
    env: { ...process.env, ENV_FIL: fil, DOCKER: fejkDocker(path.dirname(fil), { daemon: false }) },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
  assert.deepEqual(bindningar(fs.readFileSync(fil, 'utf8')), [
    'VARDNAMN_TAVLINGAR=kvitto.klubben.se=26091401',
  ]);
});
