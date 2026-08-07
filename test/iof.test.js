import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIofResultList, applyIof } from '../lib/iof.js';
import { createStore } from '../lib/store.js';
import { applyMop } from '../lib/mop.js';
import { buildReceipt } from '../lib/receipt.js';
import { createApp } from '../server.js';
import { MOP_COMPLETE } from './fixtures/mop.js';
import { IOF_RESULTLIST } from './fixtures/iof.js';

// ---------------------------------------------------------------------------
// Parsning (KRAV-9)
// ---------------------------------------------------------------------------

test('parseIofResultList: event, löpare, brickor och sträcktider', () => {
  const { event, results } = parseIofResultList(IOF_RESULTLIST);
  assert.equal(event.name, 'Testtävlingen');
  assert.equal(event.date, '2026-08-06');
  assert.equal(results.length, 6); // se fixturens huvudkommentar

  const anna = results.find((r) => r.card === 123456);
  assert.equal(anna.name, 'Anna Andersson');
  assert.equal(anna.club, 'OK Skogen');
  assert.equal(anna.className, 'H21');
  assert.equal(anna.status, 'OK');
  assert.equal(anna.st, 360000);   // 10:00:00 i tiondelar sedan midnatt
  assert.equal(anna.rt, 21000);    // 2100 s -> tiondelar
  assert.equal(anna.splits.length, 5);
  assert.deepEqual(anna.splits[0], { code: 31, rt: 4500, status: 'ok' });
  // Extra stämplingar ligger sist i filen, i MeOS egen ordning.
  assert.deepEqual(anna.splits[4], { code: 77, rt: 10000, status: 'additional' });

  const carl = results.find((r) => r.card === 111111);
  assert.equal(carl.status, 'MissingPunch');
  const missing = carl.splits.find((s) => s.code === 45);
  assert.deepEqual(missing, { code: 45, rt: 0, status: 'missing' });
});

// ---------------------------------------------------------------------------
// Sammanslagning och kvitto (KRAV-9, KRAV-10)
// ---------------------------------------------------------------------------

async function startServer(opts = {}) {
  const app = createApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

async function post(base, url, xml, headers = {}) {
  const res = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1', ...headers },
    body: xml,
  });
  return res.text();
}

test('IOF-fil kompletterar MOP-data: alla stämplingar på kvittot', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const r = await (await fetch(`${base}/api/receipt?card=123456`)).json();
  assert.deepEqual(
    r.splits.map((s) => s.name),
    ['31', '32', '77', '45', '50', 'Mål']
  );
  assert.equal(r.splits[2].status, 'additional');
  assert.equal(r.splits[0].elapsed, '7:30');
  assert.equal(r.splits[0].clock, '10:07:30');
  // Extra stämplingen sorteras in kronologiskt och sträcktiderna följer med
  assert.equal(r.splits[2].leg, '1:40'); // 77: 1000 s - 900 s
  assert.equal(r.splits[3].leg, '5:50'); // 45: 1350 s - 1000 s
  assert.equal(r.splits[5].leg, '5:00'); // Mål: 2100 s - 1800 s
  // MOP-data ska inte skrivas över
  assert.equal(r.result.statusText, 'Godkänd');
  assert.equal(r.result.place, 2);
});

// KRAV-10: MeOS exporterar hela banan som Missing för den som brutit utan att
// stämpla. En tabell med enbart streck säger löparen ingenting – då ska
// sträcktabellen utelämnas helt. Har någon kontroll en tid visas den som vanligt.
test('utgått utan stämplingar ger ingen sträcktabell', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const r = await (await fetch(`${base}/api/receipt?card=222222`)).json();
  assert.equal(r.result.statusText, 'Utgått');
  assert.deepEqual(r.splits, [], 'en tabell med bara streck ska inte visas');
  assert.equal(r.result.startTime, '10:00:00', 'löparen startade faktiskt');
});

test('utgått efter några kontroller behåller sina stämplingar', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const r = await (await fetch(`${base}/api/receipt?card=555555`)).json();
  assert.equal(r.result.statusText, 'Utgått');
  assert.deepEqual(r.splits.map((s) => s.name), ['31', '32', '45']);
  assert.equal(r.splits[0].elapsed, '7:00');
  assert.equal(r.splits[2].status, 'missing');
  assert.equal(r.splits.at(-1).name, '45', 'ingen målrad utan måltid');
});

// KRAV-10: en gammal stämpling i brickan (eller en kontrollenhet med fel
// klocka) ger en sträcktid långt utanför loppet. Den ska inte visas som tid,
// och nästa sträcka ska räknas från föregående giltiga stämpling – annars
// blir både den raden och nästa obrukbara. I den skarpa Vinterrace-filen
// drabbade det 40 av 110 löpare.
test('stämplingstid utanför loppet ignoreras utan att förstöra nästa sträcka', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const r = await (await fetch(`${base}/api/receipt?card=666666`)).json();
  assert.equal(r.result.statusText, 'Godkänd');
  assert.deepEqual(r.splits.map((s) => s.name), ['31', '32', '45', '50', 'Mål']);

  const trasig = r.splits[1];
  assert.equal(trasig.elapsed, '', 'tiden ligger utanför loppet');
  assert.equal(trasig.leg, '');
  assert.equal(trasig.clock, '');

  // Nästa kontroll räknas från 31 (300 s), inte från den trasiga tiden
  assert.equal(r.splits[2].leg, '10:00');   // 900 - 300
  assert.equal(r.splits[2].elapsed, '15:00');
  assert.equal(r.splits[3].leg, '10:00');   // 1500 - 900
  assert.equal(r.splits.at(-1).leg, '5:00'); // Mål: 1800 - 1500
});

test('IOF-fil fyller i status och måltid för löpare utan MOP-resultat', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await post(base, '/meos', MOP_COMPLETE);
  await post(base, '/iof', IOF_RESULTLIST);

  // Carl var "på banan" i MOP (stat=0) men felstämplad enligt resultatfilen
  const r = await (await fetch(`${base}/api/receipt?card=111111`)).json();
  assert.equal(r.result.statusText, 'Felstämplad');
  assert.equal(r.result.startTime, '10:20:00');
  assert.equal(r.result.finishTime, '10:50:00');
  const missing = r.splits.find((s) => s.name === '45');
  assert.equal(missing.status, 'missing');
  assert.equal(missing.elapsed, '');
});

test('IOF-fil skapar löpare som saknas i MOP-datat', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await post(base, '/meos', MOP_COMPLETE);
  await post(base, '/iof', IOF_RESULTLIST);

  const res = await fetch(`${base}/api/receipt?card=333333`);
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.runner.name, 'Frida Frisk');
  assert.equal(r.runner.club, 'OK Skogen');
  assert.equal(r.runner.class, 'D21');
  assert.equal(r.result.statusText, 'Godkänd');
});

// KRAV-2/KRAV-9: MeOS skickar en ny MOPComplete varje gång Onlineresultat
// startas om. Den nollställer MOP-datat, men stämplingarna kommer från
// resultatfilen och har en egen källa – utan detta tappar kvittot alla
// stämplingar tills uppladdningsskriptet hinner skicka filen igen, och för
// gott om tävlingen redan är avslutad.
test('stämplingar från resultatfilen överlever en ny MOPComplete', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const före = await (await fetch(`${base}/api/receipt?card=123456`)).json();
  assert.deepEqual(före.splits.map((s) => s.name), ['31', '32', '77', '45', '50', 'Mål']);

  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');

  const efter = await (await fetch(`${base}/api/receipt?card=123456`)).json();
  assert.deepEqual(
    efter.splits.map((s) => s.name),
    ['31', '32', '77', '45', '50', 'Mål'],
    'stämplingarna ska inte falla tillbaka till radiotider'
  );
  assert.equal(efter.splits[2].status, 'additional');
  assert.equal(efter.splits[0].leg, '7:30');
});

// Stämplingar bevaras över en MOPComplete (KRAV-2), men bara inom samma
// tävling. Tävlings-id återanvänds ofta mellan tävlingar, och då skulle förra
// veckans sträcktider annars följa med in på nästa veckas kvitton.
test('stämplingar följer inte med till en ny tävling på samma id', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const vecka1 = await (await fetch(`${base}/api/receipt?card=123456`)).json();
  assert.deepEqual(vecka1.splits.map((s) => s.name), ['31', '32', '77', '45', '50', 'Mål']);

  // Nästa vecka: ny tävling, men samma tävlings-id i MeOS
  const nästaVecka = MOP_COMPLETE
    .replace('Testtävlingen', 'Nästa veckas tävling')
    .replace('date="2026-08-06"', 'date="2026-08-13"');
  assert.equal(await post(base, '/meos', nästaVecka), 'OK');

  const vecka2 = await (await fetch(`${base}/api/receipt?card=123456`)).json();
  assert.equal(vecka2.competition.date, '2026-08-13');
  assert.deepEqual(
    vecka2.splits.map((s) => s.name),
    ['Radio 1', 'Förvarning', 'Mål'],
    'bara den nya tävlingens radiotider – inte förra veckans stämplingar'
  );
});

test('MOPComplete nollställer fortfarande MOP-ägd data', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  // En tävling utan löpare ska tömma deltagarlistan trots bevarade stämplingar
  assert.equal(
    await post(base, '/meos', MOP_COMPLETE.replace(/<cmp[\s\S]*?<\/cmp>/g, '')),
    'OK'
  );
  const res = await fetch(`${base}/api/receipt?card=123456`);
  assert.equal(res.status, 404, 'löparen fanns inte i den nya sändningen');
});

// KRAV-9: en löpare som bara finns i resultatfilen får ett påhittat id. Kommer
// samma bricka senare från MeOS – vanligt vid efteranmälan – fanns hen plötsligt
// två gånger, och kvitto-API:t svarade med en "delad bricka"-lista med två
// identiska namn där den ena posten hade stämplingarna och den andra tiderna.
test('efteranmäld löpare ersätter platshållaren från resultatfilen', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  // Frida finns bara i resultatfilen och har fått ett påhittat id
  const före = await (await fetch(`${base}/api/receipt?card=333333`)).json();
  assert.equal(före.runner.name, 'Frida Frisk');

  // MeOS skickar henne som efteranmälan med sitt eget id
  const diff = `<?xml version="1.0"?><MOPDiff xmlns="http://www.melin.nu/mop">
    <cmp id="55" card="333333"><base org="5" cls="2" stat="1" st="363000" rt="24000">Frida Frisk</base></cmp>
  </MOPDiff>`;
  assert.equal(await post(base, '/meos', diff), 'OK');

  const res = await fetch(`${base}/api/receipt?card=333333`);
  assert.equal(res.status, 200, 'ska inte bli en "delad bricka"-lista');
  const efter = await res.json();
  assert.equal(efter.runner.id, 55, 'MeOS-löparen ska ta över');
  assert.equal(efter.result.time, '40:00', 'med MeOS tider');
  assert.deepEqual(
    efter.splits.map((s) => s.name),
    ['31', 'Mål'],
    'och ärva stämplingarna från resultatfilen'
  );
});

// Löparen kan ha delat sin kvittolänk innan MeOS-datat kom – länken bygger på
// löpar-id, och när platshållaren ersätts skulle den annars ge 404.
test('delad länk fungerar efter att platshållaren ersatts', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const före = await (await fetch(`${base}/api/receipt?card=333333`)).json();
  const delatId = före.runner.id;
  assert.equal(
    (await fetch(`${base}/api/receipt?cmp=1&id=${delatId}`)).status,
    200,
    'länken fungerar innan'
  );

  const diff = `<?xml version="1.0"?><MOPDiff xmlns="http://www.melin.nu/mop">
    <cmp id="55" card="333333"><base org="5" cls="2" stat="1" st="363000" rt="24000">Frida Frisk</base></cmp>
  </MOPDiff>`;
  assert.equal(await post(base, '/meos', diff), 'OK');

  const res = await fetch(`${base}/api/receipt?cmp=1&id=${delatId}`);
  assert.equal(res.status, 200, 'den delade länken ska fortsätta fungera');
  const efter = await res.json();
  assert.equal(efter.runner.name, 'Frida Frisk');
  assert.equal(efter.runner.id, 55, 'och leda till den aktuella posten');
});

// MeOS skickar en ny MOPComplete varje gång Onlineresultat startas om. Utan
// att kopplingen från ersatta id:n bevaras dör den delade länken där.
test('delad länk överlever också en omstart av Onlineresultat', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');

  const delatId = (await (await fetch(`${base}/api/receipt?card=333333`)).json()).runner.id;
  const diff = `<?xml version="1.0"?><MOPDiff xmlns="http://www.melin.nu/mop">
    <cmp id="55" card="333333"><base org="5" cls="2" stat="1" st="363000" rt="24000">Frida Frisk</base></cmp>
  </MOPDiff>`;
  assert.equal(await post(base, '/meos', diff), 'OK');
  assert.equal((await fetch(`${base}/api/receipt?cmp=1&id=${delatId}`)).status, 200);

  // Onlineresultat startas om. Nu är Frida med i deltagarlistan – annars vore
  // 404 rätt svar, eftersom hon då inte längre är anmäld.
  const medFrida = MOP_COMPLETE.replace(
    '</MOPComplete>',
    '  <cmp id="55" card="333333"><base org="5" cls="2" stat="1" st="363000" rt="24000">Frida Frisk</base></cmp>\n</MOPComplete>'
  );
  assert.equal(await post(base, '/meos', medFrida), 'OK');

  const res = await fetch(`${base}/api/receipt?cmp=1&id=${delatId}`);
  assert.equal(res.status, 200, 'länken ska fungera även efter MOPComplete');
  assert.equal((await res.json()).runner.id, 55);
});

test('kopplingen följer inte med till en ny tävling på samma id', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/iof', IOF_RESULTLIST), 'OK');
  const delatId = (await (await fetch(`${base}/api/receipt?card=333333`)).json()).runner.id;
  const diff = `<?xml version="1.0"?><MOPDiff xmlns="http://www.melin.nu/mop">
    <cmp id="55" card="333333"><base org="5" cls="2" stat="1" st="363000" rt="24000">Frida Frisk</base></cmp>
  </MOPDiff>`;
  assert.equal(await post(base, '/meos', diff), 'OK');

  // Nästa veckas tävling återanvänder tävlings-id
  const nästa = MOP_COMPLETE
    .replace('Testtävlingen', 'Nästa veckas tävling')
    .replace('date="2026-08-06"', 'date="2026-08-13"');
  assert.equal(await post(base, '/meos', nästa), 'OK');

  const res = await fetch(`${base}/api/receipt?cmp=1&id=${delatId}`);
  assert.equal(res.status, 404, 'förra tävlingens länkar hör inte hemma i den nya');
});

test('två löpare som verkligen delar bricka påverkas inte', async (t) => {
  const { base, server } = await startServer();
  t.after(() => server.close());
  assert.equal(await post(base, '/meos', MOP_COMPLETE), 'OK');
  // Två MeOS-löpare med samma bricka är legitimt (KRAV-7)
  const diff = `<?xml version="1.0"?><MOPDiff xmlns="http://www.melin.nu/mop">
    <cmp id="60" card="123456"><base org="5" cls="2" stat="0" st="0" rt="0">Erik Ek</base></cmp>
  </MOPDiff>`;
  assert.equal(await post(base, '/meos', diff), 'OK');

  const res = await fetch(`${base}/api/receipt?card=123456`);
  assert.equal(res.status, 300, 'delad bricka ska fortfarande ge en valbar lista');
  assert.equal((await res.json()).alternatives.length, 2);
});

// KRAV-9: pekar uppladdningsprogrammet på förra tävlingens fil matchar
// brickorna – det är samma löpare – och stämplingarna skrivs över med fel
// lopps tider, utan att något säger ifrån. Datumet i filen avslöjar det.
test('resultatfil från en annan tävlingsdag varnar', async (t) => {
  const store = createStore();
  applyMop(store, 1, MOP_COMPLETE);

  const varningar = [];
  const original = console.warn;
  console.warn = (...a) => varningar.push(a.join(' '));
  t.after(() => { console.warn = original; });

  applyIof(store, 1, IOF_RESULTLIST.replace('<Date>2026-08-06</Date>', '<Date>2026-07-30</Date>'));

  assert.equal(varningar.length, 1, `förväntade en varning, fick ${varningar.length}`);
  assert.match(varningar[0], /2026-07-30/, 'varningen ska nämna filens datum');
  assert.match(varningar[0], /2026-08-06/, 'och tävlingens');
});

test('resultatfil med samma datum varnar inte', async (t) => {
  const store = createStore();
  applyMop(store, 1, MOP_COMPLETE);

  const varningar = [];
  const original = console.warn;
  console.warn = (...a) => varningar.push(a.join(' '));
  t.after(() => { console.warn = original; });

  applyIof(store, 1, IOF_RESULTLIST);
  assert.deepEqual(varningar, []);
});

test('resultatfil utan datum varnar inte', async (t) => {
  const store = createStore();
  applyMop(store, 1, MOP_COMPLETE);

  const varningar = [];
  const original = console.warn;
  console.warn = (...a) => varningar.push(a.join(' '));
  t.after(() => { console.warn = original; });

  applyIof(store, 1, IOF_RESULTLIST.replace('<Date>2026-08-06</Date>', ''));
  assert.deepEqual(varningar, [], 'saknas datum går det inte att avgöra');
});

// KRAV-9: resultatfiler kan komma från andra källor än MeOS resultatautomat,
// eller från framtida versioner med andra fält. Ofullständig data ska ge ett
// magrare kvitto, inte en krasch eller en tävling som slutar fungera.
function minimalResultList(personResult) {
  return `<?xml version="1.0"?><ResultList xmlns="http://www.orienteering.org/datastandard/3.0">
    <Event><Name>Testet</Name></Event>
    <ClassResult><Class><Name>H21</Name></Class>${personResult}</ClassResult>
  </ResultList>`;
}

test('löpare utan klubb tas emot', () => {
  const store = createStore();
  applyIof(store, 1, minimalResultList(
    '<PersonResult><Person><Name><Given>A</Given><Family>B</Family></Name></Person>' +
    '<Result><Status>OK</Status><Time>600</Time><ControlCard>111</ControlCard></Result></PersonResult>'
  ));
  const id = Number(Object.keys(store.competitions[1].competitors)[0]);
  const r = buildReceipt(store.competitions[1], 1, id);
  assert.equal(r.runner.name, 'A B');
  assert.equal(r.runner.club, '', 'saknad klubb blir tom, inte "undefined"');
  assert.equal(r.result.time, '10:00');
});

/**
 * Ett robusthetsfall, inte ett verkligt: en namnlös löpare ska inte fälla
 * tjänsten. Den skarpa Vrace-filen har namn och klubb på alla 110 löpare, och
 * IOF XML 3.0 har namnet som obligatoriskt i Person – händer det ändå är något
 * fel uppströms, och det varnas det numera om (se testet längst ner).
 *
 * Kvittot byggs alltså, men går inte att känna igen på namnet. Bricknumret
 * fyllde den rollen förut; sedan KRAV-5 lämnar det aldrig tjänsten.
 */
test('löpare utan namn får ett kvitto, men inget bricknummer att känna igen det på', () => {
  const store = createStore();
  applyIof(store, 1, minimalResultList(
    '<PersonResult><Person></Person>' +
    '<Result><Status>OK</Status><Time>600</Time><ControlCard>333</ControlCard></Result></PersonResult>'
  ));
  const id = Number(Object.keys(store.competitions[1].competitors)[0]);
  const r = buildReceipt(store.competitions[1], 1, id);
  assert.equal(r.runner.name, '');
  assert.equal(r.runner.card, undefined, 'bricknumret lämnar aldrig tjänsten');
  assert.equal(r.result.time, '10:00', 'resultatet visas ändå');
});

test('löpare utan status behandlas som utan resultat', () => {
  const store = createStore();
  applyIof(store, 1, minimalResultList(
    '<PersonResult><Person><Name><Given>C</Given><Family>D</Family></Name></Person>' +
    '<Result><Time>600</Time><ControlCard>222</ControlCard></Result></PersonResult>'
  ));
  const id = Number(Object.keys(store.competitions[1].competitors)[0]);
  const r = buildReceipt(store.competitions[1], 1, id);
  // Utan status vet vi inte om loppet är godkänt, och då vore det fel att visa
  // en tid som om det vore ett resultat. MeOS skriver alltid status.
  assert.equal(r.result.time, '');
  assert.ok(r.result.statusText, 'någon status visas ändå');
});

test('PersonResult utan Result hoppas över', () => {
  const store = createStore();
  applyIof(store, 1, minimalResultList(
    '<PersonResult><Person><Name><Given>G</Given><Family>H</Family></Name></Person></PersonResult>'
  ));
  assert.deepEqual(store.competitions[1].competitors, {}, 'inget att skapa en löpare av');
});

test('helt tom resultatlista tas emot utan att skapa något', () => {
  const store = createStore();
  applyIof(store, 1, minimalResultList(''));
  assert.deepEqual(store.competitions[1].competitors, {});
  assert.equal(store.competitions[1].info.name, 'Testet', 'tävlingens namn tas ändå emot');
});

test('IOF-endpoint kräver rätt lösenord', async (t) => {
  const { server, base } = await startServer({ password: 'hemligt' });
  t.after(() => server.close());
  assert.equal(await post(base, '/iof', IOF_RESULTLIST, { pwd: 'fel' }), 'BADPWD');
  assert.equal(await post(base, '/iof', IOF_RESULTLIST, { pwd: 'hemligt' }), 'OK');
});

/**
 * KRAV-9: en löpare utan namn betyder att något är fel uppströms.
 *
 * IOF XML 3.0 har namnet som en obligatorisk del av `Person`, och MeOS
 * resultatautomat skriver det alltid – i den skarpa Vrace-filen har alla 110
 * löpare fullständigt namn och klubb. Dyker en namnlös löpare ändå upp är det
 * inget tjänsten ska hantera tyst: kvittot blir omöjligt att känna igen, och
 * orsaken sitter i filen eller i det som skrev den.
 *
 * Samma mönster som de andra varningarna i den här filen: tjänsten tar emot
 * det den får, men säger till arrangören vad som ser fel ut.
 */
test('namnlösa löpare i en resultatfil varnas det om', () => {
  const rader = [];
  const original = console.warn;
  console.warn = (...a) => rader.push(a.join(' '));
  try {
    const store = createStore();
    applyIof(store, 1, minimalResultList(
      '<PersonResult><Person></Person>' +
      '<Result><Status>OK</Status><Time>600</Time><ControlCard>333</ControlCard></Result></PersonResult>' +
      '<PersonResult><Person><Name><Given>A</Given><Family>B</Family></Name></Person>' +
      '<Result><Status>OK</Status><Time>700</Time><ControlCard>334</ControlCard></Result></PersonResult>'
    ));
  } finally {
    console.warn = original;
  }

  const varning = rader.find((r) => /namn/i.test(r));
  assert.ok(varning, `ingen varning om den namnlösa löparen:\n${rader.join('\n')}`);
  assert.match(varning, /1 av 2/, 'varningen ska säga hur många av hur många');
  assert.match(varning, /333/, 'och vilken bricka, så att den går att slå upp i MeOS');
});

test('en fullständig resultatfil varnar inte om namn', () => {
  const rader = [];
  const original = console.warn;
  console.warn = (...a) => rader.push(a.join(' '));
  try {
    const store = createStore();
    applyIof(store, 1, minimalResultList(
      '<PersonResult><Person><Name><Given>A</Given><Family>B</Family></Name></Person>' +
      '<Result><Status>OK</Status><Time>600</Time><ControlCard>111</ControlCard></Result></PersonResult>'
    ));
  } finally {
    console.warn = original;
  }
  assert.deepEqual(rader.filter((r) => /namn/i.test(r)), []);
});
