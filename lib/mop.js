import { XMLParser } from 'fast-xml-parser';

/**
 * Parser and applier for the MeOS Online Protocol (MOP) 2.0.
 * See mop.xsd – root elements MOPComplete (full state) and MOPDiff (update).
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'text',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['cmp', 'tm', 'cls', 'org', 'ctrl'].includes(name),
});

const int = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (v) => v === 'true' || v === '1';

// Text content of an element that may be a plain string or {text, ...attrs}
const text = (v) => (typeof v === 'object' && v !== null ? (v.text ?? '') : (v ?? ''));

/** "150,9000;162,15000" -> [{ctrl:150, rt:9000}, ...] (rt in tenths) */
export function parseRadioTimes(s) {
  if (!s) return [];
  return String(s)
    .split(';')
    .map((pair) => pair.split(','))
    .filter((p) => p.length >= 2)
    .map(([ctrl, rt]) => ({ ctrl: int(ctrl), rt: int(rt) }))
    .filter((p) => p.ctrl > 0);
}

/** "31;32,33;35" -> [[31],[32,33],[35]] (team member ids per leg) */
export function parseTeamMembers(s) {
  if (!s) return [];
  return String(s)
    .split(';')
    .map((leg) => leg.split(',').map((id) => int(id)).filter((id) => id > 0));
}

function applyBase(target, base) {
  if (!base) return;
  const name = text(base);
  if (name !== '') target.name = name;
  if (base.org !== undefined) target.org = int(base.org);
  if (base.cls !== undefined) target.cls = int(base.cls);
  if (base.stat !== undefined) target.stat = int(base.stat);
  if (base.st !== undefined) target.st = int(base.st);
  if (base.rt !== undefined) target.rt = int(base.rt);
  if (base.bib !== undefined) target.bib = base.bib;
  if (base.nat !== undefined) target.nat = base.nat;
  if (base.crs !== undefined) target.crs = base.crs;
  target.prel = base.prel !== undefined ? bool(base.prel) : false;
}

function processCompetitor(cmp, d) {
  const id = int(d.id);
  if (!id) return;
  if (bool(d.delete)) {
    delete cmp.competitors[id];
    return;
  }
  const c = cmp.competitors[id] || {
    name: '', card: 0, cls: 0, org: 0, stat: 0, st: 0, rt: 0,
    prel: false, competing: null, bib: '', nat: '', radios: [], input: null,
  };
  applyBase(c, d.base);
  if (d.card !== undefined) c.card = int(d.card);
  if (d.competing !== undefined) c.competing = bool(d.competing);
  if (d.radio !== undefined) c.radios = parseRadioTimes(text(d.radio));
  if (d.input !== undefined && d.input !== null) {
    c.input = { it: int(d.input.it), tstat: int(d.input.tstat) };
  }
  cmp.competitors[id] = c;
}

function processTeam(cmp, d) {
  const id = int(d.id);
  if (!id) return;
  if (bool(d.delete)) {
    delete cmp.teams[id];
    return;
  }
  const t = cmp.teams[id] || {
    name: '', cls: 0, org: 0, stat: 0, st: 0, rt: 0, prel: false, members: [],
  };
  applyBase(t, d.base);
  if (d.r !== undefined) t.members = parseTeamMembers(text(d.r));
  cmp.teams[id] = t;
}

function processClass(cmp, d) {
  const id = int(d.id);
  if (!id) return;
  const c = cmp.classes[id] || { name: '', ord: id, radio: '', crs: '' };
  const name = text(d);
  if (name !== '') c.name = name;
  if (d.ord !== undefined) c.ord = int(d.ord);
  if (d.radio !== undefined) c.radio = d.radio;
  if (d.crs !== undefined) c.crs = d.crs;
  cmp.classes[id] = c;
}

function processOrganization(cmp, d) {
  const id = int(d.id);
  if (!id) return;
  if (bool(d.delete)) {
    delete cmp.orgs[id];
    return;
  }
  const o = cmp.orgs[id] || { name: '', nat: '' };
  const name = text(d);
  if (name !== '') o.name = name;
  if (d.nat !== undefined) o.nat = d.nat;
  cmp.orgs[id] = o;
}

function processControl(cmp, d) {
  const id = int(d.id);
  if (!id) return;
  cmp.controls[id] = { name: text(d) || `Kontroll ${id}` };
}

function processCompetition(cmp, d) {
  const name = text(d);
  if (name !== '') cmp.info.name = name;
  if (d.date !== undefined) cmp.info.date = d.date;
  if (d.organizer !== undefined) cmp.info.organizer = d.organizer;
  if (d.homepage !== undefined) cmp.info.homepage = d.homepage;
  if (d.zerotime !== undefined) cmp.info.zerotime = d.zerotime;
}

/**
 * Apply a MOP XML document to the store.
 * Returns the root element name ('MOPComplete' | 'MOPDiff').
 * Throws on unknown/invalid documents.
 */
export function applyMop(store, cid, xml) {
  const doc = parser.parse(xml);
  let rootName, root;
  if (doc.MOPComplete !== undefined) {
    rootName = 'MOPComplete';
    root = doc.MOPComplete;
    store.clearCompetition(cid);
  } else if (doc.MOPDiff !== undefined) {
    rootName = 'MOPDiff';
    root = doc.MOPDiff;
  } else {
    throw new Error('Unknown data');
  }

  const cmp = store.getCompetition(cid);
  if (root.competition !== undefined) processCompetition(cmp, root.competition);
  for (const d of root.ctrl || []) processControl(cmp, d);
  for (const d of root.cls || []) processClass(cmp, d);
  for (const d of root.org || []) processOrganization(cmp, d);
  for (const d of root.cmp || []) processCompetitor(cmp, d);
  for (const d of root.tm || []) processTeam(cmp, d);

  store.touch(cid);
  return rootName;
}
