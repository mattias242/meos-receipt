import test from 'node:test';
import assert from 'node:assert/strict';
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

test('långa banor delas på flera sidor', () => {
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
  const raw = renderReceiptPdf(many).toString('latin1');
  const count = Number(raw.match(/\/Count (\d+)/)[1]);
  assert.ok(count > 1, `förväntade flera sidor, fick ${count}`);
  assert.equal((raw.match(/\/Type \/Page[^s]/g) || []).length, count);
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
