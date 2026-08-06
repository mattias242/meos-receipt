/**
 * Bygger en fristående körbar fil av kvittotjänsten med Node SEA
 * (Single Executable Application) – ingen Node-installation behövs på
 * tävlingsdatorn (KRAV-12).
 *
 *   npm run build:exe        – bygger för den plattform du står på och röktestar
 *   npm run build:exe:win    – bygger meos-kvitto.exe för Windows x64
 *
 * Resultatet hamnar i dist/paket/: körbar fil + public/ + start.bat.
 * Windows-bygget laddar ner officiella node.exe från nodejs.org (cachas i
 * dist/cache/) och kan köras från valfri plattform.
 */
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(rot, 'dist');
const paket = path.join(dist, 'paket');
const forWindows = process.argv.includes('--windows');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

fs.rmSync(paket, { recursive: true, force: true });
fs.mkdirSync(paket, { recursive: true });

console.log('1/5 Bundlar servern (esbuild)...');
await build({
  entryPoints: [path.join(rot, 'index.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(dist, 'bundle.cjs'),
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: {
    js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;",
  },
  logLevel: 'warning',
});

console.log('2/5 Skapar SEA-blob...');
const seaConfig = path.join(dist, 'sea-config.json');
fs.writeFileSync(
  seaConfig,
  JSON.stringify({
    main: path.join(dist, 'bundle.cjs'),
    output: path.join(dist, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
  })
);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

console.log('3/5 Hämtar basbinär...');
let exe;
if (forWindows) {
  exe = path.join(paket, 'meos-kvitto.exe');
  const cache = path.join(dist, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const cachad = path.join(cache, `node-${process.version}-win-x64.exe`);
  if (!fs.existsSync(cachad)) {
    const url = `https://nodejs.org/dist/${process.version}/win-x64/node.exe`;
    console.log(`   laddar ner ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Kunde inte hämta node.exe: HTTP ${res.status}`);
    fs.writeFileSync(cachad, Buffer.from(await res.arrayBuffer()));
  }
  fs.copyFileSync(cachad, exe);
} else {
  exe = path.join(paket, process.platform === 'win32' ? 'meos-kvitto.exe' : 'meos-kvitto');
  fs.copyFileSync(process.execPath, exe);
  fs.chmodSync(exe, 0o755);
}

console.log('4/5 Injicerar applikationen (postject)...');
const postjectArgs = [
  path.join(rot, 'node_modules', 'postject', 'dist', 'cli.js'),
  exe,
  'NODE_SEA_BLOB',
  path.join(dist, 'sea-prep.blob'),
  '--sentinel-fuse', SENTINEL,
];
if (!forWindows && process.platform === 'darwin') {
  postjectArgs.push('--macho-segment-name', 'NODE_SEA');
}
execFileSync(process.execPath, postjectArgs, { stdio: 'inherit' });

// Statiska filer + startskript bredvid exen
fs.cpSync(path.join(rot, 'public'), path.join(paket, 'public'), { recursive: true });
fs.writeFileSync(
  path.join(paket, 'start.bat'),
  '@echo off\r\n' +
    'cd /d %~dp0\r\n' +
    'rem Andra vid behov:\r\n' +
    'set PORT=3000\r\n' +
    'rem set MEOS_PASSWORD=hemligt\r\n' +
    'meos-kvitto.exe\r\n' +
    'pause\r\n'
);
fs.writeFileSync(
  path.join(paket, 'LASMIG.txt'),
  'MeOS digitalt kvitto - fristaende server\r\n' +
    '\r\n' +
    '1. Dubbelklicka pa start.bat (eller kor meos-kvitto.exe).\r\n' +
    '2. Tillat programmet i Windows-brandvaggen nar frågan kommer\r\n' +
    '   (kryssa i "privata natverk" och vid publikt wifi aven "publika").\r\n' +
    '3. Fonstret visar vilka adresser lopare nar kvittosidan pa.\r\n' +
    '4. Peka MeOS Onlineresultat mot http://localhost:3000/meos\r\n' +
    '   och/eller kor ladda-upp-resultat.bat mot http://localhost:3000\r\n'
);

if (forWindows) {
  console.log('5/5 Klart (Windows-exe kan inte röktestas här).');
  console.log(`\nPaketet ligger i ${paket} – kopiera hela mappen till tävlingsdatorn.`);
} else {
  console.log('5/5 Röktestar den byggda binären...');
  const port = 3777;
  const proc = spawn(exe, [], {
    env: { ...process.env, PORT: String(port), DATA_DIR: '', NODE_ENV: 'production' },
    stdio: 'ignore',
  });
  try {
    let ok = false;
    for (let i = 0; i < 50 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        ok = res.ok && (await res.json()).ok === true;
      } catch { /* servern uppe snart */ }
    }
    if (!ok) throw new Error('Binären svarade inte på /api/health');
    const sida = await fetch(`http://127.0.0.1:${port}/`);
    if (!(await sida.text()).includes('Digitalt kvitto')) {
      throw new Error('Kvittosidan levererades inte från paketet');
    }
    console.log('   OK – binären svarar och levererar kvittosidan.');
  } finally {
    proc.kill();
  }
  console.log(`\nPaketet ligger i ${paket}.`);
}
