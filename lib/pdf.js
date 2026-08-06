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

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;
const SIZE = 10;
const LEADING = 13.5;
const CHAR_W = SIZE * 0.6; // Courier är 600/1000 em brett
const COLS = Math.floor((PAGE_W - 2 * MARGIN) / CHAR_W); // 80 tecken

/** Rader per sida, exklusive marginaler. */
const ROWS = Math.floor((PAGE_H - 2 * MARGIN) / LEADING);

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const padNum = (s, n) => String(s ?? '').padStart(n).slice(-n);

/** En avdelarrad i kvittostil. */
const RULE = '-'.repeat(COLS);

/**
 * Kvittots innehåll som rader: { text, bold, center }.
 * Bryts ut separat från PDF-byggandet så att layouten kan enhetstestas
 * utan att gå via PDF-syntaxen.
 */
export function receiptLines(receipt) {
  const { competition: c, runner: r, result: res, splits = [] } = receipt;
  const lines = [];
  const add = (text = '', opts = {}) => lines.push({ text, ...opts });

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
    r.card ? `Bricka ${r.card}` : '',
  ].filter(Boolean);
  if (idMeta.length) add(idMeta.join(' · '));
  add(RULE);

  if (res.time) add(res.time, { bold: true, center: true });
  add(res.statusText, { bold: true, center: true });
  if (res.preliminary) add('Preliminärt resultat – ej fastställt', { center: true });
  if (res.place) add(`Placering: ${res.place} av ${res.finished} i mål`, { center: true });
  else if (res.prelPlace) add(`Prel. placering: ${res.prelPlace} av ${res.finished} i mål`, { center: true });
  if (res.after) add(`Efter segraren: ${res.after}`, { center: true });
  add(RULE);

  if (res.startTime) add(`${pad('Starttid', 20)}${padNum(res.startTime, 12)}`);
  if (res.finishTime) add(`${pad('Måltid', 20)}${padNum(res.finishTime, 12)}`);

  if (splits.length) {
    add(RULE);
    add(
      `${pad('Kontroll', 20)}${padNum('Sträcka', 12)}${padNum('Total', 12)}${padNum('Klocka', 12)}`,
      { bold: true }
    );
    for (const s of splits) {
      const mark =
        s.status === 'missing' ? ' SAKNAS' : s.status === 'additional' ? ' EXTRA' : '';
      add(
        pad(`${s.name}${mark}`, 20) +
          padNum(s.leg || '-', 12) +
          padNum(s.elapsed || '-', 12) +
          padNum(s.clock || '-', 12)
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

/** Escapar en sträng till en PDF-litteral i WinAnsi-kodning. */
function pdfString(text) {
  const escaped = String(text).replace(/[\\()]/g, (ch) => '\\' + ch);
  const bytes = [];
  for (const ch of escaped) {
    const code = ch.codePointAt(0);
    bytes.push(code <= 0xff ? code : 0x3f); // '?' för tecken utanför latin1
  }
  return Buffer.from(bytes);
}

/** Delar upp raderna på sidor. */
function paginate(lines) {
  const pages = [];
  for (let i = 0; i < lines.length; i += ROWS) pages.push(lines.slice(i, i + ROWS));
  return pages.length ? pages : [[]];
}

/** Innehållsströmmen för en sida. */
function contentStream(pageLines) {
  const parts = [Buffer.from('BT\n')];
  let y = PAGE_H - MARGIN;
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
    const stream = contentStream(pageLines);
    objects[pageId] = Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
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
