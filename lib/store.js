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
 */
export function createStore({ dataDir = null } = {}) {
  const competitions = {};
  const file = dataDir ? path.join(dataDir, 'competitions.json') : null;
  let saveTimer = null;

  if (file && fs.existsSync(file)) {
    try {
      Object.assign(competitions, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      console.error('Kunde inte läsa sparad data, startar tomt:', err.message);
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
      } catch (err) {
        console.error('Kunde inte spara data:', err.message);
      }
    }, 2000);
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

  function touch(cid) {
    getCompetition(cid).updated = new Date().toISOString();
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

  return { competitions, getCompetition, clearCompetition, touch, listCompetitions };
}
