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
import { createStatistik } from './lib/statistik.js';

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
  // KRAV-22: tak per avsändar-IP på tummen. Se röstLimiter nedan.
  feedbackRateLimit = {},
  trustProxy = false,
  // KRAV-20: värdnamn → tävlings-id. Tom = ingen bindning, förstasidan som vanligt.
  vardnamnTavlingar = new Map(),
  // KRAV-5: tak för hur många olika löpare en klient får se. 0 = av.
  // Testerna kör utan tak om de inte ber om ett; annars skulle varje test som
  // hämtar många kvitton bli beroende av taket.
  readLimit = 0,
} = {}) {
  // KRAV-21: hur tjänsten används, aggregerat per tävling. Skapas före store,
  // eftersom gallringen ska ta statistiken med sig.
  const statistik = createStatistik({ dataDir, saveDelayMs, now });
  const store = createStore({
    dataDir,
    saveDelayMs,
    retentionDays,
    now,
    onGallrad: (ids) => ids.forEach((id) => statistik.glom(id)),
  });
  const emailLimiter = createRateLimiter(emailRateLimit);
  const läsgräns = createReadLimiter({ max: readLimit });
  // Rösten är ett klick, inte ett mejl – taket sitter bara för att en enskild
  // klient inte ska kunna fylla mätningen. Det måste vara generöst: på arenan
  // ligger hundratals löpare bakom samma operatörsadress (KRAV-22).
  const röstLimiter = createRateLimiter({ max: 50, windowMs: 10 * 60 * 1000, ...feedbackRateLimit });
  const app = express();
  app.disable('x-powered-by');
  // Den som binder porten behöver kunna tömma sparkön vid avslut (KRAV-8).
  app.locals.store = store;
  app.locals.statistik = statistik;
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
  /**
   * Hur många led som rapporteras i X-Forwarded-For, räknat per antal.
   *
   * Det *vanligaste* antalet är svaret, inte det minsta eller det högsta.
   * Tjänsten nås både via Cloudflare (två led) och direkt mot origin-adressen
   * (ett led), och en klient kan dessutom fylla på headern med egna. Med
   * minimum räckte ett enda direktanrop för att tysta varningen om
   * inställningen var för låg – skyddsnätet gick alltså att stänga av
   * utifrån. Med maximum räckte ett påhittat led för att framkalla en falsk.
   * Verklig trafik dominerar, och därför håller det vanligaste.
   */
  const hoppRakning = new Map();
  let proxyhopp = null;

  app.use((req, res, next) => {
    const rå = req.get('x-forwarded-for');
    if (rå) {
      const led = rå.split(',').filter((d) => d.trim()).length;
      hoppRakning.set(led, (hoppRakning.get(led) || 0) + 1);
      // Lika ofta förekommande: välj det högre. Hellre en varning att
      // undersöka än ett tyst fel som märks först när ingen kan mejla.
      proxyhopp = [...hoppRakning.entries()].reduce(
        (bäst, [antalLed, gånger]) =>
          gånger > bäst[1] || (gånger === bäst[1] && antalLed > bäst[0]) ? [antalLed, gånger] : bäst,
        [0, -1]
      )[0];

      // Bakom Cloudflare *och* nginx är det två led. Med TRUST_PROXY=1 blir
      // löparens adress i stället Cloudflares – gemensam för alla – och
      // mejltaket låser ute hela tävlingen efter fem utskick. Samma fel som
      // utan inställning alls, bara ett steg längre ut.
      const ny = !trustProxy
        ? 'Anrop kommer via en proxy men TRUST_PROXY är inte satt – taket för ' +
          'mejlutskick räknar då alla löpare som samma avsändare.'
        : proxyhopp > trustProxy
          ? `Anropen kommer via ${proxyhopp} proxyled men TRUST_PROXY är ` +
            `${trustProxy} – löparens adress blir då proxyns, gemensam för alla. ` +
            `Sätt TRUST_PROXY till ${proxyhopp}.`
          : null;

      // En rad per iakttagelse, inte en per anrop: loggen behövs som mest
      // under tävling.
      if (ny && ny !== proxyvarning) {
        proxyvarning = ny;
        console.warn(`VARNING: ${ny}`);
      }
    }
    next();
  });

  // --- XML push endpoints (MeOS online + resultatautomat) ------------------
  // Same header protocol for both: competition (id) and pwd (password).
  /**
   * MOP-svaret måste vara XML (KRAV-1). MeOS XML-parsar svaret och letar efter
   * elementet `MOPStatus`; hittar den inget blir statusen tom, och då bryter
   * den sändningsloopen. Det är inte kosmetiskt: MeOS styckar en tävling i
   * klumpar om 64 objekt där bara den första bär `MOPComplete`, så ett svar
   * MeOS inte förstår gör att bara den klumpen kommer fram – och eftersom
   * tävling, klasser och klubbar ligger först är det löparna som uteblir.
   * MeOS kvitterar inte heller sändningen, så hela tävlingen skickas om vid
   * varje intervall i stället för en liten diff.
   *
   * `/iof` ingår inte i MOP – MeOS talar aldrig med den – så den behåller ren
   * text, vilket uppladdningsprogrammet (KRAV-11) matchar på.
   */
  const mopStatus = (kod) => `<?xml version="1.0"?><MOPStatus status="${kod}"></MOPStatus>`;

  function receiveXml(apply, { svar = mopStatus, typ = 'application/xml' } = {}) {
    return [
      express.raw({ type: () => true, limit: '32mb' }),
      (req, res) => {
        res.type(typ);
        const svara = (kod) => res.send(svar(kod));

        const cmpId = parseInt(req.get('competition') || '', 10);
        if (!(cmpId > 0)) return svara('BADCMP');

        if (password && req.get('pwd') !== password) return svara('BADPWD');

        const data = req.body;
        if (!Buffer.isBuffer(data) || data.length === 0) return svara('ERROR');

        // Zip (börjar med 'PK') stöds inte. MeOS sänder inte om okomprimerat –
        // den avbryter med ett fel – så "Packa stora filer" måste vara av.
        if (data[0] === 0x50 && data[1] === 0x4b) return svara('NOZIP');

        try {
          apply(cmpId, data.toString('utf8'));
        } catch (err) {
          console.error('Mottagningsfel:', err.message);
          return svara('ERROR');
        }
        return svara('OK');
      },
    ];
  }

  const mopHandler = receiveXml((cid, xml) => applyMop(store, cid, xml));
  app.post('/meos', ...mopHandler);
  app.post('/update', ...mopHandler);
  app.post('/update.php', ...mopHandler);

  // IOF XML 3.0 ResultList med sträcktider, från MeOS resultatautomat (KRAV-9).
  // Klienten är vårt eget uppladdningsprogram, inte MeOS – ren text (KRAV-11).
  app.post(
    '/iof',
    ...receiveXml((cid, xml) => applyIof(store, cid, xml), {
      svar: (kod) => kod,
      typ: 'text/plain',
    })
  );

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
    // Sökningen räknas på den tävling träffarna kom ur; en sökning utan träff
    // hör inte till någon tävling och räknas därför inte.
    if (hits.length) statistik.sokning(hits[0].cmp);
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
    // KRAV-21: samma löpare räknas en gång, hur ofta sidan än pollar.
    statistik.kvitto(receipt.competition.id, receipt.runner.id);
    res.json(receipt);
  });

  // Kvittot som nedladdningsbar PDF (KRAV-15).
  app.get('/api/receipt.pdf', (req, res) => {
    if (förMångaSedda(req, res)) return;
    const { receipt, status, body } = resolveReceipt(req.query);
    räknaSedda(req, identiteterI(receipt, body));
    if (!receipt) return res.status(status).json(body);

    statistik.pdf(receipt.competition.id);
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
      statistik.mejl(receipt.competition.id);
      res.json({ ok: true, sent: to });
    } catch (err) {
      // Leverantörens felmeddelanden kan innehålla konto- och serverdetaljer –
      // logga dem, men skicka aldrig vidare dem till klienten. Adresserna
      // maskeras: loggen lever kvar långt efter att tävlingsdatan gallrats.
      console.error('Kunde inte skicka kvitto per e-post:', maskeraAdresser(err.message));
      res.status(502).json({ error: 'Kvittot kunde inte mejlas just nu. Försök igen senare.' });
    }
  });

  /**
   * Hur många i tävlingen som faktiskt kom till start – nämnaren i andelen som
   * öppnat sitt kvitto (KRAV-21). Räknas som placeringen gör (KRAV-4), så att
   * siffran betyder samma sak som kvittot visar: ej start, återbud och deltar
   * ej var aldrig ute på banan.
   */
  function antalStartande(cid) {
    const cmp = store.hamta(cid);
    if (!cmp) return 0;
    return Object.values(cmp.competitors || {}).filter(
      (c) => c.stat !== 20 && c.stat !== 21 && c.stat !== 99
    ).length;
  }

  /**
   * Mätningen, aggregerad per tävling (KRAV-21, KRAV-22). Innehåller inga
   * personuppgifter – varken vem som tittat eller vem som röstat – och röjer
   * därför inte mer än tävlingslistan redan gör.
   */
  app.get('/api/statistik', (req, res) => {
    const rader = store.listCompetitions().map((c) => {
      const u = statistik.for(c.id);
      const startande = antalStartande(c.id);
      return {
        id: c.id,
        name: c.name,
        date: c.date,
        startande,
        ...u,
        // Andelen av de startande som öppnat sitt kvitto – det mått beslutet
        // vilar på. null när ingen startat: 0/0 är inte noll procent.
        andelOppnat: startande > 0 ? Math.round((u.kvittonVisade / startande) * 1000) / 1000 : null,
      };
    });
    res.json(rader);
  });

  /**
   * Löparens omdöme: "Var detta värdefullt för dig?" (KRAV-22).
   *
   * Bär medvetet varken löpar-id eller bricka. Följde de med vore det lagrade
   * svaret "löpare 42 tyckte det var dåligt" – en uppgift om en identifierbar
   * person, och precis den registrering tjänsten undviker på annat håll.
   */
  app.post('/api/feedback', express.json({ limit: '1kb' }), (req, res) => {
    const cid = parseInt(req.body?.cmp ?? '', 10);
    if (!(cid > 0) || !store.finns(cid)) {
      return res.status(404).json({ error: 'Okänd tävling.' });
    }
    if (!röstLimiter.allow(req.ip || 'okänd')) {
      return res.status(429).json({ error: 'För många svar från den här enheten.' });
    }
    if (!statistik.rosta(cid, String(req.body?.svar ?? ''))) {
      return res.status(400).json({ error: 'Svaret måste vara "upp" eller "ner".' });
    }
    res.json({ ok: true });
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
      ...(proxyhopp !== null ? { proxyhopp } : {}),
      ...(proxyvarning ? { proxyvarning } : {}),
    });
  });

  // --- Static frontend -----------------------------------------------------
  // I den paketerade exe-filen (Node SEA) blir __dirname mappen där exen
  // ligger, så public/ levereras bredvid den. PUBLIC_DIR kan alltid överstyra.
  const publicDir = process.env.PUBLIC_DIR || path.join(__dirname, 'public');

  /**
   * Ett värdnamn bundet till en bestämd tävling (KRAV-20). Arrangören trycker
   * klubbens egen adress i PM – kvitto.klubben.se – och löparen hamnar på
   * tävlingens adress utan att se något tävlings-id.
   *
   * 302 och aldrig 301: bindningen pekas om inför varje arrangemang, och en
   * permanent vidareskickning ligger kvar i löparnas webbläsare och visar förra
   * tävlingens kvitton nästa gång. Adressen är relativ, så löparen blir kvar på
   * klubbens värdnamn – annars försvinner den tryckta adressen ur adressfältet
   * vid första klicket och delade kvittolänkar pekar tillbaka hit i stället.
   *
   * Bara förstasidan berörs. /t/<id> gäller alla värdnamn, även ett bundet.
   */
  app.get('/', (req, res, next) => {
    const cid = vardnamnTavlingar.get(String(req.hostname || '').toLowerCase());
    if (!cid) return next();
    res.redirect(302, `/t/${cid}`);
  });

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
