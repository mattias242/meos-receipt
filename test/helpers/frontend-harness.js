import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * Kör public/app.js på riktigt, med stubbad DOM och en klocka testet styr.
 *
 * Kvittosidan har ingen byggkedja och har därför testats genom att läsa
 * källkoden som text. Det har gått fel två gånger: ett test matchade
 * `fetch(url, opts)` och slutade betyda något när anropet fick en signal, och
 * ett annat räknade träffar i fel del av utdatan. En textmatchning kan säga
 * att en rad finns – inte att den gör något.
 *
 * Härifrån går det i stället att fråga vad sidan faktiskt gör: hur många
 * anrop den har ute samtidigt, vad den skriver ut, hur den beter sig när
 * servern är långsam.
 */

const APP = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
  'app.js'
);

/**
 * Ett DOM-element så långt app.js rör vid det.
 *
 * `onNyHtml` anropas när innerHTML skrivs om. Webbläsaren skapar då nya noder
 * för allt som låg i elementet, och den kod som redan hämtat de gamla håller
 * kvar dem – frånkopplade och osynliga. Utan att härma det skulle testet inte
 * kunna se skillnad på "skriver till sidan" och "skriver till ett lik".
 */
function element(id, onNyHtml) {
  let html = '';
  const el = {
    id,
    textContent: '',
    get innerHTML() {
      return html;
    },
    set innerHTML(v) {
      html = v;
      onNyHtml?.(v);
    },
    value: '',
    hidden: false,
    dataset: {},
    klasser: new Set(),
    classList: {
      toggle(namn, på) {
        if (på) this.ägare.klasser.add(namn);
        else this.ägare.klasser.delete(namn);
      },
    },
    reset() {
      this.value = '';
    },
    lyssnare: {},
    addEventListener(typ, fn) {
      (this.lyssnare[typ] ||= []).push(fn);
    },
    /** Så mycket av sökningen som app.js behöver: en stabil stub per väljare. */
    querySelector(väljare) {
      this.barn ||= {};
      return (this.barn[väljare] ||= element(`${id}>${väljare}`));
    },
    closest() {
      return null;
    },
    /** Utlöser en händelse som om användaren gjort något. */
    utlös(typ, händelse = {}) {
      const e = { preventDefault() {}, target: this, ...händelse };
      return Promise.all((this.lyssnare[typ] || []).map((fn) => fn(e)));
    },
  };
  el.classList.ägare = el;
  return el;
}

/** Virtuell klocka: inget händer förrän testet flyttar fram tiden. */
function klocka() {
  let nu = 0;
  let nästa = 1;
  const jobb = new Map(); // id -> { tid, fn, intervall }

  const api = {
    setTimeout(fn, ms = 0) {
      const id = nästa++;
      jobb.set(id, { tid: nu + ms, fn });
      return id;
    },
    setInterval(fn, ms = 0) {
      const id = nästa++;
      jobb.set(id, { tid: nu + ms, fn, intervall: ms });
      return id;
    },
    clearTimeout: (id) => jobb.delete(id),
    clearInterval: (id) => jobb.delete(id),
  };

  /**
   * Flyttar fram tiden och kör det som förfaller på vägen. Släpper fram
   * mikrotasks mellan varje jobb, så att await-kedjor hinner ikapp.
   */
  api.tick = async (ms) => {
    const slut = nu + ms;
    for (;;) {
      let bästa = null;
      for (const [id, j] of jobb) {
        if (j.tid <= slut && (!bästa || j.tid < bästa.j.tid)) bästa = { id, j };
      }
      if (!bästa) break;
      nu = bästa.j.tid;
      if (bästa.j.intervall) bästa.j.tid = nu + bästa.j.intervall;
      else jobb.delete(bästa.id);
      bästa.j.fn();
      await new Promise((r) => setImmediate(r));
    }
    nu = slut;
    await new Promise((r) => setImmediate(r));
  };

  api.väntande = () => jobb.size;
  return api;
}

/**
 * Laddar kvittosidan.
 *
 * `svar(url, opts)` är servern: returnera `{ status, body }`, eller ett löfte
 * som dröjer, eller kasta för att härma tappad täckning.
 */
export function laddaSidan({ svar = () => ({ status: 200, body: {} }), search = '' } = {}) {
  const el = new Map();
  const hämta = (id) => {
    if (!el.has(id)) {
      el.set(
        id,
        element(id, (html) => {
          // Allt som låg inuti ersattes av nya noder. Släpp de gamla, så att
          // en hämtning efteråt ger den nya – och en gammal referens fortsätter
          // peka på den frånkopplade, precis som i webbläsaren.
          for (const m of html.matchAll(/\bid="([^"]+)"/g)) el.delete(m[1]);
        })
      );
    }
    return el.get(id);
  };
  // Sidan läser dessa vid start; de måste finnas innan koden körs.
  for (const id of ['searchForm', 'query', 'cmpSelect', 'message', 'hits', 'receipt']) hämta(id);

  const tid = klocka();
  const anrop = []; // varje fetch: { url, opts, klar }
  let ute = [];
  let flest = [];

  const context = {
    console,
    URL,
    URLSearchParams,
    AbortController,
    encodeURIComponent,
    document: { getElementById: (id) => hämta(id) },
    location: { href: `http://test/${search}`, search },
    history: { replaceState() {} },
    navigator: {},
    setTimeout: tid.setTimeout,
    clearTimeout: tid.clearTimeout,
    setInterval: tid.setInterval,
    clearInterval: tid.clearInterval,
    async fetch(url, opts) {
      const post = { url, opts, klar: false };
      anrop.push(post);
      ute.push(post);
      // Spara varje ögonblicksbild av vad som var ute samtidigt, så att testet
      // kan fråga om just kvittoanropen – sidstarten hämtar medvetet health
      // och competitions parallellt, och det ska inte räknas som överlapp.
      flest.push([...ute]);
      try {
        // Sidan sätter en tidsgräns med AbortController. Härmar fetch inte
        // det skulle en långsam server se snabbare ut här än i verkligheten.
        const avbrott = new Promise((_, avslå) => {
          const s = opts?.signal;
          if (!s) return;
          if (s.aborted) avslå(new Error('AbortError'));
          else s.addEventListener('abort', () => avslå(new Error('AbortError')));
        });
        const r = await Promise.race([svar(url, opts, tid), avbrott]);
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          json: async () => r.body,
        };
      } finally {
        post.klar = true;
        ute = ute.filter((a) => a !== post);
      }
    },
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(APP, 'utf8'), context, { filename: 'app.js' });

  return {
    el: hämta,
    tick: tid.tick,
    anrop,
    /**
     * Största antal anrop som varit ute samtidigt, räknat bara bland dem vars
     * url matchar `mönster` (default: alla).
     */
    flestSamtidigt: (mönster = /./) =>
      flest.reduce((max, bild) => Math.max(max, bild.filter((a) => mönster.test(a.url)).length), 0),
    väntandeTimers: tid.väntande,
  };
}
