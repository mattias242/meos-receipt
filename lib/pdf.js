/**
 * Kvitto som PDF (KRAV-15).
 *
 * PDF:en byggs för hand i stället för med ett bibliotek: kvittot är redan ett
 * monospace-kvitto, och de 14 inbyggda PDF-fonterna (här Courier) täcker det
 * utan inbäddade typsnitt. Det håller tjänsten beroendefri – samma skäl som
 * att uppladdningen bara får bero på curl.exe (KRAV-11) – och gör att den
 * paketerade exe-filen inte behöver bundla binära fontfiler.
 *
 * Texten kodas som WinAnsi (≈latin1), vilket täcker åäöÅÄÖ. Tecken utanför
 * latin1 ersätts med '?' hellre än att ge en trasig PDF.
 *
 * renderReceiptPdf() returnerar en Buffer, så samma bytes kan återanvändas
 * för utskick per e-post.
 */

const MM = 72 / 25.4; // punkter per millimeter

/**
 * Kvittoremsa, inte A4: 100 mm bred som en utskrift från en kvittoskrivare.
 * Höjden växer med innehållet så att kvittot blir en enda obruten remsa –
 * en bana med många kontroller ska inte klippas mitt itu av en sidbrytning.
 */
const PAGE_W = 100 * MM; // 283.46 pt
const MARGIN = 7 * MM;
const SIZE = 9;
const LEADING = 12;
const CHAR_W = SIZE * 0.6; // Courier är 600/1000 em brett
const COLS = Math.floor((PAGE_W - 2 * MARGIN) / CHAR_W); // 45 tecken

/** PDF:s största tillåtna sidmått (200 tum). Nås bara av absurt långa banor. */
const MAX_PAGE_H = 14400;
const ROWS = Math.floor((MAX_PAGE_H - 2 * MARGIN) / LEADING);

/** Sidhöjd för ett givet antal rader. */
const pageHeight = (rows) => Math.max(2 * MARGIN + rows * LEADING, 60 * MM);

/** Kolumner i stämplingstabellen, tillsammans exakt COLS tecken breda. */
const COL_CTRL = 14;
const COL_TIME = 10;
const COL_CLOCK = COLS - COL_CTRL - 2 * COL_TIME;

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const padNum = (s, n) => String(s ?? '').padStart(n).slice(-n);

/** En avdelarrad i kvittostil. */
const RULE = '-'.repeat(COLS);

/**
 * Kvittots innehåll som rader: { text, bold, center }.
 * Bryts ut separat från PDF-byggandet så att layouten kan enhetstestas
 * utan att gå via PDF-syntaxen.
 */
/** Bryter text på ordgräns till remsans bredd; delar ord som är längre än så. */
function wrap(text, width = COLS) {
  const out = [];
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) {
      out.push(w.slice(0, width));
      w = w.slice(width);
    }
    const last = out[out.length - 1];
    if (last !== undefined && last.length + 1 + w.length <= width && !last.endsWith('-')) {
      out[out.length - 1] = `${last} ${w}`;
    } else {
      out.push(w);
    }
  }
  return out.length ? out : [''];
}

export function receiptLines(receipt) {
  const { competition: c, runner: r, result: res, splits = [] } = receipt;
  const lines = [];
  // Bara rader som faktiskt är för breda bryts – tabellraderna är redan exakt
  // COLS tecken och skulle förlora sin kolumnuppställning av en ombrytning.
  const add = (text = '', opts = {}) => {
    const s = String(text ?? '');
    if (s.length <= COLS) return void lines.push({ text: s, ...opts });
    for (const part of wrap(s)) lines.push({ text: part, ...opts });
  };

  add(c.name || 'Tävling', { bold: true, center: true });
  const meta = [c.date, c.organizer].filter(Boolean).join(' · ');
  if (meta) add(meta, { center: true });
  add(RULE);

  add(r.name, { bold: true });
  const club = [r.club, r.team].filter(Boolean).join(' · ');
  if (club) add(club);
  const idMeta = [
    r.class ? `Klass: ${r.class}` : '',
    r.bib ? `Nr ${r.bib}` : '',
    // Inget bricknummer, inte heller här – PDF:en mejlas och sparas (KRAV-5)
  ].filter(Boolean);
  if (idMeta.length) add(idMeta.join(' · '));
  add(RULE);

  if (res.time) add(res.time, { bold: true, center: true });
  add(res.statusText, { bold: true, center: true });
  if (res.preliminary) add('Preliminärt resultat – ej fastställt', { center: true });
  if (res.place) add(`Placering: ${res.place} av ${res.finished} i mål`, { center: true });
  else if (res.prelPlace) add(`Prel. placering: ${res.prelPlace} av ${res.finished} i mål`, { center: true });
  if (res.after) add(`Efter segraren: ${res.after}`, { center: true });
  if (res.teamTime) add(`Lagets tid: ${res.teamTime}`, { center: true });
  add(RULE);

  const half = Math.floor(COLS / 2);
  if (res.startTime) add(`${pad('Starttid', half)}${padNum(res.startTime, COLS - half)}`);
  if (res.finishTime) add(`${pad('Måltid', half)}${padNum(res.finishTime, COLS - half)}`);

  // Startade men utan en enda registrerad stämpling (KRAV-10) – säg det rakt ut
  // i stället för att lämna kvittot utan förklaring.
  if (!splits.length && res.startTime) {
    add(RULE);
    add('Inga stämplingar registrerade', { center: true });
  }

  if (splits.length) {
    add(RULE);
    add(
      pad('Kontroll', COL_CTRL) +
        padNum('Sträcka', COL_TIME) +
        padNum('Total', COL_TIME) +
        padNum('Klocka', COL_CLOCK),
      { bold: true }
    );
    for (const s of splits) {
      const mark =
        s.status === 'missing' ? ' SAKNAS' : s.status === 'additional' ? ' EXTRA' : '';
      add(
        pad(`${s.name}${mark}`, COL_CTRL) +
          padNum(s.leg || '-', COL_TIME) +
          padNum(s.elapsed || '-', COL_TIME) +
          padNum(s.clock || '-', COL_CLOCK)
      );
    }
  }

  add(RULE);
  if (receipt.updated) {
    add(`Uppdaterat ${new Date(receipt.updated).toLocaleString('sv-SE')}`, { center: true });
  }
  return lines;
}

/** Filnamn utan tecken som ställer till det i Content-Disposition. */
export function receiptFilename(receipt) {
  const parts = [receipt.runner?.name, receipt.competition?.name].filter(Boolean);
  const slug = parts
    .join('-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // ta bort diakriter: å -> a
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `Kvitto-${slug || 'kvitto'}.pdf`;
}

/**
 * WinAnsi (CP1252) i intervallet 0x80-0x9F, där den skiljer sig från latin1.
 *
 * Just där ligger de typografiska tecken som förekommer i löpande text och i
 * namn: tankstreck, apostrofer, citattecken. Utan den här tabellen blev
 * "Preliminärt resultat – ej fastställt" till "... ? ..." på varje
 * preliminärt kvitto, och O'Brien till O?Brien.
 */
const WINANSI = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

/** Escapar en sträng till en PDF-litteral i WinAnsi-kodning. */
function pdfString(text) {
  const escaped = String(text).replace(/[\\()]/g, (ch) => '\\' + ch);
  const bytes = [];
  for (const ch of escaped) {
    const code = ch.codePointAt(0);
    const winansi = WINANSI.get(code);
    if (winansi !== undefined) bytes.push(winansi);
    else bytes.push(code <= 0xff ? code : 0x3f); // '?' för tecken WinAnsi saknar
  }
  return Buffer.from(bytes);
}

/** Delar upp raderna på sidor. */
function paginate(lines) {
  const pages = [];
  for (let i = 0; i < lines.length; i += ROWS) pages.push(lines.slice(i, i + ROWS));
  return pages.length ? pages : [[]];
}

/** Innehållsströmmen för en sida av given höjd. */
function contentStream(pageLines, pageH) {
  const parts = [Buffer.from('BT\n')];
  let y = pageH - MARGIN - SIZE;
  for (const line of pageLines) {
    const text = line.text ?? '';
    if (text) {
      const width = text.length * CHAR_W;
      const x = line.center
        ? MARGIN + Math.max(0, (PAGE_W - 2 * MARGIN - width) / 2)
        : MARGIN;
      parts.push(Buffer.from(`/${line.bold ? 'F2' : 'F1'} ${SIZE} Tf\n`));
      parts.push(Buffer.from(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(`));
      parts.push(pdfString(text));
      parts.push(Buffer.from(') Tj\n'));
    }
    y -= LEADING;
  }
  parts.push(Buffer.from('ET\n'));
  return Buffer.concat(parts);
}

/**
 * Bygger kvittot som en PDF-Buffer. Strömmarna lämnas okomprimerade – filen
 * är några kilobyte och blir läsbar för både felsökning och tester.
 */
export function renderReceiptPdf(receipt) {
  const pages = paginate(receiptLines(receipt));

  // Objektnummer: 1 katalog, 2 sidträd, 3 + 4 fonter, därefter ett par
  // (sida, innehåll) per sida.
  const pageObjStart = 5;
  const pageIds = pages.map((_, i) => pageObjStart + i * 2);
  const objects = [];

  objects[1] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  );
  objects[3] = Buffer.from(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'
  );
  objects[4] = Buffer.from(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>'
  );

  pages.forEach((pageLines, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const pageH = pageHeight(pageLines.length);
    const stream = contentStream(pageLines, pageH);
    objects[pageId] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${pageH.toFixed(2)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    objects[contentId] = Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from('endstream'),
    ]);
  });

  // Serialisera och håll reda på byte-offset för xref-tabellen.
  const chunks = [Buffer.from('%PDF-1.4\n')];
  let offset = chunks[0].length;
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    const body = objects[id];
    offsets[id] = offset;
    const obj = Buffer.concat([
      Buffer.from(`${id} 0 obj\n`),
      body,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(obj);
    offset += obj.length;
  }

  const count = objects.length; // objekt 0 är den fria posten
  const xref = [`xref\n0 ${count}\n`, '0000000000 65535 f \n'];
  for (let id = 1; id < count; id++) {
    xref.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(Buffer.from(xref.join('')));
  chunks.push(
    Buffer.from(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`)
  );

  return Buffer.concat(chunks);
}
