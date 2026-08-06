/**
 * Builds the digital receipt ("sträcktidskvitto") for a competitor,
 * mirroring the paper slip normally printed at card readout.
 * All raw times are in tenths of a second (MOP convention);
 * st is tenths after 00:00:00 on the competition day.
 */

export const STATUS_TEXT = {
  0: 'Ej i mål',
  1: 'Godkänd',
  2: 'Utan tidtagning',
  3: 'Felstämplad',
  4: 'Utgått',
  5: 'Diskvalificerad',
  6: 'Över maxtid',
  15: 'Utom tävlan',
  20: 'Ej start',
  21: 'Återbud',
  99: 'Deltar ej',
};

/** Tenths since midnight -> clock time "HH:MM:SS" */
export function fmtClock(tenths) {
  if (!(tenths > 0)) return '';
  const s = Math.floor(tenths / 10) % 86400;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Tenths -> elapsed time "M:SS" / "H:MM:SS" */
export function fmtElapsed(tenths) {
  if (!(tenths > 0)) return '';
  const s = Math.floor(tenths / 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function classResults(cmp, clsId) {
  return Object.entries(cmp.competitors)
    .map(([id, c]) => ({ id: Number(id), ...c }))
    .filter((c) => c.cls === clsId);
}

/**
 * Placement among approved (stat=1, non-preliminary counts too – like the
 * printed receipt, preliminary results get a preliminary placement).
 */
function placement(cmp, competitor) {
  const inClass = classResults(cmp, competitor.cls);
  const finished = inClass.filter((c) => c.stat === 1 && c.rt > 0);
  const total = inClass.filter((c) => c.stat !== 20 && c.stat !== 21 && c.stat !== 99).length;
  const winnerRt = finished.length
    ? Math.min(...finished.map((c) => c.rt))
    : 0;
  if (competitor.stat !== 1 || !(competitor.rt > 0)) {
    return { place: null, finished: finished.length, total, winnerRt };
  }
  const place = finished.filter((c) => c.rt < competitor.rt).length + 1;
  return { place, finished: finished.length, total, winnerRt };
}

/**
 * Kompletta stämplingar från en resultatfil (KRAV-10): banordning behålls,
 * saknade kontroller visas utan tider och extra stämplingar markeras.
 */
function buildPunchSplits(cmp, competitor) {
  const rows = [];
  let prevRt = 0;
  for (const p of competitor.punches) {
    const hasTime = p.rt > 0 && p.status !== 'missing';
    rows.push({
      control: p.code,
      name: cmp.controls[p.code]?.name || String(p.code),
      status: p.status,
      clock: hasTime ? fmtClock(competitor.st + p.rt) : '',
      elapsed: hasTime ? fmtElapsed(p.rt) : '',
      leg: hasTime ? fmtElapsed(p.rt - prevRt) : '',
    });
    if (hasTime) prevRt = p.rt;
  }
  if (competitor.rt > 0) {
    rows.push({
      control: null,
      name: 'Mål',
      status: 'ok',
      clock: fmtClock(competitor.st + competitor.rt),
      elapsed: fmtElapsed(competitor.rt),
      leg: fmtElapsed(competitor.rt - prevRt),
    });
  }
  return rows;
}

function buildSplits(cmp, competitor) {
  if (competitor.punches?.length) return buildPunchSplits(cmp, competitor);
  const radios = [...(competitor.radios || [])].sort((a, b) => a.rt - b.rt);
  const splits = [];
  let prevRt = 0;
  for (const r of radios) {
    splits.push({
      control: r.ctrl,
      name: cmp.controls[r.ctrl]?.name || `Kontroll ${r.ctrl}`,
      clock: fmtClock(competitor.st + r.rt),
      elapsed: fmtElapsed(r.rt),
      leg: fmtElapsed(r.rt - prevRt),
    });
    prevRt = r.rt;
  }
  if (competitor.rt > 0) {
    splits.push({
      control: null,
      name: 'Mål',
      clock: fmtClock(competitor.st + competitor.rt),
      elapsed: fmtElapsed(competitor.rt),
      leg: fmtElapsed(competitor.rt - prevRt),
    });
  }
  return splits;
}

function teamOf(cmp, competitorId) {
  for (const [tid, t] of Object.entries(cmp.teams)) {
    if ((t.members || []).some((leg) => leg.includes(competitorId))) {
      return { id: Number(tid), name: t.name };
    }
  }
  return null;
}

export function buildReceipt(cmp, cmpId, competitorId) {
  const c = cmp.competitors[competitorId];
  if (!c) return null;

  const cls = cmp.classes[c.cls];
  const org = cmp.orgs[c.org];
  const { place, finished, total, winnerRt } = placement(cmp, c);
  const started = c.st > 0 && c.stat !== 20 && c.stat !== 21 && c.stat !== 99;
  const hasResult = c.rt > 0 && c.stat > 0;

  let statusText = STATUS_TEXT[c.stat] ?? `Status ${c.stat}`;
  if (c.stat === 0) statusText = started ? 'Ute på banan' : 'Ej startat';

  return {
    competition: {
      id: cmpId,
      name: cmp.info.name,
      date: cmp.info.date,
      organizer: cmp.info.organizer,
    },
    runner: {
      id: competitorId,
      name: c.name,
      club: org?.name || '',
      class: cls?.name || '',
      card: c.card || null,
      bib: c.bib || '',
      team: teamOf(cmp, competitorId)?.name || '',
    },
    result: {
      status: c.stat,
      statusText,
      preliminary: !!c.prel,
      startTime: fmtClock(c.st),
      finishTime: hasResult ? fmtClock(c.st + c.rt) : '',
      time: hasResult ? fmtElapsed(c.rt) : '',
      place: c.prel ? null : place,
      prelPlace: c.prel ? place : null,
      finished,
      total,
      after: place && place > 1 && winnerRt > 0 ? '+' + fmtElapsed(c.rt - winnerRt) : '',
    },
    splits: buildSplits(cmp, c),
    updated: cmp.updated,
  };
}

/** Find competitors by card number or name (substring, case-insensitive). */
export function searchCompetitors(cmp, cmpId, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const asCard = /^\d+$/.test(q) ? parseInt(q, 10) : null;
  const qLower = q.toLowerCase();
  return Object.entries(cmp.competitors)
    .map(([id, c]) => ({ id: Number(id), ...c }))
    .filter((c) =>
      asCard !== null ? c.card === asCard : c.name.toLowerCase().includes(qLower)
    )
    .map((c) => ({
      id: c.id,
      cmp: cmpId,
      name: c.name,
      card: c.card || null,
      club: cmp.orgs[c.org]?.name || '',
      class: cmp.classes[c.cls]?.name || '',
      statusText: STATUS_TEXT[c.stat] ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}
