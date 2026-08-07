import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { applyMop } from './lib/mop.js';
import { applyIof } from './lib/iof.js';
import { buildReceipt, searchCompetitors } from './lib/receipt.js';
import { renderReceiptPdf, receiptFilename } from './lib/pdf.js';
import { isValidEmail, createRateLimiter, maskeraAdresser } from './lib/mailer.js';
import { createReadLimiter } from './lib/lasgrans.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Största träfflista som är meningsfull att visa en löpare (KRAV-5). */
const MAX_SEARCH_HITS = 100;

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
  mailer = null,
  emailRateLimit = {},
  trustProxy = false,
  // KRAV-5: tak för hur många olika löpare en klient får se. 0 = av.
  // Testerna kör utan tak om de inte ber om ett; annars skulle varje test som
  // hämtar många kvitton bli beroende av taket.
  readLimit = 0,
} = {}) {
  const store = createStore({ dataDir, saveDelayMs, retentionDays, now });
  const emailLimiter = createRateLimiter(emailRateLimit);
  const läsgräns = createReadLimiter({ max: readLimit });
  const app = express();
  app.disable('x-powered-by');
  // Den som binder porten behöver kunna tömma sparkön vid avslut (KRAV-8).
  app.locals.store = store;
  // Taket på mejlutskick gäller per avsändar-IP (KRAV-16). Bakom Fly.io:s
  // proxy eller nginx är socketens adress proxyns – alltså samma för alla, så
  // fem utskick låser hela tävlingen ute. Antalet hopp anges uttryckligen:
  // "lita på vad som helst" hade i stället låtit vem som helst sätta
  // X-Forwarded-For själv och kringgå taket helt.
  if (trustProxy !== false && trustProxy !== null) app.set('trust proxy', trustProxy);

  // Inställningen måste sättas för hand vid driftsättning, och görs den inte
  // felar ingenting – mejlutskicken slutar bara fungera för alla utom de fem
  // första, mitt under tävlingen. Men tjänsten kan se det själv: kommer
  // anropen med X-Forwarded-For står det en proxy där framme.
  let proxyvarning = null;
  if (!trustProxy) {
    app.use((req, res, next) => {
      if (!proxyvarning && req.get('x-forwarded-for')) {
        proxyvarning =
          'Anrop kommer via en proxy men TRUST_PROXY är inte satt – taket för ' +
          'mejlutskick räknar då alla löpare som samma avsändare.';
        // En rad, inte en per anrop: loggen behövs som mest under tävling.
        console.warn(`VARNING: ${proxyvarning}`);
      }
      next();
    });
  }

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
  // Kvittona hämtas över mobildata, ofta genom operatörsproxyer och bakom
  // nginx eller Cloudflare (KRAV-13). Utan det här får varje mellanled tolka
  // själv hur länge svaret får ligga kvar: kvittot är personuppgifter, och ett
  // cachat svar visar dessutom en gammal status med en ålder som ser färsk ut,
  // eftersom updatedAgeSeconds räknas när svaret byggs. Statiska filer berörs
  // inte – de ligger efter den här och innehåller inga personuppgifter.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/competitions', (req, res) => {
    res.json(store.listCompetitions());
  });

  // Resolve which competition to use: explicit cmp or the most recent one.
  function resolveCmp(params) {
    const explicit = parseInt(params.cmp || '', 10);
    if (explicit > 0 && store.finns(explicit)) return explicit;
    const list = store.listCompetitions();
    return list.length ? list[0].id : null;
  }

  /**
   * Har klienten redan sett så många löpare den får? Taket räknar personer,
   * inte anrop, så en pollande kvittosida kostar 1 hur länge den än står
   * öppen (KRAV-5).
   */
  function förMångaSedda(req, res) {
    if (!läsgräns.överSkridet(req.ip || 'okänd')) return false;
    res.status(429).json({
      error: 'För många olika kvitton från den här enheten. Försök igen om en stund.',
    });
    return true;
  }

  const räknaSedda = (req, identiteter) => läsgräns.räkna(req.ip || 'okänd', identiteter);

  app.get('/api/search', (req, res) => {
    if (förMångaSedda(req, res)) return;
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Ange bricknummer eller namn.' });

    const explicit = parseInt(req.query.cmp || '', 10);
    // Registret pekar ut vilka tävlingar som kan matcha, så bara de läses in.
    // En sökning utan träff – det löparen får när hon stavar fel – rör ingen
    // fil alls, trots att den går igenom hela databasen (KRAV-8).
    const cmpIds = explicit > 0 && store.finns(explicit)
      ? [explicit]
      : store.tavlingarMedTraff(q);

    const hits = [];
    for (const id of cmpIds) {
      const cmp = store.hamta(id);
      if (!cmp) continue;
      hits.push(...searchCompetitors(cmp, id, q));
      if (hits.length && !(explicit > 0)) break; // latest competition with a match
    }

    // En träfflista på hela deltagarfältet hjälper ingen att hitta sig själv,
    // och skickar dessutom alla deltagare i ett svar (KRAV-5).
    if (hits.length > MAX_SEARCH_HITS) {
      return res.status(400).json({
        error: `Sökningen gav ${hits.length} träffar. Skriv mer av namnet.`,
      });
    }
    räknaSedda(req, hits.map((h) => `${h.cmp}:${h.id}`));
    res.json(hits);
  });

  // Find the card in the latest competition where it occurs (KRAV-6).
  function findByCard(card, explicitCmp) {
    const cmpIds = explicitCmp ? [explicitCmp] : store.tavlingarMedBricka(card);
    for (const cmpId of cmpIds) {
      const cmp = store.hamta(cmpId);
      if (!cmp) continue;
      const matches = Object.entries(cmp.competitors)
        .filter(([, c]) => c.card === card)
        .map(([id]) => Number(id));
      if (matches.length) return { cmpId, matches };
    }
    return null;
  }

  /**
   * Löser upp card/id/cmp till ett kvitto. Returnerar antingen { receipt }
   * eller { status, body } som svar rakt av – delas av JSON-kvittot,
   * PDF-nedladdningen (KRAV-15) och mejlutskicket (KRAV-16), som tar samma
   * parametrar men från query respektive body.
   */
  function resolveReceipt(params) {
    if (store.listCompetitions().length === 0) {
      return { status: 404, body: { error: 'Ingen tävling inläst ännu.' } };
    }

    let cmpId, competitorId;
    const explicitId = parseInt(params.id || '', 10);
    if (explicitId > 0) {
      // Löpar-id är MeOS interna och återanvänds mellan tävlingar. Pekar
      // länken på en tävling som inte finns – gallrad efter 90 dagar (KRAV-14)
      // – får uppslaget inte falla tillbaka på den senaste: då visas en
      // främmande människas kvitto för den som sparat eller delat länken.
      const explicitCmp = parseInt(params.cmp || '', 10);
      if (explicitCmp > 0 && !store.finns(explicitCmp)) {
        return {
          status: 404,
          body: {
            error:
              `Tävling ${explicitCmp} finns inte längre – tävlingsdata sparas i ` +
              'begränsad tid. Sök på ditt bricknummer eller namn.',
          },
        };
      }
      cmpId = resolveCmp(params);
      competitorId = explicitId;
      // En delad länk kan peka på ett id som ersatts sedan den skapades, t.ex.
      // när MeOS tagit över en löpare som resultatfilen skapat (KRAV-9).
      const cmp = store.hamta(cmpId);
      const ersatt = cmp?.ersattaIds?.[competitorId];
      if (ersatt && !cmp.competitors[competitorId]) {
        competitorId = ersatt;
      }
    } else {
      const card = parseInt(params.card || '', 10);
      if (!(card > 0)) {
        return { status: 400, body: { error: 'Ange bricknummer (card) eller löpar-id (id).' } };
      }

      const explicit = parseInt(params.cmp || '', 10);
      const found = findByCard(card, explicit > 0 && store.finns(explicit) ? explicit : null);
      if (!found) {
        return { status: 404, body: { error: `Ingen löpare med bricka ${card} hittades.` } };
      }
      if (found.matches.length > 1) {
        // Delad bricka: låt användaren välja (KRAV-7).
        return {
          status: 300,
          body: {
            alternatives: searchCompetitors(store.hamta(found.cmpId), found.cmpId, String(card)),
          },
        };
      }
      cmpId = found.cmpId;
      competitorId = found.matches[0];
    }

    const receipt = buildReceipt(store.hamta(cmpId), cmpId, competitorId);
    if (!receipt) return { status: 404, body: { error: 'Löparen hittades inte.' } };
    return { receipt };
  }

  /** Vilka personer ett kvittosvar röjer – kvittot självt, eller en valbar lista. */
  function identiteterI(receipt, body) {
    if (receipt) return [`${receipt.competition.id}:${receipt.runner.id}`];
    return (body?.alternatives || []).map((h) => `${h.cmp}:${h.id}`);
  }

  app.get('/api/receipt', (req, res) => {
    if (förMångaSedda(req, res)) return;
    const { receipt, status, body } = resolveReceipt(req.query);
    räknaSedda(req, identiteterI(receipt, body));
    if (!receipt) return res.status(status).json(body);
    res.json(receipt);
  });

  // Kvittot som nedladdningsbar PDF (KRAV-15).
  app.get('/api/receipt.pdf', (req, res) => {
    if (förMångaSedda(req, res)) return;
    const { receipt, status, body } = resolveReceipt(req.query);
    räknaSedda(req, identiteterI(receipt, body));
    if (!receipt) return res.status(status).json(body);

    const pdf = renderReceiptPdf(receipt);
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receiptFilename(receipt)}"`);
    res.send(pdf);
  });

  // Kvittot mejlat som PDF-bilaga (KRAV-16).
  app.post('/api/receipt/email', express.json({ limit: '4kb' }), async (req, res) => {
    if (!mailer) {
      return res.status(503).json({ error: 'E-postutskick är inte aktiverat på den här servern.' });
    }

    const to = String(req.body?.email ?? '').trim();
    if (!isValidEmail(to)) {
      return res.status(400).json({ error: 'Ange en giltig e-postadress.' });
    }

    const { receipt, status, body } = resolveReceipt(req.body ?? {});
    if (!receipt) return res.status(status).json(body);

    // Taket gäller per avsändar-IP, inte per mottagare: annars räcker det med
    // att byta adress för att skicka hur många mejl som helst.
    if (!emailLimiter.allow(req.ip || 'okänd')) {
      return res.status(429).json({
        error: 'För många utskick från den här enheten. Försök igen om en stund.',
      });
    }

    try {
      await mailer.sendReceipt({ to, receipt });
      res.json({ ok: true, sent: to });
    } catch (err) {
      // Leverantörens felmeddelanden kan innehålla konto- och serverdetaljer –
      // logga dem, men skicka aldrig vidare dem till klienten. Adresserna
      // maskeras: loggen lever kvar långt efter att tävlingsdatan gallrats.
      console.error('Kunde inte skicka kvitto per e-post:', maskeraAdresser(err.message));
      res.status(502).json({ error: 'Kvittot kunde inte mejlas just nu. Försök igen senare.' });
    }
  });

  app.get('/api/health', (req, res) => {
    const { persistens, sparfel } = store.status();
    res.json({
      // ok betyder "tjänsten svarar" och förblir true även när sparningen
      // krånglar – annars skulle en övervakare kunna starta om maskinen och
      // radera just den data som inte hunnit till disken.
      ok: true,
      competitions: store.listCompetitions().length,
      email: Boolean(mailer), // styr om kvittosidan visar mejlformuläret
      persistens,
      ...(sparfel ? { sparfel } : {}),
      ...(proxyvarning ? { proxyvarning } : {}),
    });
  });

  // --- Static frontend -----------------------------------------------------
  // I den paketerade exe-filen (Node SEA) blir __dirname mappen där exen
  // ligger, så public/ levereras bredvid den. PUBLIC_DIR kan alltid överstyra.
  const publicDir = process.env.PUBLIC_DIR || path.join(__dirname, 'public');

  /**
   * En adress per tävling (KRAV-18), att trycka i PM eller sätta som QR-kod.
   * Den måste fungera innan tävlingen börjat – PM trycks i förväg – så den
   * bryr sig inte om tävlingen finns. Sidan säger själv ifrån när det inte
   * kommit några resultat.
   *
   * Bara siffror: allt annat faller igenom till 404 i stället för att bli en
   * väg in i filsystemet.
   */
  app.get('/t/:cid', (req, res, next) => {
    if (!/^[0-9]+$/.test(req.params.cid)) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(express.static(publicDir));

  return app;
}
