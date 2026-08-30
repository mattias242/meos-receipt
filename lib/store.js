import fs from 'node:fs';
import path from 'node:path';

/**
 * In-memory store of MeOS competition data (MOP protocol), with optional
 * JSON persistence so data survives a restart.
 *
 * Shape per competition (keyed by MeOS competition id, "cid"):
 *   info        { name, date, organizer, homepage, zerotime }
 *   controls    { [id]: { name } }
 *   classes     { [id]: { name, ord, radio, crs } }
 *   orgs        { [id]: { name, nat } }
 *   competitors { [id]: { name, card, cls, org, stat, st, rt, prel,
 *                         competing, bib, nat, radios: [{ctrl, rt}],
 *                         input: {it, tstat} } }
 *   teams       { [id]: { name, cls, org, stat, st, rt, members: [[ids]] } }
 *   updated     ISO timestamp of last received update
 *
 * Data gallras efter `retentionDays` dagars inaktivitet (KRAV-14); `now`
 * injiceras så att gallringen kan testas utan att vänta.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function createStore({
  dataDir = null,
  saveDelayMs = 2000,
  retentionDays = 90,
  purgeIntervalMs = DAY_MS,
  // Hur många tävlingar som hålls inlästa samtidigt. Under tävling är det en.
  cacheMax = 4,
  now = () => Date.now(),
  // Anropas med de tävlings-id som gallrats, så att det som hänger på en
  // tävling utan att ligga i dess fil (KRAV-21) kan följa med bort.
  onGallrad = () => {},
} = {}) {
  // En fil per tävling. Att skriva om hela databasen kostade 60 ms blockerad
  // eventloop med 90 dagars data, varje gång någon tävling ändrades – och en
  // oläsbar fil kostade samtliga nittio dagar. Nu kostar en ändring bara sin
  // egen tävling, och en trasig fil bara sin egen tävling.
  const katalog = dataDir ? path.join(dataDir, 'tavlingar') : null;
  const gammalFil = dataDir ? path.join(dataDir, 'competitions.json') : null;
  const filFor = (cid) => path.join(katalog, `${cid}.json`);
  const smutsiga = new Set(); // tävlingar som ändrats sedan senaste sparningen
  const borttagna = new Set(); // tävlingar vars fil ska bort

  /**
   * Registret: allt som behövs för att svara utan att läsa in en tävling.
   *
   * Uppmätt på 90 dagars data med stämplingar kostade allt i minnet 40 MB
   * heap, medan namn och bricknummer kostar 17. Skillnaden är stämplingarna,
   * och de behövs bara när ett kvitto faktiskt ska byggas. En sökning utan
   * träff – det löparen får när hon stavar fel – rör därför ingen fil alls.
   *
   *   uppgifter: cid -> { name, date, organizer, homepage, updated }
   *   lopare:    cid -> [{ id, card, name }]
   */
  const uppgifter = new Map();
  const lopare = new Map();

  // Inlästa tävlingar, senast använd sist. `competitions` är den här cachen –
  // alltså det som är inne just nu, inte allt som finns.
  const competitionsCache = new Map();
  let saveTimer = null;
  let sparfel = null; // senaste misslyckade sparningen, null när allt är bra

  /** Registrerar det som går att svara på utan att läsa in tävlingen. */
  function indexera(cid, cmp) {
    const nyckel = String(cid);
    uppgifter.set(nyckel, {
      name: cmp.info?.name || '',
      date: cmp.info?.date || '',
      organizer: cmp.info?.organizer || '',
      homepage: cmp.info?.homepage || '',
      updated: cmp.updated || null,
    });
    const rader = [];
    for (const [id, c] of Object.entries(cmp.competitors || {})) {
      rader.push({ id: Number(id), card: c.card || 0, name: c.name || '' });
    }
    lopare.set(nyckel, rader);
  }

  /**
   * Uppgifterna om en tävling. Är den inläst är objektet självt sanningen –
   * registret är en ögonblicksbild, och den som ändrar en tävling gör det på
   * objektet. Utan det här skulle en ändring synas i kvittot men inte i
   * tävlingslistan förrän touch() hunnit köra.
   */
  function uppgifterFor(cid) {
    const cmp = competitionsCache.get(String(cid));
    if (!cmp) return uppgifter.get(String(cid));
    return {
      name: cmp.info?.name || '',
      date: cmp.info?.date || '',
      organizer: cmp.info?.organizer || '',
      homepage: cmp.info?.homepage || '',
      updated: cmp.updated || null,
    };
  }

  /**
   * Lägger tävlingen i cachen som senast använd och släpper de minst använda.
   * En tävling som väntar på att sparas får aldrig kastas ut – ändringen finns
   * bara i minnet, och skulle vara borta för gott.
   */
  function cacha(cid, cmp) {
    const nyckel = String(cid);
    competitionsCache.delete(nyckel);
    competitionsCache.set(nyckel, cmp);
    for (const gammal of [...competitionsCache.keys()]) {
      if (competitionsCache.size <= cacheMax) break;
      if (gammal === nyckel || smutsiga.has(gammal)) continue;
      competitionsCache.delete(gammal);
    }
    return cmp;
  }

  /**
   * Tävlingen, inläst från sin fil om den inte redan är det. Synkront med
   * flit: uppslaget är 1,8 ms för en tävling, och hela kedjan ovanför – från
   * kvitto-API:t till PDF:en – är byggd som synkron kod.
   */
  function hamta(cid) {
    const nyckel = String(cid);
    if (competitionsCache.has(nyckel)) return cacha(nyckel, competitionsCache.get(nyckel));
    if (!uppgifter.has(nyckel) || !katalog) return undefined;
    try {
      return cacha(nyckel, JSON.parse(fs.readFileSync(filFor(nyckel), 'utf8')));
    } catch (err) {
      console.error(`Tävling ${cid} gick inte att läsa in: ${err.message}`);
      return undefined;
    }
  }

  /**
   * Läser in en tävling. Går filen inte att tolka läggs den undan i stället
   * för att skrivas över vid nästa sparning – då går innehållet att rädda för
   * hand (KRAV-8). Övriga tävlingar berörs inte.
   */
  function lasTavling(namn) {
    const cid = Number(namn.replace(/\.json$/, ''));
    const sokvag = path.join(katalog, namn);
    try {
      // Bara registret behålls; själva tävlingen släpps och läses in igen
      // när någon faktiskt frågar efter den.
      indexera(cid, JSON.parse(fs.readFileSync(sokvag, 'utf8')));
    } catch (err) {
      const undanlagd = `${sokvag}.trasig-${now()}`;
      try {
        fs.renameSync(sokvag, undanlagd);
        console.error(
          `Tävling ${cid} gick inte att läsa och hoppas över: ${err.message}\n` +
            `Filen har sparats undan som ${undanlagd}`
        );
      } catch (renameErr) {
        console.error(
          `Tävling ${cid} gick inte att läsa: ${err.message}\n` +
            `VARNING: filen kunde inte sparas undan (${renameErr.message}).`
        );
      }
    }
  }

  /**
   * En installation från tiden med en enda competitions.json delas upp vid
   * start. Originalet läggs undan i stället för att raderas: går uppdelningen
   * fel ska datan gå att rädda för hand. Finns redan uppdelade filer är de
   * sanningen, och en kvarglömd competitions.json lämnas därhän.
   */
  function delaUppGammalFil() {
    if (!fs.existsSync(gammalFil)) return;
    if (fs.existsSync(katalog) && fs.readdirSync(katalog).some((f) => f.endsWith('.json'))) {
      console.warn(
        `${gammalFil} finns kvar men tävlingarna är redan uppdelade – filen ` +
          'läses inte in. Ta bort den när du kontrollerat att inget saknas.'
      );
      return;
    }
    let allt;
    try {
      allt = JSON.parse(fs.readFileSync(gammalFil, 'utf8'));
    } catch (err) {
      const undanlagd = `${gammalFil}.trasig-${now()}`;
      try {
        fs.renameSync(gammalFil, undanlagd);
        console.error(
          `Kunde inte läsa sparad data, startar tomt: ${err.message}\n` +
            `Den oläsbara filen har sparats undan som ${undanlagd}`
        );
      } catch (renameErr) {
        console.error(
          `Kunde inte läsa sparad data, startar tomt: ${err.message}\n` +
            `VARNING: filen kunde inte sparas undan (${renameErr.message}).`
        );
      }
      return;
    }
    fs.mkdirSync(katalog, { recursive: true });
    for (const [cid, cmp] of Object.entries(allt)) skrivTavling(cid, cmp);
    const undanlagd = `${gammalFil}.uppdelad-${now()}`;
    fs.renameSync(gammalFil, undanlagd);
    console.log(
      `Delade upp ${Object.keys(allt).length} tävlingar i ${katalog}. ` +
        `Originalet ligger kvar som ${undanlagd} och gallras som annan data.`
    );
  }

  if (katalog) {
    delaUppGammalFil();
    if (fs.existsSync(katalog)) {
      for (const namn of fs.readdirSync(katalog)) {
        // Sparningen skriver till en tmp-fil och byter sedan namn. Avbryts
        // processen däremellan blir tmp-filen liggande, ofullständig.
        if (namn.endsWith('.tmp')) {
          try {
            fs.unlinkSync(path.join(katalog, namn));
            console.log(`Städade bort en ofullständig sparfil: ${namn}`);
          } catch (err) {
            console.error('Kunde inte städa bort ofullständig sparfil:', err.message);
          }
          continue;
        }
        if (namn.endsWith('.json')) lasTavling(namn);
      }
    }
  }

  /** Skriver en tävling via tmp + rename, så att ett avbrott inte ger en halv fil. */
  function skrivTavling(cid, cmp) {
    const sokvag = filFor(cid);
    const tmp = `${sokvag}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cmp));
    fs.renameSync(tmp, sokvag);
  }

  function saveNow() {
    if (!katalog) return;
    try {
      fs.mkdirSync(katalog, { recursive: true });
      for (const cid of borttagna) {
        try {
          fs.unlinkSync(filFor(cid));
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
      borttagna.clear();
      for (const cid of smutsiga) {
        const cmp = competitionsCache.get(String(cid));
        if (cmp) skrivTavling(cid, cmp);
      }
      smutsiga.clear();
      sparfel = null;
    } catch (err) {
      // Bara logga räcker inte: tjänsten fortsätter svara att allt är bra
      // medan hela tävlingen ligger i minnet och försvinner vid omstart.
      // Felet exponeras via status() så att /api/health kan visa det.
      // Det som inte hann skrivas är kvar i mängden och försöks igen.
      sparfel = err.message;
      console.error('Kunde inte spara data:', err.message);
    }
  }

  function scheduleSave() {
    if (!katalog || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow();
    }, saveDelayMs);
    // Timern ska inte hålla processen vid liv – men då försvinner också det
    // som väntar på att skrivas när processen avslutas. Därför måste flush()
    // köras vid avslut (KRAV-8).
    saveTimer.unref?.();
  }

  /** Skriver det som väntar på att sparas, nu. Gör inget om inget väntar. */
  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    saveNow();
  }

  /** Märker en tävling som ändrad, så att bara den skrivs om vid nästa sparning. */
  function markera(cid) {
    smutsiga.add(String(cid));
    borttagna.delete(String(cid));
  }

  function getCompetition(cid) {
    const befintlig = hamta(cid);
    if (befintlig) return befintlig;
    const ny = {
      info: { name: '', date: '', organizer: '', homepage: '', zerotime: '' },
      controls: {},
      classes: {},
      orgs: {},
      competitors: {},
      teams: {},
      updated: null,
    };
    markera(cid);
    indexera(cid, ny);
    return cacha(cid, ny);
  }

  function clearCompetition(cid) {
    competitionsCache.delete(String(cid));
    uppgifter.delete(String(cid));
    lopare.delete(String(cid));
    return getCompetition(cid);
  }

  // Par av tävlingar vi redan varnat om, så att varje sändning inte upprepar det.
  const varnadeDubbletter = new Set();

  /**
   * Varnar när två tävlingar har samma namn och datum och delar bricknummer.
   *
   * Sätts MeOS och uppladdningsprogrammet till olika tävlings-id hamnar de två
   * inflödena i var sin tävling. Allt svarar OK, men löparens placering räknas
   * på bara den delmängd av fältet som hamnat där – och det syns ingenstans.
   * Kontrollen ligger här i stället för i en av inläsarna, eftersom felet ser
   * likadant ut oavsett vilket inflöde som kom först.
   */
  function varnaOmDubblettTavling(cid) {
    const min = uppgifterFor(cid);
    if (!min?.name || !min.date) return;
    const kort = new Set(loparrader(cid).map((l) => l.card).filter((c) => c > 0));
    if (!kort.size) return;

    // Går helt på registret: att läsa in varje annan tävling för att jämföra
    // skulle dra in hela databasen i minnet vid varje sändning.
    for (const annanCid of [...uppgifter.keys()]) {
      if (String(annanCid) === String(cid)) continue;
      const annanU = uppgifterFor(annanCid);
      if (annanU.name !== min.name || annanU.date !== min.date) continue;

      const par = [cid, annanCid].map(Number).sort((a, b) => a - b).join(':');
      if (varnadeDubbletter.has(par)) return;

      const delade = loparrader(annanCid).filter((l) => kort.has(l.card)).length;
      if (!delade) continue;
      varnadeDubbletter.add(par);
      console.warn(
        `Tävling ${cid} och ${annanCid} har samma namn ("${min.name}") och datum ` +
          `och delar ${delade} bricknummer. Troligen använder MeOS och ` +
          'uppladdningsprogrammet olika tävlings-id – då räknas placeringen på ' +
          'fel underlag och kvittot blir ofullständigt.'
      );
      return;
    }
  }

  function touch(cid) {
    const cmp = getCompetition(cid);
    cmp.updated = new Date().toISOString();
    markera(cid);
    // Registret är det som svarar på sökning och brickuppslag; följer det inte
    // med en ändring hittas inte en löpare som just kommit in.
    indexera(cid, cmp);
    varnaOmDubblettTavling(cid);
    scheduleSave();
  }

  function listCompetitions() {
    return [...uppgifter.keys()]
      .map((id) => [id, uppgifterFor(id)])
      .map(([id, u]) => ({
        id: Number(id),
        name: u.name,
        date: u.date,
        organizer: u.organizer,
        homepage: u.homepage,
        updated: u.updated,
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
  }

  /**
   * Åldern på en tävling i millisekunder, räknat från senast mottagna data.
   * Saknas `updated` (t.ex. data från en äldre version) används tävlingsdagens
   * slut som reserv. Går åldern inte att avgöra returneras null – då gallras
   * tävlingen inte, hellre kvar än felaktigt raderad.
   */
  function ageMs(u) {
    const stamp = u.updated || (u.date ? `${u.date}T23:59:59Z` : null);
    if (!stamp) return null;
    const t = Date.parse(stamp);
    return Number.isFinite(t) ? now() - t : null;
  }

  /**
   * Gallrar undanlagda datafiler (KRAV-8) enligt samma regel som tävlingsdata.
   * De innehåller hela deltagarfältet, så utan detta blir en kopia av
   * personuppgifterna kvar för alltid. Tidsstämpeln står i filnamnet; går den
   * inte att läsa lämnas filen i fred – hellre kvar än felaktigt raderad.
   */
  function purgeUndanlagdaFiler(maxAge) {
    if (!dataDir) return;
    // Undanlagda filer finns på två ställen: enskilda tävlingar i tavlingar/,
    // och en hel databas från tiden före uppdelningen direkt i dataDir. Båda
    // innehåller deltagarfält och ska gallras enligt samma regel.
    for (const mapp of [dataDir, katalog]) {
      let filer;
      try {
        filer = fs.readdirSync(mapp);
      } catch {
        continue; // katalogen kan saknas, t.ex. innan första sparningen
      }
      for (const namn of filer) {
        const m = /\.(?:trasig|uppdelad)-(\d+)$/.exec(namn);
        if (!m) continue;
        const stämplad = Number(m[1]);
        if (!Number.isFinite(stämplad) || now() - stämplad <= maxAge) continue;
        try {
          fs.unlinkSync(path.join(mapp, namn));
          console.log(`Gallrade undanlagd datafil äldre än ${retentionDays} dagar: ${namn}`);
        } catch (err) {
          console.error(`Kunde inte gallra ${namn}: ${err.message}`);
        }
      }
    }
  }

  /** Gallrar tävlingar äldre än retentionDays (KRAV-14). Returnerar deras id:n. */
  function purgeExpired() {
    if (!(retentionDays > 0)) return [];
    const maxAge = retentionDays * DAY_MS;
    purgeUndanlagdaFiler(maxAge);
    const removed = [];
    for (const id of [...uppgifter.keys()]) {
      const u = uppgifterFor(id);
      let age = ageMs(u);
      if (age === null) {
        // Går tävlingen inte att åldersbestämma – en fil från ett äldre format,
        // eller en trasig tidsstämpel – skulle den annars aldrig gallras, och
        // hela deltagarfältet ligga kvar för alltid. Starta klockan i stället
        // för att gissa: den blir gammal om retentionDays dagar, inte nu.
        // Måste läsas in för att tidsstämpeln ska nå filen också. Sällsynt:
        // live-data har alltid `updated`.
        const cmp = getCompetition(id);
        cmp.updated = new Date(now()).toISOString();
        indexera(id, cmp);
        markera(id);
        scheduleSave();
        age = 0;
      }
      if (age > maxAge) {
        competitionsCache.delete(String(id));
        uppgifter.delete(String(id));
        lopare.delete(String(id));
        smutsiga.delete(String(id));
        borttagna.add(String(id));
        removed.push(Number(id));
      }
    }
    if (removed.length) {
      console.log(`Gallrade tävlingsdata äldre än ${retentionDays} dagar: ${removed.join(', ')}`);
      scheduleSave();
      onGallrad(removed);
    }
    return removed;
  }

  // Gallra vid start och därefter en gång per dygn. Timern hindrar inte
  // processen från att avslutas (t.ex. i tester).
  purgeExpired();
  let purgeTimer = null;
  if (retentionDays > 0 && purgeIntervalMs > 0) {
    purgeTimer = setInterval(purgeExpired, purgeIntervalMs);
    purgeTimer.unref?.();
  }

  /**
   * Tävlingar där någon löpare matchar, nyast först – ur registret, utan att
   * läsa in någon fil. En miss, som är vad löparen får när hon stavar fel,
   * kostar därför ingen inläsning alls.
   */
  /**
   * Löparraderna för en tävling – ur den inlästa tävlingen om den finns.
   *
   * Att bygga om listan för en inläst tävling kostar något: med fyra tävlingar
   * inlästa (4 300 löpare) gick en sökning från 1,95 till 2,10 ms. Det är
   * betalt för att slippa en hel felklass – att registret och den inlästa
   * tävlingen säger olika saker – och därför inte optimerat.
   */
  function loparrader(cid) {
    const cmp = competitionsCache.get(String(cid));
    if (!cmp) return lopare.get(String(cid)) || [];
    return Object.entries(cmp.competitors || {}).map(([id, c]) => ({
      id: Number(id),
      card: c.card || 0,
      name: c.name || '',
    }));
  }

  function tavlingarMedTraff(fraga) {
    const q = String(fraga || '').trim();
    if (!q) return [];
    const somBricka = /^\d+$/.test(q) ? Number(q) : null;
    const qLower = q.toLowerCase();
    const traffar = [];
    for (const { id } of listCompetitions()) {
      const nagon = loparrader(id).some((l) =>
        somBricka !== null ? l.card === somBricka : l.name.toLowerCase().includes(qLower)
      );
      if (nagon) traffar.push(id);
    }
    return traffar;
  }

  /** Tävlingar där bricknumret förekommer, nyast först. */
  function tavlingarMedBricka(card) {
    if (!(card > 0)) return [];
    return listCompetitions()
      .map((c) => c.id)
      .filter((id) => loparrader(id).some((l) => l.card === card));
  }

  function close() {
    if (purgeTimer) clearInterval(purgeTimer);
    purgeTimer = null;
    flush();
  }

  /** Driftstatus för /api/health – säger om data faktiskt når disken. */
  function status() {
    return { persistens: Boolean(katalog), sparfel };
  }

  return {
    /** Tävlingar som är inlästa just nu – cachen, inte allt som finns. */
    get competitions() {
      return Object.fromEntries(competitionsCache);
    },
    hamta,
    finns: (cid) => uppgifter.has(String(cid)),
    tavlingarMedTraff,
    tavlingarMedBricka,
    status,
    getCompetition,
    clearCompetition,
    touch,
    listCompetitions,
    purgeExpired,
    flush,
    close,
  };
}
