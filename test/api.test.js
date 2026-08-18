import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import {
  MOP_COMPLETE,
  MOP_DIFF_CARL as MOP_DIFF,
  mopDiffExtraRunner,
  mopCompleteMinimal,
  mopCompleteManyRunners,
} from './fixtures/mop.js';
import { IOF_RESULTLIST } from './fixtures/iof.js';
import { mopStatus } from './helpers/mop-svar.js';

async function startServer(opts = {}) {
  const app = createApp(opts);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

async function postMop(base, xml, headers = {}) {
  const res = await fetch(`${base}/meos`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1', ...headers },
    body: xml,
  });
  return mopStatus(await res.text());
}

test('MOP endpoint validates competition id and password', async (t) => {
  const { server, base } = await startServer({ password: 'hemligt' });
  t.after(() => server.close());

  assert.equal(await postMop(base, MOP_COMPLETE, { competition: '' }), 'BADCMP');
  assert.equal(await postMop(base, MOP_COMPLETE, { pwd: 'fel' }), 'BADPWD');
  assert.equal(await postMop(base, MOP_COMPLETE, { pwd: 'hemligt' }), 'OK');
});

// MeOS sänder inte om okomprimerat, den avbryter – "Packa stora filer" måste
// vara omarkerad i Onlineresultat. Vi svarar NOZIP så att felet blir tydligt.
test('zip payloads get NOZIP', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  assert.equal(await postMop(base, 'PK\x03\x04zipdata'), 'NOZIP');
});

/**
 * KRAV-1: MeOS XML-parsar svaret och letar efter elementet `MOPStatus`. Ett
 * svar den inte kan tolka ger tom status, vilket bryter sändningsloopen efter
 * första klumpen – därför räcker det inte att statuskoden stämmer, formatet
 * måste hållas. Detta är kontraktet i protokollspecifikationen och i Melins
 * referensimplementation (`mop/functions.php`).
 */
test('MOP endpoint answers MOPStatus XML, not plain text', async (t) => {
  const { server, base } = await startServer({ password: 'hemligt' });
  t.after(() => server.close());

  const svara = async (headers) => {
    const res = await fetch(`${base}/meos`, {
      method: 'POST',
      headers: { 'content-type': 'application/xml', competition: '1', ...headers },
      body: MOP_COMPLETE,
    });
    return { typ: res.headers.get('content-type'), kropp: await res.text() };
  };

  const ok = await svara({ pwd: 'hemligt' });
  assert.equal(ok.kropp, '<?xml version="1.0"?><MOPStatus status="OK"></MOPStatus>');
  assert.match(ok.typ, /^application\/xml/);

  // Även avvisade sändningar måste packas in, annars ser MeOS inte varför.
  const fel = await svara({ pwd: 'fel' });
  assert.equal(fel.kropp, '<?xml version="1.0"?><MOPStatus status="BADPWD"></MOPStatus>');
});

// KRAV-9/KRAV-11: /iof ingår inte i MOP. Klienten är vårt eget
// uppladdningsprogram, som matchar på strängen OK, så den svarar ren text.
test('IOF endpoint keeps the plain text reply the upload script matches on', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const res = await fetch(`${base}/iof`, {
    method: 'POST',
    headers: { 'content-type': 'application/xml', competition: '1' },
    body: IOF_RESULTLIST,
  });
  assert.equal(await res.text(), 'OK');
  assert.match(res.headers.get('content-type'), /^text\/plain/);
});

test('receipt by card number: result, placement, splits', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  assert.equal(await postMop(base, MOP_COMPLETE), 'OK');

  const res = await fetch(`${base}/api/receipt?card=123456`);
  assert.equal(res.status, 200);
  const r = await res.json();

  assert.equal(r.competition.name, 'Testtävlingen');
  assert.equal(r.runner.name, 'Anna Andersson');
  assert.equal(r.runner.club, 'OK Skogen');
  assert.equal(r.runner.class, 'H21');
  assert.equal(r.result.statusText, 'Godkänd');
  assert.equal(r.result.time, '35:00');           // 21000 tiondelar
  assert.equal(r.result.startTime, '10:00:00');   // 360000 tiondelar
  assert.equal(r.result.finishTime, '10:35:00');
  assert.equal(r.result.place, 2);                // Berit vann på 32:30
  assert.equal(r.result.after, '+2:30');

  assert.equal(r.splits.length, 3); // 2 radio + mål
  assert.deepEqual(r.splits.map((s) => s.name), ['150 (Radio 1)', '162 (Förvarning)', 'Mål']);
  assert.equal(r.splits[0].elapsed, '15:00');
  assert.equal(r.splits[0].clock, '10:15:00');
  assert.equal(r.splits[1].leg, '15:00'); // 18000-9000 tiondelar
  assert.equal(r.splits[2].leg, '5:00');  // mål 21000-18000
});

test('status texts: on course and DNF', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  let r = await (await fetch(`${base}/api/receipt?card=111111`)).json();
  assert.equal(r.result.statusText, 'Ute på banan');
  assert.equal(r.result.time, '');

  r = await (await fetch(`${base}/api/receipt?card=222222`)).json();
  assert.equal(r.result.statusText, 'Utgått');
});

// KRAV-4: den som inte kommit till start ska inte visas med en starttid,
// även om MeOS har en tilldelad sådan – annars ser kvittot ut som en
// genomförd start. Den som brutit efter start behåller sin.
test('starttid visas bara för den som faktiskt startat', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  const ejStart = await (await fetch(`${base}/api/receipt?card=444444`)).json();
  assert.equal(ejStart.result.statusText, 'Ej start');
  assert.equal(ejStart.result.startTime, '', 'ej start ska sakna starttid');
  assert.equal(ejStart.result.finishTime, '');
  assert.equal(ejStart.result.time, '');

  const utgatt = await (await fetch(`${base}/api/receipt?card=222222`)).json();
  assert.equal(utgatt.result.startTime, '10:00:00', 'utgått startade faktiskt');

  const godkand = await (await fetch(`${base}/api/receipt?card=123456`)).json();
  assert.equal(godkand.result.startTime, '10:00:00');
});

// KRAV-5: en bred sökning matchade hela deltagarfältet och skickade det i ett
// svar – vid 2000 löpare 240 kB, och en träfflista ingen kan hitta sig själv i.
test('för bred sökning avvisas i stället för att lista alla', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, mopCompleteManyRunners(150));

  const res = await fetch(`${base}/api/search?q=${encodeURIComponent('Löpare')}`);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /150/, 'felet ska säga hur många som matchade');

  // En precisare sökning fungerar som vanligt
  const ok = await fetch(`${base}/api/search?q=${encodeURIComponent('Löpare 42 ')}`);
  assert.equal(ok.status, 200);
  const hits = await ok.json();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'Löpare 42 Efternamn');
});

test('sökning strax under gränsen listas som vanligt', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, mopCompleteManyRunners(100));

  const res = await fetch(`${base}/api/search?q=${encodeURIComponent('Löpare')}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).length, 100);
});

// KRAV-4: slutar MeOS skicka – nätet på tävlingsdatorn dör, eller
// Onlineresultat stängs av misstag – fryser kvittona i det läge de var. En
// löpare som gått i mål och ser "Ute på banan" i en timme tror att hennes
// stämpling inte registrerats. Kvittot ska säga hur gammalt underlaget är.
test('kvittot berättar hur gammal tävlingsdatan är', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  const r = await (await fetch(`${base}/api/receipt?card=111111`)).json();
  assert.equal(typeof r.updatedAgeSeconds, 'number', 'åldern ska räknas av servern');
  assert.ok(r.updatedAgeSeconds < 5, `nyss inläst data, fick ${r.updatedAgeSeconds} s`);
  assert.equal(r.result.statusText, 'Ute på banan');
});

test('åldern räknas från senast mottagna data', async (t) => {
  const { createStore } = await import('../lib/store.js');
  const { applyMop } = await import('../lib/mop.js');
  const { buildReceipt } = await import('../lib/receipt.js');

  const store = createStore();
  applyMop(store, 1, MOP_COMPLETE);
  // Låtsas att det gått en halvtimme sedan MeOS senast hörde av sig
  const enHalvtimmeSenare = Date.now() + 30 * 60 * 1000;
  const r = buildReceipt(store.competitions[1], 1, 33, { now: () => enHalvtimmeSenare });
  assert.ok(
    r.updatedAgeSeconds >= 1800 && r.updatedAgeSeconds < 1810,
    `förväntade ~1800 s, fick ${r.updatedAgeSeconds}`
  );
});

// Felmeddelandena är det enda en löpare med en trasig länk har att gå på, och
// de måste skilja på "du angav inget att söka med" och "jag hittade ingen".
test('kvitto-API:t förklarar vad som saknas', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  // Innan någon tävling kommit in är det tjänsten som saknar data
  let res = await fetch(`${base}/api/receipt?card=123456`);
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /Ingen tävling/);

  await postMop(base, MOP_COMPLETE);

  // Utan sökparametrar, eller med sådana som inte är bricknummer
  for (const query of ['', '?card=0', '?card=abc', '?id=0']) {
    res = await fetch(`${base}/api/receipt${query}`);
    assert.equal(res.status, 400, `förväntade 400 för ${query || '(inga parametrar)'}`);
    assert.match((await res.json()).error, /Ange bricknummer/);
  }

  // Ett giltigt bricknummer som ingen har
  res = await fetch(`${base}/api/receipt?card=999999`);
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /999999/, 'felet ska nämna vad som söktes');
});

test('MOPDiff updates a competitor and marks result preliminary', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);
  assert.equal(await postMop(base, MOP_DIFF), 'OK');

  const r = await (await fetch(`${base}/api/receipt?card=111111`)).json();
  assert.equal(r.result.statusText, 'Godkänd');
  assert.equal(r.result.preliminary, true);
  assert.equal(r.result.time, '30:00');
  assert.equal(r.result.place, null);
  assert.equal(r.result.prelPlace, 1); // snabbast i H21
});

test('search by name and unknown card gives 404', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  const hits = await (await fetch(`${base}/api/search?q=anna`)).json();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'Anna Andersson');
  // KRAV-5: träfflistan identifierar på namn och klubb, aldrig på bricknumret
  assert.equal(hits[0].card, undefined);

  const res = await fetch(`${base}/api/receipt?card=999999`);
  assert.equal(res.status, 404);
});

// KRAV-6: brickan hittas i den senaste tävling där den förekommer
test('card found in older competition when the latest lacks it', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);
  await postMop(base, mopCompleteMinimal({ name: 'Nyare tävlingen', date: '2026-09-01' }), {
    competition: '2',
  });

  const res = await fetch(`${base}/api/receipt?card=123456`);
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.runner.name, 'Anna Andersson');
  assert.equal(r.competition.name, 'Testtävlingen');
});

// KRAV-7: delad bricka ska ge en valbar träfflista, inte en gissning
test('shared card gives 300 with alternatives', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);
  await postMop(base, mopDiffExtraRunner({ name: 'Erik Ek', card: 123456, cls: 2 }));

  const res = await fetch(`${base}/api/receipt?card=123456`);
  assert.equal(res.status, 300);
  const body = await res.json();
  assert.equal(body.alternatives.length, 2);
  assert.deepEqual(
    body.alternatives.map((h) => h.name).sort(),
    ['Anna Andersson', 'Erik Ek']
  );
});

test('MOPComplete replaces earlier data for the competition', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);
  await postMop(base, MOP_COMPLETE.replace('Testtävlingen', 'Omstartad tävling'));

  const list = await (await fetch(`${base}/api/competitions`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Omstartad tävling');
});

/**
 * KRAV-6/KRAV-14: kvittosidan skriver `?cmp=N&id=M` i adressfältet, och
 * "Dela kvittot" delar just den länken. Pekade cmp på en tävling som inte
 * finns – gallrad efter 90 dagar, eller ett id som aldrig funnits – föll
 * uppslaget tyst tillbaka på den senaste tävlingen.
 *
 * Löpar-id är MeOS interna och återanvänds mellan tävlingar. Länken visade
 * alltså en främmande människas kvitto, med namn, klubb, klass och tider.
 */
test('en länk till en tävling som inte finns visar inte någon annans kvitto', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  await postMop(base, MOP_COMPLETE);
  // Samma interna id (31), en annan människa – så ser nästa tävling ut
  await postMop(base, MOP_COMPLETE.replace(/Anna Andersson/g, 'Berit Bengtsson')
    .replace('Testtävlingen', 'Nästa tävling'), { competition: '2' });

  const rätt = await (await fetch(`${base}/api/receipt?cmp=1&id=31`)).json();
  assert.equal(rätt.runner.name, 'Anna Andersson', 'fel förutsättning');

  const res = await fetch(`${base}/api/receipt?cmp=99&id=31`);
  const body = await res.json();
  assert.notEqual(
    body.runner?.name,
    'Berit Bengtsson',
    'länken visade en annan löpares kvitto i stället för att säga att tävlingen är borta'
  );
  assert.equal(res.status, 404);
  assert.match(body.error, /99/, 'felet ska säga vilken tävling som saknas');
});

/**
 * För en bricka gäller motsatsen: brickan identifierar personen, så att leta
 * vidare i äldre tävlingar är precis vad KRAV-6 vill ha.
 */
test('en bricka söks vidare i andra tävlingar även om cmp är borta', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  const r = await (await fetch(`${base}/api/receipt?cmp=99&card=123456`)).json();
  assert.equal(r.runner.name, 'Anna Andersson');
});

/**
 * KRAV-13: kvittona hämtas över mobildata, ofta genom operatörsproxyer, och
 * bakom nginx eller Cloudflare. Utan Cache-Control får ett mellanled tolka
 * själv hur länge svaret får ligga kvar.
 *
 * Två skäl att säga ifrån: kvittot är personuppgifter och ska inte bli
 * liggande i en cache eller på en delad telefons disk, och ett cachat kvitto
 * är exakt det frusna kvitto som updatedAgeSeconds finns för att varna om –
 * men åldern räknas på servern, så ett cachat svar ljuger även om den.
 */
test('API-svar får inte cachas av mellanled', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  for (const väg of [
    '/api/health',
    '/api/competitions',
    '/api/search?q=anna',
    '/api/receipt?card=123456',
    '/api/receipt.pdf?card=123456',
  ]) {
    const res = await fetch(base + väg);
    assert.equal(res.status, 200, `${väg} svarade ${res.status}`);
    assert.match(
      res.headers.get('cache-control') || '',
      /no-store/,
      `${väg} saknar Cache-Control: no-store`
    );
  }
});

/**
 * KRAV-13: kvittosidans egna filer innehåller inga personuppgifter och får
 * cachas – men bara kort.
 *
 * Filnamnen är oversionerade (`app.js`, inte `app.<hash>.js`), så en lång
 * cachetid betyder att en löpare kör gammal frontend mot ett nytt API efter
 * en driftsättning. Det hände skarpt: Cloudflare satte fyra timmar och ett
 * nytillkommet fält i `/api/receipt` syntes inte på sidan, trots att både
 * servern och svaret var rätt. Med 60 sekunder och ETag kvar kostar en
 * oförändrad fil en 304 i stället för en omsändning.
 */
test('kvittosidans egna filer cachas kort och revalideras', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  for (const väg of ['/app.js', '/styles.css', '/index.html']) {
    const res = await fetch(base + väg);
    assert.equal(res.status, 200, `${väg} svarade ${res.status}`);

    const cache = res.headers.get('cache-control') || '';
    assert.doesNotMatch(
      cache,
      /no-store/,
      `${väg}: statiska filer ska få cachas – de innehåller inga personuppgifter`
    );

    const m = cache.match(/max-age=(\d+)/);
    assert.ok(m, `${väg} saknar max-age i Cache-Control: "${cache}"`);
    assert.ok(
      Number(m[1]) <= 60,
      `${väg} cachas i ${m[1]} s – en löpare kan då köra gammal frontend mot nytt API`
    );

    assert.ok(res.headers.get('etag'), `${väg} saknar ETag och kan inte revalideras billigt`);
  }
});

/**
 * Utan detta vore den korta cachetiden dyr: varje besök skulle hämta hela
 * filen på nytt i stället för att få ett tomt 304-svar.
 *
 * `cache-control: max-age=0` härmar webbläsarens vanliga omladdning. Node:s
 * `fetch` skickar annars `no-cache`, vilket är en hård omladdning (Ctrl+F5)
 * och per HTTP-specen ska ge 200 – utan den här raden mäter testet
 * testklientens beteende i stället för serverns.
 */
test('en oförändrad fil revalideras med 304', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const första = await fetch(`${base}/app.js`);
  const etag = första.headers.get('etag');
  assert.ok(etag);

  const andra = await fetch(`${base}/app.js`, {
    headers: { 'if-none-match': etag, 'cache-control': 'max-age=0' },
  });
  assert.equal(andra.status, 304, 'oförändrad fil ska ge 304, inte en ny omsändning');
});

/**
 * KRAV-3: en bana kan ta över en timme.
 *
 * Löptid och sträcktider skrivs då som h:mm:ss i stället för mm:ss, och
 * kolumnen växer med två tecken. Kvittosidans sträcktabell och PDF-remsans
 * 45 teckens bredd är avstämda mot just det breda fallet – men själva
 * formatet hade inget test, så antagandet kunde ha ändrats under dem.
 */
test('en löptid över en timme skrivs som timmar, inte som 125 minuter', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  await postMop(base, MOP_COMPLETE);

  const tider = {
    21000: '35:00',      // 35 min
    35990: '59:59',      // sista minuten före timmen
    36000: '1:00:00',    // exakt en timme
    75500: '2:05:50',    // ett långt H21-lopp
  };
  for (const [rt, väntat] of Object.entries(tider)) {
    await postMop(base, MOP_COMPLETE.replace('rt="21000"', `rt="${rt}"`));
    const r = await (await fetch(`${base}/api/receipt?card=123456`)).json();
    assert.equal(r.result.time, väntat, `rt=${rt} tiondelar`);
  }
});
