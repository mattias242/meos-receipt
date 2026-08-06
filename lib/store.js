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
  now = () => Date.now(),
} = {}) {
  const competitions = {};
  const file = dataDir ? path.join(dataDir, 'competitions.json') : null;
  let saveTimer = null;
  let sparfel = null; // senaste misslyckade sparningen, null när allt är bra

  if (file && fs.existsSync(file)) {
    try {
      Object.assign(competitions, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      // Filen kan innehålla hela tävlingens data. Skrivs den över vid nästa
      // sparning är innehållet borta för gott, så den läggs undan i stället –
      // då går det att rädda manuellt (KRAV-8).
      const undanlagd = `${file}.trasig-${now()}`;
      try {
        fs.renameSync(file, undanlagd);
        console.error(
          `Kunde inte läsa sparad data, startar tomt: ${err.message}\n` +
            `Den oläsbara filen har sparats undan som ${undanlagd}`
        );
      } catch (renameErr) {
        console.error(
          `Kunde inte läsa sparad data, startar tomt: ${err.message}\n` +
            `VARNING: filen kunde inte sparas undan (${renameErr.message}) och ` +
            'kan komma att skrivas över.'
        );
      }
    }
  }

  function scheduleSave() {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(competitions));
        fs.renameSync(tmp, file);
        sparfel = null;
      } catch (err) {
        // Bara logga räcker inte: tjänsten fortsätter svara att allt är bra
        // medan hela tävlingen ligger i minnet och försvinner vid omstart.
        // Felet exponeras via status() så att /api/health kan visa det.
        sparfel = err.message;
        console.error('Kunde inte spara data:', err.message);
      }
    }, saveDelayMs);
    saveTimer.unref?.();
  }

  function getCompetition(cid) {
    if (!competitions[cid]) {
      competitions[cid] = {
        info: { name: '', date: '', organizer: '', homepage: '', zerotime: '' },
        controls: {},
        classes: {},
        orgs: {},
        competitors: {},
        teams: {},
        updated: null,
      };
    }
    return competitions[cid];
  }

  function clearCompetition(cid) {
    delete competitions[cid];
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
    const cmp = competitions[cid];
    if (!cmp?.info.name || !cmp.info.date) return;
    const kort = new Set(
      Object.values(cmp.competitors).map((c) => c.card).filter((c) => c > 0)
    );
    if (!kort.size) return;

    for (const [annanCid, annan] of Object.entries(competitions)) {
      if (String(annanCid) === String(cid)) continue;
      if (annan.info.name !== cmp.info.name || annan.info.date !== cmp.info.date) continue;

      const par = [cid, annanCid].map(Number).sort((a, b) => a - b).join(':');
      if (varnadeDubbletter.has(par)) return;

      const delade = Object.values(annan.competitors).filter((c) => kort.has(c.card)).length;
      if (!delade) continue;
      varnadeDubbletter.add(par);
      console.warn(
        `Tävling ${cid} och ${annanCid} har samma namn ("${cmp.info.name}") och datum ` +
          `och delar ${delade} bricknummer. Troligen använder MeOS och ` +
          'uppladdningsprogrammet olika tävlings-id – då räknas placeringen på ' +
          'fel underlag och kvittot blir ofullständigt.'
      );
      return;
    }
  }

  function touch(cid) {
    getCompetition(cid).updated = new Date().toISOString();
    varnaOmDubblettTavling(cid);
    scheduleSave();
  }

  function listCompetitions() {
    return Object.entries(competitions)
      .map(([id, c]) => ({
        id: Number(id),
        name: c.info.name,
        date: c.info.date,
        organizer: c.info.organizer,
        homepage: c.info.homepage,
        updated: c.updated,
      }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id);
  }

  /**
   * Åldern på en tävling i millisekunder, räknat från senast mottagna data.
   * Saknas `updated` (t.ex. data från en äldre version) används tävlingsdagens
   * slut som reserv. Går åldern inte att avgöra returneras null – då gallras
   * tävlingen inte, hellre kvar än felaktigt raderad.
   */
  function ageMs(cmp) {
    const stamp = cmp.updated || (cmp.info?.date ? `${cmp.info.date}T23:59:59Z` : null);
    if (!stamp) return null;
    const t = Date.parse(stamp);
    return Number.isFinite(t) ? now() - t : null;
  }

  /** Gallrar tävlingar äldre än retentionDays (KRAV-14). Returnerar deras id:n. */
  function purgeExpired() {
    if (!(retentionDays > 0)) return [];
    const maxAge = retentionDays * DAY_MS;
    const removed = [];
    for (const [id, cmp] of Object.entries(competitions)) {
      const age = ageMs(cmp);
      if (age !== null && age > maxAge) {
        delete competitions[id];
        removed.push(Number(id));
      }
    }
    if (removed.length) {
      console.log(`Gallrade tävlingsdata äldre än ${retentionDays} dagar: ${removed.join(', ')}`);
      scheduleSave();
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

  function close() {
    if (purgeTimer) clearInterval(purgeTimer);
    purgeTimer = null;
  }

  /** Driftstatus för /api/health – säger om data faktiskt når disken. */
  function status() {
    return { persistens: Boolean(file), sparfel };
  }

  return {
    competitions,
    status,
    getCompetition,
    clearCompetition,
    touch,
    listCompetitions,
    purgeExpired,
    close,
  };
}
