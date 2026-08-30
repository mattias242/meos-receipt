/**
 * Användningsstatistik per tävling (KRAV-21) och löparens omdöme (KRAV-22).
 *
 * Måtten finns för att kunna svara på om det digitala kvittot är värt något:
 * andelen av de startande som öppnar sitt kvitto, hur många som tar PDF:en
 * eller mejlar den, och vad löparna svarar på tummen. Nämnaren – de startande
 * – räknas inte här utan där tävlingsdatan finns (server.js), så att den
 * betyder samma sak som placeringen på kvittot.
 *
 * Två saker som är lätta att bryta:
 *
 * **Vilka löpare som tittat lagras aldrig.** De unika id:na hålls i en mängd i
 * minnet och bara antalet skrivs till disk. Priset är att en löpare som
 * återkommer efter en omstart räknas två gånger – mängden börjar tom medan
 * antalet läses in. Det är avsiktligt: alternativet vore ett register över vem
 * som öppnat sitt kvitto, och det är samma skäl som håller frontend fri från
 * externa resurser. Ett fel på några enstaka i en siffra som ska jämföras med
 * antalet startande spelar ingen roll; registret gör det.
 *
 * **Statistiken ligger i en egen fil, inte i tävlingens.** MeOS skickar en ny
 * MOPComplete varje gång Onlineresultat startas om, och den nollställer
 * tävlingen (KRAV-2). Låg mätningen där skulle den försvinna mitt under
 * tävlingsdagen – samma fälla som `punches` och `ersattaIds` måste räddas ur.
 */
import fs from 'node:fs';
import path from 'node:path';

const FILNAMN = 'statistik.json';

/** Ett tomt mätvärde. Aldrig undefined: anroparen ska slippa fråga. */
const tomPost = () => ({
  kvittonVisade: 0,
  pdf: 0,
  mejl: 0,
  sokningar: 0,
  upp: 0,
  ner: 0,
  forsta: null,
  senaste: null,
});

export function createStatistik({ dataDir = null, saveDelayMs = 2000, now = () => Date.now() } = {}) {
  const katalog = dataDir || null;
  const fil = katalog ? path.join(katalog, FILNAMN) : null;

  /** cid -> mätvärden. Skrivs till disk. */
  const poster = new Map();
  /** cid -> mängd löpar-id som setts. Bara i minnet, aldrig sparad. */
  const sedda = new Map();

  let saveTimer = null;
  let sparfel = null;

  if (fil && fs.existsSync(fil)) {
    try {
      const inlast = JSON.parse(fs.readFileSync(fil, 'utf8'));
      for (const [cid, u] of Object.entries(inlast)) {
        poster.set(String(cid), { ...tomPost(), ...u });
      }
    } catch (err) {
      // En trasig statistikfil får aldrig hindra löparna från att hämta sina
      // kvitton. Mätningen börjar om; tävlingsdatan är orörd.
      console.error(`Statistiken gick inte att läsa in: ${err.message}`);
    }
  }

  function post(cid) {
    const nyckel = String(cid);
    let u = poster.get(nyckel);
    if (!u) {
      u = tomPost();
      poster.set(nyckel, u);
    }
    return u;
  }

  /** Märker en tävling som använd just nu och schemalägger sparning. */
  function rör(cid) {
    const u = post(cid);
    const tid = new Date(now()).toISOString();
    if (!u.forsta) u.forsta = tid;
    u.senaste = tid;
    schemalaggSparning();
    return u;
  }

  function skriv() {
    if (!katalog) return;
    try {
      fs.mkdirSync(katalog, { recursive: true });
      const tmp = `${fil}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(poster)));
      fs.renameSync(tmp, fil);
      sparfel = null;
    } catch (err) {
      sparfel = err.message;
      console.error('Kunde inte spara statistiken:', err.message);
    }
  }

  function schemalaggSparning() {
    if (!katalog || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      skriv();
    }, saveDelayMs);
    saveTimer.unref?.();
  }

  return {
    /**
     * En löpare har sett sitt kvitto. Samma löpare räknas en gång hur många
     * gånger sidan än pollar – annars mäts hur länge sidan stod öppen.
     */
    kvitto(cid, loparId) {
      const nyckel = String(cid);
      let mängd = sedda.get(nyckel);
      if (!mängd) {
        mängd = new Set();
        sedda.set(nyckel, mängd);
      }
      const u = rör(cid);
      if (mängd.has(loparId)) return;
      mängd.add(loparId);
      u.kvittonVisade += 1;
    },

    pdf(cid) {
      rör(cid).pdf += 1;
    },

    mejl(cid) {
      rör(cid).mejl += 1;
    },

    sokning(cid) {
      rör(cid).sokningar += 1;
    },

    /** Löparens omdöme (KRAV-22). Returnerar false om svaret inte är giltigt. */
    rosta(cid, svar) {
      if (svar !== 'upp' && svar !== 'ner') return false;
      rör(cid)[svar] += 1;
      return true;
    },

    /** Mätvärdena för en tävling. Alltid ett objekt, aldrig undefined. */
    for(cid) {
      return { ...tomPost(), ...(poster.get(String(cid)) || {}) };
    },

    /** Allt, per tävlings-id. */
    allt() {
      return Object.fromEntries([...poster].map(([cid, u]) => [cid, { ...u }]));
    },

    /** Tävlingen är gallrad (KRAV-14) – glöm mätningen med den. */
    glom(cid) {
      const nyckel = String(cid);
      poster.delete(nyckel);
      sedda.delete(nyckel);
      schemalaggSparning();
    },

    status() {
      return { persistens: Boolean(katalog), ...(sparfel ? { sparfel } : {}) };
    },

    /** Skriver det som väntar, nu. */
    flush() {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      skriv();
    },

    close() {
      this.flush();
    },
  };
}
