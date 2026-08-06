import { XMLParser } from 'fast-xml-parser';

/**
 * Parser för IOF XML 3.0 ResultList med sträcktider – formatet som MeOS
 * resultatautomat exporterar till fil. Kompletterar MOP-datat med det som
 * onlineprotokollet saknar: samtliga stämplingar i banordning, inklusive
 * saknade (Missing) och extra (Additional) stämplingar.
 *
 * Tider konverteras till MOP:s konvention: tiondels sekunder, och starttid
 * som tiondelar efter midnatt.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'text',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['ClassResult', 'PersonResult', 'TeamResult', 'SplitTime'].includes(name),
});

const int = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

// IOF-status -> MeOS/MOP-statuskod (lib/receipt.js STATUS_TEXT)
export const IOF_STATUS_TO_STAT = {
  OK: 1,
  Finished: 1,
  MissingPunch: 3,
  DidNotFinish: 4,
  Disqualified: 5,
  OverTime: 6,
  NotCompeting: 15,
  DidNotStart: 20,
  Cancelled: 21,
  DidNotEnter: 21,
  Active: 0,
  Inactive: 0,
};

/** "2026-08-06T10:20:00+02:00" -> tiondelar efter midnatt (lokal klocktid) */
function isoToTenths(iso) {
  const m = /T(\d\d):(\d\d):(\d\d)/.exec(String(iso || ''));
  if (!m) return 0;
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 10;
}

function personName(person) {
  const name = person?.Name || {};
  return [name.Given, name.Family].filter(Boolean).join(' ');
}

function parseSplit(s) {
  const status = String(s.status || 'OK').toLowerCase();
  return {
    code: int(s.ControlCode),
    rt: int(s.Time) * 10,
    status: status === 'missing' ? 'missing' : status === 'additional' ? 'additional' : 'ok',
  };
}

/**
 * Parsar en IOF XML 3.0 ResultList.
 * Returnerar { event: {name, date}, results: [...] } där varje resultat har
 * card, name, club, className, status, st, rt, position och splits
 * [{code, rt, status}] i filens ordning.
 */
export function parseIofResultList(xml) {
  const doc = parser.parse(xml);
  const root = doc.ResultList;
  if (!root) throw new Error('Inte en IOF ResultList');

  const event = {
    name: root.Event?.Name || '',
    date: root.Event?.StartTime?.Date || '',
  };

  const results = [];
  for (const cr of root.ClassResult || []) {
    const className = cr.Class?.Name || '';
    for (const pr of cr.PersonResult || []) {
      const result = Array.isArray(pr.Result) ? pr.Result[0] : pr.Result;
      if (!result) continue;
      const card = int(Array.isArray(result.ControlCard) ? result.ControlCard[0] : result.ControlCard);
      results.push({
        card,
        name: personName(pr.Person),
        club: pr.Organisation?.Name || '',
        className,
        status: result.Status || '',
        st: isoToTenths(result.StartTime),
        rt: int(result.Time) * 10,
        position: int(result.Position, 0),
        splits: (result.SplitTime || []).map(parseSplit),
      });
    }
  }
  return { event, results };
}

function findByName(obj, name) {
  for (const [id, v] of Object.entries(obj)) {
    if (v.name === name) return Number(id);
  }
  return null;
}

function nextId(obj) {
  const ids = Object.keys(obj).map(Number);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

/**
 * Slår samman en IOF ResultList med tävlingens MOP-data.
 * Löpare matchas via bricknummer; MOP-datat äger namn/status/tider när det
 * redan har dem – IOF fyller bara i det som saknas, plus stämplingslistan.
 */
export function applyIof(store, cid, xml) {
  const { event, results } = parseIofResultList(xml);
  const cmp = store.getCompetition(cid);

  if (!cmp.info.name && event.name) cmp.info.name = event.name;
  if (!cmp.info.date && event.date) cmp.info.date = event.date;

  for (const r of results) {
    if (!(r.card > 0)) continue;

    let id = null;
    for (const [cmpId, c] of Object.entries(cmp.competitors)) {
      if (c.card === r.card) { id = Number(cmpId); break; }
    }

    if (id === null) {
      // Löparen finns bara i resultatfilen – skapa den (KRAV-9).
      let cls = findByName(cmp.classes, r.className);
      if (cls === null && r.className) {
        cls = nextId(cmp.classes);
        cmp.classes[cls] = { name: r.className, ord: cls, radio: '', crs: '' };
      }
      let org = findByName(cmp.orgs, r.club);
      if (org === null && r.club) {
        org = nextId(cmp.orgs);
        cmp.orgs[org] = { name: r.club, nat: '' };
      }
      id = nextId(cmp.competitors);
      cmp.competitors[id] = {
        name: r.name, card: r.card, cls: cls ?? 0, org: org ?? 0,
        stat: 0, st: 0, rt: 0, prel: false, competing: null,
        bib: '', nat: '', radios: [], input: null,
      };
    }

    const c = cmp.competitors[id];
    c.punches = r.splits;
    const stat = IOF_STATUS_TO_STAT[r.status];
    if (c.stat === 0 && stat !== undefined && stat !== 0) c.stat = stat;
    if (!(c.st > 0) && r.st > 0) c.st = r.st;
    if (!(c.rt > 0) && r.rt > 0) c.rt = r.rt;
  }

  store.touch(cid);
}
