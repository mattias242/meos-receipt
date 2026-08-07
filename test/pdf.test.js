import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReceiptPdf, receiptLines, receiptFilename } from '../lib/pdf.js';

// KRAV-15: kvitto som PDF

const RECEIPT = {
  competition: { id: 1, name: 'Testtävlingen', date: '2026-08-06', organizer: 'Testklubben OK' },
  runner: { id: 31, name: 'Anna Andersson', club: 'OK Skogen', class: 'H21', card: 123456, bib: '12', team: '' },
  result: {
    status: 1,
    statusText: 'Godkänd',
    preliminary: false,
    startTime: '10:00:00',
    finishTime: '10:35:00',
    time: '35:00',
    place: 2,
    prelPlace: null,
    finished: 2,
    total: 3,
    after: '+2:30',
  },
  splits: [
    { control: 31, name: '31', status: 'ok', clock: '10:07:30', elapsed: '7:30', leg: '7:30' },
    { control: 77, name: '77', status: 'additional', clock: '10:16:40', elapsed: '16:40', leg: '1:40' },
    { control: 45, name: '45', status: 'missing', clock: '', elapsed: '', leg: '' },
    { control: null, name: 'Mål', status: 'ok', clock: '10:35:00', elapsed: '35:00', leg: '5:00' },
  ],
  updated: '2026-08-06T14:42:36.625Z',
};

/** Samma extrahering som BDD-steget: okomprimerade strömmar, text före Tj. */
function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  return [...raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)]
    .map((m) => m[1].replace(/\\([\\()])/g, '$1'))
    .join('\n');
}

const textOf = (lines) => lines.map((l) => l.text).join('\n');

test('receiptLines innehåller tävling, löpare, status och tider', () => {
  const text = textOf(receiptLines(RECEIPT));
  for (const expected of [
    'Testtävlingen',
    'Anna Andersson',
    'OK Skogen',
    'Godkänd',
    '35:00',
    'Placering: 2 av 2 i mål',
    'Efter segraren: +2:30',
  ]) {
    assert.ok(text.includes(expected), `"${expected}" saknas:\n${text}`);
  }
});

test('receiptLines märker ut saknade och extra stämplingar', () => {
  const lines = receiptLines(RECEIPT);
  assert.ok(lines.some((l) => l.text.startsWith('45 SAKNAS')), 'saknad kontroll omärkt');
  assert.ok(lines.some((l) => l.text.startsWith('77 EXTRA')), 'extra stämpling omärkt');
});

test('receiptLines behåller stämplingarnas ordning från kvittot', () => {
  const controls = receiptLines(RECEIPT)
    .map((l) => l.text.trim().split(/\s+/)[0])
    .filter((t) => ['31', '77', '45', 'Mål'].includes(t));
  assert.deepEqual(controls, ['31', '77', '45', 'Mål']);
});

test('renderReceiptPdf ger en giltig PDF med kvittots text', () => {
  const pdf = renderReceiptPdf(RECEIPT);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.subarray(-8).toString(), /%%EOF/);

  const text = pdfText(pdf);
  assert.ok(text.includes('Anna Andersson'));
  assert.ok(text.includes('Godkänd'), 'åäö ska överleva WinAnsi-kodningen');
  assert.ok(text.includes('Mål'));
});

test('xref-tabellen pekar på objektens verkliga byte-offset', () => {
  const pdf = renderReceiptPdf(RECEIPT);
  const raw = pdf.toString('latin1');

  const startxref = Number(raw.match(/startxref\n(\d+)/)[1]);
  assert.equal(raw.slice(startxref, startxref + 4), 'xref');

  const size = Number(raw.match(/\/Size (\d+)/)[1]);
  const entries = [...raw.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
    Number(m[1])
  );
  assert.equal(entries.length, size - 1, 'en post per objekt utom den fria');
  entries.forEach((offset, i) => {
    assert.ok(raw.startsWith(`${i + 1} 0 obj`, offset), `objekt ${i + 1} ligger inte på ${offset}`);
  });
});

/** MediaBox som [bredd, höjd] i punkter. */
function mediaBox(pdf) {
  const m = pdf.toString('latin1').match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  return { w: Number(m[1]), h: Number(m[2]) };
}

const MM = 72 / 25.4;

test('kvittot är 100 mm brett', () => {
  assert.ok(Math.abs(mediaBox(renderReceiptPdf(RECEIPT)).w - 100 * MM) < 0.5);
});

test('en lång bana blir en obruten remsa som växer på höjden', () => {
  const many = {
    ...RECEIPT,
    splits: Array.from({ length: 120 }, (_, i) => ({
      control: i + 1,
      name: String(i + 1),
      status: 'ok',
      clock: '10:00:00',
      elapsed: '1:00',
      leg: '1:00',
    })),
  };
  const pdf = renderReceiptPdf(many);
  const raw = pdf.toString('latin1');

  assert.equal(Number(raw.match(/\/Count (\d+)/)[1]), 1, 'ska rymmas på en remsa');
  const kort = mediaBox(renderReceiptPdf(RECEIPT));
  const lang = mediaBox(pdf);
  assert.equal(lang.w, kort.w, 'bredden är densamma');
  assert.ok(lang.h > kort.h * 3, `remsan växte inte: ${kort.h} -> ${lang.h}`);
});

test('inga rader sticker utanför remsans bredd', () => {
  const brett = {
    ...RECEIPT,
    competition: { ...RECEIPT.competition, name: 'Riksmästerskapen i orientering, långdistans 2026' },
    runner: { ...RECEIPT.runner, club: 'Ett synnerligen långnamnat orienteringssällskap' },
  };
  for (const line of receiptLines(brett)) {
    assert.ok(line.text.length <= 45, `för bred rad (${line.text.length}): ${line.text}`);
  }
});

test('tecken utanför latin1 ger en läsbar PDF i stället för trasiga bytes', () => {
  const pdf = renderReceiptPdf({
    ...RECEIPT,
    runner: { ...RECEIPT.runner, name: '大山 Ödmann' },
  });
  const text = pdfText(pdf);
  assert.ok(text.includes('Ödmann'), 'latin1-tecken ska bevaras');
  assert.ok(text.includes('??'), 'tecken utanför latin1 ersätts');
});

// KRAV-10: startad men utan registrerade stämplingar
test('PDF:en förklarar när inga stämplingar registrerats', () => {
  const utgatt = {
    ...RECEIPT,
    result: { ...RECEIPT.result, statusText: 'Utgått', time: '', finishTime: '', place: null, after: '' },
    splits: [],
  };
  const text = receiptLines(utgatt).map((l) => l.text).join('\n');
  assert.ok(text.includes('Inga stämplingar registrerade'), text);
  assert.ok(text.includes('Utgått'));
});

test('kvitto utan starttid får ingen stämplingsnotering', () => {
  const ejStart = {
    ...RECEIPT,
    result: { ...RECEIPT.result, statusText: 'Ej start', time: '', startTime: '', finishTime: '', place: null, after: '' },
    splits: [],
  };
  const text = receiptLines(ejStart).map((l) => l.text).join('\n');
  assert.ok(!text.includes('Inga stämplingar registrerade'), text);
});

// Remsan är 45 tecken bred. Ett enskilt ord som är längre än så – en lång
// webbadress som arrangörsnamn, eller ett hopskrivet klubbnamn – går inte att
// bryta på ordgräns och måste delas rakt av, annars sticker det utanför.
test('ett ord längre än remsan delas i stället för att spilla över', () => {
  const långt = 'A'.repeat(120);
  const rader = receiptLines({
    ...RECEIPT,
    competition: { ...RECEIPT.competition, name: långt },
  }).map((l) => l.text);

  for (const rad of rader) {
    assert.ok(rad.length <= 45, `rad på ${rad.length} tecken: ${rad.slice(0, 50)}`);
  }
  // Hela ordet ska finnas kvar, bara uppdelat
  assert.equal(rader.join('').match(/A+/g)?.[0].length, 120, 'inga tecken får tappas bort');
});

test('långt ord mitt i en text bryts utan att resten försvinner', () => {
  const rader = receiptLines({
    ...RECEIPT,
    // X är valt för att inget annat på kvittot innehåller det – "Bricka"
    // hade annars räknats in i kontrollen nedan.
    runner: { ...RECEIPT.runner, club: `OK ${'X'.repeat(60)} Skogen` },
  }).map((l) => l.text);

  // Bara klubbraderna – sträcktabellens "EXTRA"-märkning innehåller också X.
  const klubbrader = rader.slice(rader.indexOf('OK'), rader.findIndex((r) => r.includes('Skogen')) + 1);
  const text = klubbrader.join(' ');
  assert.ok(text.includes('OK'), 'texten före det långa ordet finns kvar');
  assert.ok(text.includes('Skogen'), 'och texten efter');
  assert.equal(text.match(/X+/g).join('').length, 60, 'inga tecken får tappas bort');
  for (const rad of rader) assert.ok(rad.length <= 45, `för bred rad: ${rad}`);
});

test('receiptFilename blir ett ASCII-säkert filnamn', () => {
  const name = receiptFilename(RECEIPT);
  assert.equal(name, 'Kvitto-Anna-Andersson-Testtavlingen.pdf');
  assert.match(name, /^[A-Za-z0-9.-]+$/, 'inga tecken som bryter Content-Disposition');
});

test('parenteser och bakstreck i namn förstör inte PDF-syntaxen', () => {
  const pdf = renderReceiptPdf({
    ...RECEIPT,
    runner: { ...RECEIPT.runner, name: 'Anna (OK) \\ Andersson' },
  });
  assert.ok(pdfText(pdf).includes('Anna (OK) \\ Andersson'));
  assert.match(pdf.subarray(-8).toString(), /%%EOF/);
});

/**
 * KRAV-15: "PDF:en innehåller samma uppgifter som kvittosidan."
 *
 * Påståendet stod i kravet men ingenting höll fast det. Fälten hämtas därför
 * ur kvittosidans egen mall: allt renderReceipt() läser ur kvittot måste
 * synas i PDF:en, om det inte står med i undantagen nedan med skäl. Ett nytt
 * fält på sidan hamnar inte i undantagen och kräver alltså ett aktivt
 * ställningstagande – i stället för att tyst falla bort ur den PDF löparen
 * mejlar till sig själv.
 */

/** Fält som medvetet inte är text i PDF:en, med skäl. */
const INTE_TEXT = {
  'r.competition.id': 'ingår i PDF-länkens adress, inte i kvittot',
  'r.runner.id': 'ingår i PDF-länkens adress, inte i kvittot',
  'r.result': 'behållare, inget värde',
  'r.splits': 'behållare, inget värde',
  'r.splits.length': 'styr om tabellen visas',
  'res.preliminary': 'flagga; texten den ger prövas separat nedan',
  's.status': 'flagga; ger märkningen SAKNAS/EXTRA, prövad i eget test',
  'r.updated': 'formateras olika på sidan och i PDF:en; raden prövas nedan',
};

/** Fälten renderReceipt() läser ur kvittot, hämtade ur källan. */
function fältPåKvittosidan() {
  const app = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app.js'),
    'utf8'
  );
  const start = app.indexOf('function renderReceipt(');
  assert.ok(start > -1, 'renderReceipt saknas i app.js');
  // Bara mallen: efter den följer mejlformulärets hantering med egna res.*
  const slut = app.indexOf('receiptEl.hidden = false;', start);
  const kropp = app.slice(start, slut);

  const vägar = new Set();
  for (const [, v] of kropp.matchAll(/\br\.([a-zA-Z]+(?:\.[a-zA-Z]+)*)/g)) vägar.add('r.' + v);
  for (const [, v] of kropp.matchAll(/\bres\.([a-zA-Z]+)/g)) vägar.add('res.' + v);
  for (const [, v] of kropp.matchAll(/\bs\.([a-zA-Z]+)/g)) vägar.add('s.' + v);
  return [...vägar].sort();
}

/** Ett kvitto där varje textfält har ett eget igenkännligt värde. */
function kvittoMedMarkörer(preliminärt) {
  return {
    competition: { id: 1, name: 'TAVLINGSNAMN', date: '2026-08-06', organizer: 'ARRANGORNAMN' },
    runner: { id: 31, name: 'LOPARNAMN', club: 'KLUBBNAMN', class: 'KLASSNAMN', card: 999111, bib: 'NR77', team: 'LAGNAMN' },
    result: {
      status: 1, statusText: 'STATUSTEXT', preliminary: preliminärt,
      startTime: '11:11:11', finishTime: '22:22:22', time: '33:33',
      place: preliminärt ? null : 8, prelPlace: preliminärt ? 7 : null,
      finished: 9, total: 12, after: '+44:44', teamTime: '55:55',
    },
    splits: [{ control: 31, name: 'KONTROLLNAMN', status: 'ok', clock: '12:12:12', elapsed: '13:13', leg: '14:14' }],
    updated: '2026-08-06T14:42:36.625Z',
    updatedAgeSeconds: 4000,
  };
}

test('PDF:en visar allt kvittosidan visar', () => {
  const värden = {
    'r.competition.name': 'TAVLINGSNAMN', 'r.competition.date': '2026-08-06',
    'r.competition.organizer': 'ARRANGORNAMN', 'r.runner.name': 'LOPARNAMN',
    'r.runner.club': 'KLUBBNAMN', 'r.runner.class': 'KLASSNAMN', 'r.runner.card': '999111',
    'r.runner.bib': 'NR77', 'r.runner.team': 'LAGNAMN', 'res.statusText': 'STATUSTEXT',
    'res.time': '33:33', 'res.place': '8', 'res.prelPlace': '7', 'res.finished': '9',
    'res.after': '+44:44', 'res.teamTime': '55:55', 'res.startTime': '11:11:11',
    'res.finishTime': '22:22:22', 's.name': 'KONTROLLNAMN', 's.clock': '12:12:12',
    's.elapsed': '13:13', 's.leg': '14:14',
  };

  const text = (prel) => receiptLines(kvittoMedMarkörer(prel)).map((l) => l.text).join('\n');
  const slutgiltig = text(false);
  const preliminär = text(true);

  for (const väg of fältPåKvittosidan()) {
    if (INTE_TEXT[väg]) continue;
    const v = värden[väg];
    assert.ok(
      v,
      `${väg} visas på kvittosidan men saknas i det här testets värden – lägg ` +
        'till det, eller i INTE_TEXT med skäl'
    );
    // prelPlace visas bara på ett preliminärt kvitto och place bara på ett klart
    assert.ok(
      slutgiltig.includes(v) || preliminär.includes(v),
      `${väg} (${v}) visas på kvittosidan men inte i PDF:en – löparen tappar ` +
        'det när hon mejlar kvittot till sig själv'
    );
  }
});

test('PDF:en märker ut preliminärt resultat och när det uppdaterades', () => {
  const prel = receiptLines(kvittoMedMarkörer(true)).map((l) => l.text).join('\n');
  assert.match(prel, /Preliminärt/, 'ett preliminärt resultat måste märkas ut även i PDF:en');
  assert.match(prel, /^Uppdaterat .+/m, 'utan tidsstämpel går det inte att se hur färskt kvittot är');
  const klar = receiptLines(kvittoMedMarkörer(false)).map((l) => l.text).join('\n');
  assert.doesNotMatch(klar, /Preliminärt/, 'ett fastställt resultat ska inte märkas som preliminärt');
});

/**
 * KRAV-15: PDF:en deklarerar WinAnsiEncoding, men texten kodades som latin1.
 *
 * De två skiljer sig i intervallet 0x80-0x9F, där WinAnsi har just de
 * typografiska tecknen som förekommer i löpande text: tankstreck, apostrofer
 * och citattecken. Allt över U+00FF ersattes med '?', så raden
 * "Preliminärt resultat – ej fastställt" kom ut som
 * "Preliminärt resultat ? ej fastställt" på varje preliminärt kvitto – det
 * vill säga på kvittot löparen mejlar till sig själv direkt efter målgång.
 *
 * Samma sak drabbade namn med typografisk apostrof, som är vad de flesta
 * system skriver ut: O'Brien.
 */

/** Avkodar PDF-texten som en läsare gör: WinAnsi, inte latin1. */
const WINANSI = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};
const winAnsiText = (buffer) =>
  [...pdfText(buffer)].map((c) => WINANSI[c.charCodeAt(0)] ?? c).join('');

test('typografiska tecken överlever till PDF:en', () => {
  const prel = {
    ...RECEIPT,
    result: { ...RECEIPT.result, preliminary: true, place: null, prelPlace: 3 },
  };
  const text = winAnsiText(renderReceiptPdf(prel));
  assert.ok(
    text.includes('Preliminärt resultat – ej fastställt'),
    `tankstrecket överlevde inte:\n${text.split('\n').filter((r) => r.includes('Preliminärt')).join('\n')}`
  );
});

test('typografisk apostrof i ett namn blir inte ett frågetecken', () => {
  const text = winAnsiText(
    renderReceiptPdf({ ...RECEIPT, runner: { ...RECEIPT.runner, name: 'Fiona O’Brien' } })
  );
  assert.ok(text.includes('Fiona O’Brien'), `namnet förvanskades:\n${text}`);
});

test('tecken som WinAnsi inte har blir fortfarande frågetecken, inte skräp', () => {
  const pdf = renderReceiptPdf({ ...RECEIPT, runner: { ...RECEIPT.runner, name: '大山 Ödmann' } });
  const text = winAnsiText(pdf);
  assert.ok(text.includes('Ödmann'), 'latin1-tecken ska bevaras');
  assert.ok(text.includes('??'), 'tecken utan plats i WinAnsi ersätts');
  assert.match(pdf.subarray(-8).toString(), /%%EOF/, 'PDF:en ska fortfarande vara giltig');
});
