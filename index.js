import 'dotenv/config';
import { createApp } from './server.js';
import { lanUrls } from './lib/lan.js';
import { createMailerFromEnv } from './lib/mailer.js';

const port = parseInt(process.env.PORT || '3000', 10);
const dataDir = process.env.DATA_DIR || './data';
const password = process.env.MEOS_PASSWORD || '';
// KRAV-14: gallring av tävlingsdata. 0 stänger av den.
const retentionDays = parseInt(process.env.RETENTION_DAYS ?? '90', 10);

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

const app = createApp({ dataDir, password, retentionDays, mailer });
app.listen(port, () => {
  console.log(`MeOS digitalt kvitto lyssnar på http://localhost:${port}`);
  console.log('MeOS onlineresultat (MOP) tas emot på POST /meos, resultatfiler på POST /iof');
  const urls = lanUrls(port);
  if (urls.length) {
    console.log('');
    console.log('Löpare når kvittosidan via arenans wifi på:');
    for (const url of urls) console.log(`  ${url}`);
  }
});
