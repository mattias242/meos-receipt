import 'dotenv/config';
import { createApp } from './server.js';
import { lanUrls } from './lib/lan.js';
import { createMailerFromEnv } from './lib/mailer.js';
import { tolkaVardnamnTavlingar } from './lib/vardnamn.js';

const port = parseInt(process.env.PORT || '3000', 10);
const dataDir = process.env.DATA_DIR || './data';
const password = process.env.MEOS_PASSWORD || '';
// KRAV-14: gallring av tävlingsdata. 0 stänger av den.
const retentionDays = parseInt(process.env.RETENTION_DAYS ?? '90', 10);
// KRAV-16: antal proxyhopp framför tjänsten, så att takt-begränsaren ser
// löparen och inte proxyn. 0/tomt = ingen proxy (lita inte på headern).
const trustProxy = parseInt(process.env.TRUST_PROXY || '0', 10) || false;
// KRAV-5: hur många olika löpare en klient får se per kvart. Taket räknar
// personer och inte anrop, så en kvittosida som pollar kostar 1. Högt satt med
// mobilnätet i åtanke – operatörer lägger många abonnenter bakom samma adress,
// så på en arena kan hundratals löpare dela IP. 0 stänger av det.
const readLimit = parseInt(process.env.READ_LIMIT ?? '1000', 10);

// KRAV-20: värdnamn bundna till en bestämd tävling, så att arrangören kan trycka
// klubbens egen adress i PM. Formatet är kvitto.klubben.se=26082002, flera
// åtskilda med komma. Hör till driften och inte till tävlingsdatan – MeOS
// nollställer tävlingens JSON vid varje MOPComplete.
const vardnamnTavlingar = tolkaVardnamnTavlingar(process.env.VARDNAMN_TAVLINGAR);
for (const [vardnamn, cid] of vardnamnTavlingar) {
  console.log(`Värdnamnet ${vardnamn} är bundet till tävling ${cid}`);
}

// KRAV-13: tjänsten ligger på internet. Utan lösenord kontrolleras ingen
// pwd-header, och en enda MOPComplete från vem som helst ersätter hela
// tävlingen mitt under loppet. Att bara varna hamnade i en logg ingen läser –
// att vägra starta märks vid deploy, medan den fungerande versionen står kvar.
// Reservspåret utan internet (KRAV-12) kör medvetet öppet med ALLOW_NO_PASSWORD.
if (!password && process.env.ALLOW_NO_PASSWORD !== '1') {
  console.error(
    'MEOS_PASSWORD är inte satt. Utan lösenord kan vem som helst skicka in ' +
      'tävlingsdata till /meos och /iof och skriva över tävlingen.\n' +
      'Sätt MEOS_PASSWORD (samma värde som i MeOS Onlineresultat), eller kör ' +
      'ALLOW_NO_PASSWORD=1 om tjänsten står i ett eget nätverk utan internet.'
  );
  process.exit(1);
}
if (!password) {
  console.warn('VARNING: MEOS_PASSWORD är inte satt – alla kan skicka data till /meos.');
}

// KRAV-16: e-postutskick via Mailgun. Saknas credentials är funktionen av.
const mailer = createMailerFromEnv();
if (!mailer) {
  console.warn('E-postutskick av kvitto är avstängt (MAILGUN_SMTP/USER/PWD saknas).');
}

const app = createApp({
  dataDir,
  password,
  retentionDays,
  mailer,
  trustProxy,
  readLimit,
  vardnamnTavlingar,
});
const server = app.listen(port, () => {
  // Den bundna porten, inte den önskade: med PORT=0 väljer OS:et en ledig.
  const bunden = server.address().port;
  console.log(`MeOS digitalt kvitto lyssnar på http://localhost:${bunden}`);
  console.log('MeOS onlineresultat (MOP) tas emot på POST /meos, resultatfiler på POST /iof');
  const urls = lanUrls(port);
  if (urls.length) {
    console.log('');
    console.log('Löpare når kvittosidan via arenans wifi på:');
    for (const url of urls) console.log(`  ${url}`);
  }
});

// Docker och Fly.io skickar SIGTERM vid varje deploy. Utan det här avslutas
// Node direkt, och sparningen – som är debouncad och unref:ad för att inte
// hålla processen vid liv – hinner aldrig skriva. MeOS skickar visserligen om
// var tionde sekund, men efter dagens sista sändning finns ingen som gör det.
let avslutar = false;
function avsluta(signal) {
  if (avslutar) return;
  avslutar = true;
  console.log(`${signal} mottaget – skriver kvar data och avslutar.`);
  // Skriv först: en anslutning som inte vill stänga får inte kosta tävlingsdata.
  app.locals.store.close();
  server.close(() => process.exit(0));
  // Kvittosidan pollar var 15:e sekund, så det finns nästan alltid en öppen
  // anslutning. Vänta inte ut den – datan är redan skriven.
  setTimeout(() => process.exit(0), 5000).unref();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => avsluta(signal));
