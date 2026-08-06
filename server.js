import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { applyMop } from './lib/mop.js';
import { applyIof } from './lib/iof.js';
import { buildReceipt, searchCompetitors } from './lib/receipt.js';
import { renderReceiptPdf, receiptFilename } from './lib/pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Creates the Express app.
 *  - POST /meos (även /update.php, /update): tar emot MeOS onlineprotokoll (MOP)
 *  - GET  /api/*: JSON-API för kvittosidan
 *  - statiska filer i public/
 */
export function createApp({
  dataDir = null,
  password = '',
  saveDelayMs = 2000,
  retentionDays = 90,
  now = undefined,
} = {}) {
  const store = createStore({ dataDir, saveDelayMs, retentionDays, now });
  const app = express();
  app.disable('x-powered-by');

  // --- XML push endpoints (MeOS online + resultatautomat) ------------------
  // Same header protocol for both: competition (id) and pwd (password).
  function receiveXml(apply) {
    return [
      express.raw({ type: () => true, limit: '32mb' }),
      (req, res) => {
        res.type('text/plain');

        const cmpId = parseInt(req.get('competition') || '', 10);
        if (!(cmpId > 0)) return res.send('BADCMP');

        if (password && req.get('pwd') !== password) return res.send('BADPWD');

        const data = req.body;
        if (!Buffer.isBuffer(data) || data.length === 0) return res.send('ERROR');

        // Zip (starts with 'PK') is not supported – MeOS falls back to plain XML.
        if (data[0] === 0x50 && data[1] === 0x4b) return res.send('NOZIP');

        try {
          apply(cmpId, data.toString('utf8'));
        } catch (err) {
          console.error('Mottagningsfel:', err.message);
          return res.send('ERROR');
        }
        return res.send('OK');
      },
    ];
  }

  const mopHandler = receiveXml((cid, xml) => applyMop(store, cid, xml));
  app.post('/meos', ...mopHandler);
  app.post('/update', ...mopHandler);
  app.post('/update.php', ...mopHandler);

  // IOF XML 3.0 ResultList med sträcktider, från MeOS resultatautomat (KRAV-9)
  app.post('/iof', ...receiveXml((cid, xml) => applyIof(store, cid, xml)));

  // --- JSON API ------------------------------------------------------------
  app.get('/api/competitions', (req, res) => {
    res.json(store.listCompetitions());
  });

  // Resolve which competition to use: explicit ?cmp= or the most recent one.
  function resolveCmp(req) {
    const explicit = parseInt(req.query.cmp || '', 10);
    if (explicit > 0 && store.competitions[explicit]) return explicit;
    const list = store.listCompetitions();
    return list.length ? list[0].id : null;
  }

  app.get('/api/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Ange bricknummer eller namn.' });

    const explicit = parseInt(req.query.cmp || '', 10);
    const cmpIds = explicit > 0 && store.competitions[explicit]
      ? [explicit]
      : store.listCompetitions().map((c) => c.id);

    const hits = [];
    for (const id of cmpIds) {
      hits.push(...searchCompetitors(store.competitions[id], id, q));
      if (hits.length && !(explicit > 0)) break; // latest competition with a match
    }
    res.json(hits);
  });

  // Find the card in the latest competition where it occurs (KRAV-6).
  function findByCard(card, explicitCmp) {
    const cmpIds = explicitCmp
      ? [explicitCmp]
      : store.listCompetitions().map((c) => c.id);
    for (const cmpId of cmpIds) {
      const matches = Object.entries(store.competitions[cmpId].competitors)
        .filter(([, c]) => c.card === card)
        .map(([id]) => Number(id));
      if (matches.length) return { cmpId, matches };
    }
    return null;
  }

  /**
   * Löser upp ?card=/?id=/?cmp= till ett kvitto. Returnerar antingen
   * { receipt } eller { status, body } som svar rakt av – delas av
   * JSON-kvittot och PDF-nedladdningen (KRAV-15).
   */
  function resolveReceipt(req) {
    if (store.listCompetitions().length === 0) {
      return { status: 404, body: { error: 'Ingen tävling inläst ännu.' } };
    }

    let cmpId, competitorId;
    const explicitId = parseInt(req.query.id || '', 10);
    if (explicitId > 0) {
      cmpId = resolveCmp(req);
      competitorId = explicitId;
    } else {
      const card = parseInt(req.query.card || '', 10);
      if (!(card > 0)) {
        return { status: 400, body: { error: 'Ange bricknummer (card) eller löpar-id (id).' } };
      }

      const explicit = parseInt(req.query.cmp || '', 10);
      const found = findByCard(card, explicit > 0 && store.competitions[explicit] ? explicit : null);
      if (!found) {
        return { status: 404, body: { error: `Ingen löpare med bricka ${card} hittades.` } };
      }
      if (found.matches.length > 1) {
        // Delad bricka: låt användaren välja (KRAV-7).
        return {
          status: 300,
          body: {
            alternatives: searchCompetitors(store.competitions[found.cmpId], found.cmpId, String(card)),
          },
        };
      }
      cmpId = found.cmpId;
      competitorId = found.matches[0];
    }

    const receipt = buildReceipt(store.competitions[cmpId], cmpId, competitorId);
    if (!receipt) return { status: 404, body: { error: 'Löparen hittades inte.' } };
    return { receipt };
  }

  app.get('/api/receipt', (req, res) => {
    const { receipt, status, body } = resolveReceipt(req);
    if (!receipt) return res.status(status).json(body);
    res.json(receipt);
  });

  // Kvittot som nedladdningsbar PDF (KRAV-15).
  app.get('/api/receipt.pdf', (req, res) => {
    const { receipt, status, body } = resolveReceipt(req);
    if (!receipt) return res.status(status).json(body);

    const pdf = renderReceiptPdf(receipt);
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receiptFilename(receipt)}"`);
    res.send(pdf);
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, competitions: store.listCompetitions().length });
  });

  // --- Static frontend -----------------------------------------------------
  // I den paketerade exe-filen (Node SEA) blir __dirname mappen där exen
  // ligger, så public/ levereras bredvid den. PUBLIC_DIR kan alltid överstyra.
  app.use(express.static(process.env.PUBLIC_DIR || path.join(__dirname, 'public')));

  return app;
}
