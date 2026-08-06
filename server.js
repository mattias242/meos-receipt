import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { applyMop } from './lib/mop.js';
import { buildReceipt, searchCompetitors } from './lib/receipt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Creates the Express app.
 *  - POST /meos (även /update.php, /update): tar emot MeOS onlineprotokoll (MOP)
 *  - GET  /api/*: JSON-API för kvittosidan
 *  - statiska filer i public/
 */
export function createApp({ dataDir = null, password = '' } = {}) {
  const store = createStore({ dataDir });
  const app = express();
  app.disable('x-powered-by');

  // --- MeOS push endpoint (MOP) -------------------------------------------
  const mopHandler = [
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
        applyMop(store, cmpId, data.toString('utf8'));
      } catch (err) {
        console.error('MOP-fel:', err.message);
        return res.send('ERROR');
      }
      return res.send('OK');
    },
  ];
  app.post('/meos', ...mopHandler);
  app.post('/update', ...mopHandler);
  app.post('/update.php', ...mopHandler);

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

  app.get('/api/receipt', (req, res) => {
    const cmpId = resolveCmp(req);
    if (!cmpId) return res.status(404).json({ error: 'Ingen tävling inläst ännu.' });
    const cmp = store.competitions[cmpId];

    let competitorId = parseInt(req.query.id || '', 10);
    if (!(competitorId > 0)) {
      const card = parseInt(req.query.card || '', 10);
      if (!(card > 0)) return res.status(400).json({ error: 'Ange bricknummer (card) eller löpar-id (id).' });
      const matches = Object.entries(cmp.competitors)
        .filter(([, c]) => c.card === card)
        .map(([id]) => Number(id));
      if (matches.length === 0) {
        return res.status(404).json({ error: `Ingen löpare med bricka ${card} hittades.` });
      }
      competitorId = matches[0];
    }

    const receipt = buildReceipt(cmp, cmpId, competitorId);
    if (!receipt) return res.status(404).json({ error: 'Löparen hittades inte.' });
    res.json(receipt);
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, competitions: store.listCompetitions().length });
  });

  // --- Static frontend -----------------------------------------------------
  app.use(express.static(path.join(__dirname, 'public')));

  return app;
}
