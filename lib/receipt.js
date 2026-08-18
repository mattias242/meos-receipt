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
 * MeOS lägger extra stämplingar sist i resultatfilen, efter de banordnade.
 * Sortera in dem på sin kronologiska plats så sträcktiderna blir rätt –
 * annars räknas nästa sträcka (t.ex. målsträckan) från extrastämplingen.
 */
function orderPunches(punches) {
  const extra = punches.filter((p) => p.status === 'additional' && p.rt > 0);
  if (!extra.length) return punches;

  const rows = punches.filter((p) => !extra.includes(p));
  for (const e of [...extra].sort((a, b) => a.rt - b.rt)) {
    let i = rows.length;
    while (i > 0 && !(rows[i - 1].rt > 0 && rows[i - 1].rt <= e.rt)) i--;
    rows.splice(i, 0, e);
  }
  return rows;
}

/**
 * Kontroller vars tid motsäger banordningen (KRAV-10).
 *
 * En kontrollenhet med fel klocka ger inte alltid en tid utanför loppet – går
 * den bara några minuter fel hamnar tiden mitt i loppet och ser rimlig ut. Det
 * som avslöjar den är banordningen: en kontroll längre fram i banan kan inte
 * ha stämplats tidigare än en som ligger före.
 *
 * Vilken sida som har rätt klocka går inte att avgöra ur filen, så båda parter
 * i en motsägelse tappar sina tider. Att i stället lita på majoriteten hade på
 * Sommarträning 13/8 behållit just de felaktiga tiderna: på Orange-banan var de
 * felställda enheterna i majoritet.
 *
 * Extra stämplingar deltar inte – de hör inte till banan och sorteras redan in
 * efter tid, så de kan inte motsäga någon ordning.
 */
export function inconsistentPunches(punches) {
  const bana = punches.filter((p) => p.status !== 'additional');
  const trasiga = new Set();
  for (let i = 0; i < bana.length; i++) {
    for (let j = i + 1; j < bana.length; j++) {
      if (bana[i].rt >= bana[j].rt) {
        trasiga.add(bana[i]);
        trasiga.add(bana[j]);
      }
    }
  }
  return trasiga;
}

/**
 * Kontrollkoden – siffran som står på skärmen i skogen (KRAV-19).
 *
 * Besöker banan samma kontroll flera gånger ger MeOS varje besök ett eget
 * internt id: kod + 100000 per extra besök (52 -> 100052 -> 200052). Det
 * numret finns ingenstans utanför MeOS, så det får aldrig hamna på kvittot.
 * Avläst ur skarp data: samtliga 76 odöpta kontroller i RADIOTEST 2026-08-18
 * hade namnet `id % 100000`, med besöksnummer som suffix ("52-1", "52-2").
 */
function controlCode(id) {
  return id % 100000;
}

/**
 * Kontrollens beteckning på kvittot (KRAV-19): koden först, namnet som
 * suffix inom parentes – "50 (Radio 1-1)".
 *
 * Koden är det löparen har på banbeskrivningen och det enda som går att
 * jämföra mot skärmen. Namnet sätts bara på de kontroller arrangören döpt;
 * MeOS fyller resten med kontrollens egen kod som namn, och den ska inte
 * upprepas i parentesen.
 */
function controlLabel(cmp, id) {
  const kod = controlCode(id);
  const namn = cmp.controls[id]?.name || '';
  // Tre sorters namn som inte är namn:
  //   "52"          – MeOS platshållare för en odöpt kontroll
  //   "52-2"        – samma, med besöksnummer i en bana som passerar två gånger
  //   "Kontroll 52" – vår egen platshållare, före KRAV-19, kvar i sparad data
  // Utan det här blir de "52 (52)", "100052 (52-2)" och "52 (Kontroll 52)".
  const platshållare =
    !namn || namn === `Kontroll ${id}` || new RegExp(`^${kod}(-\\d+)?$`).test(namn);
  if (platshållare) return String(kod);
  // Besöksnumret i "Radio 1-1"/"Radio 1-2" hör inte hemma på kvittot. Det går
  // bara att lita på i MOP-flödet, som har ett eget id per besök;
  // resultatfilen bär bara kontrollkoden, så andra passagen slås upp på
  // samma kontroll och skulle påstå att den är den första. Vilken passage
  // det är framgår av ordningen i tabellen.
  return `${kod} (${namn.replace(/-\d+$/, '')})`;
}

/**
 * Kompletta stämplingar från en resultatfil (KRAV-10): banordning behålls,
 * saknade kontroller visas utan tider och extra stämplingar markeras.
 *
 * Har löparen brutit utan att stämpla någon kontroll exporterar MeOS hela
 * banan som Missing. En tabell med enbart streck säger löparen ingenting, så
 * den utelämnas – har någon kontroll en tid visas tabellen som vanligt.
 */
function buildPunchSplits(cmp, competitor) {
  // En gammal stämpling kvar i brickan, eller en kontrollenhet med fel klocka,
  // ger en sträcktid långt utanför loppet. Den är ingen användbar tid: visas
  // utan tider, och nästa sträcka räknas från föregående giltiga stämpling –
  // annars blir både den raden och nästa obrukbara.
  const maxRt = competitor.rt > 0 ? competitor.rt : Infinity;
  const rimlig = (p) => p.rt > 0 && p.status !== 'missing' && p.rt <= maxRt;

  // Bara tider som klarat rimlighetsprövningen jämförs mot banordningen. En
  // stämpling som redan fällts där skulle annars dra med sig sina grannar:
  // 84 och 85 låg efter mål på Sommarträningen och hade tagit målstämplingen
  // med sig i fallet.
  const motsägande = inconsistentPunches(competitor.punches.filter(rimlig));
  const usable = (p) => rimlig(p) && !motsägande.has(p);

  if (!competitor.punches.some(usable) && !(competitor.rt > 0)) return [];

  const rows = [];
  let prevRt = 0;
  for (const p of orderPunches(competitor.punches)) {
    const hasTime = usable(p);
    rows.push({
      control: controlCode(p.code),
      name: controlLabel(cmp, p.code),
      status: p.status,
      // Skiljer en kontroll löparen faktiskt stämplade, men vars tid inte går
      // att lita på, från en hon aldrig stämplade – båda visas utan tider.
      // Extra stämplingar undantas: de förklaras av TÖM-tipset i stället, för
      // deras tid kommer från en tidigare aktivitet och inte från en fel
      // ställd klocka.
      unreliable: !hasTime && p.rt > 0 && p.status === 'ok',
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
      unreliable: false,
      clock: fmtClock(competitor.st + competitor.rt),
      elapsed: fmtElapsed(competitor.rt),
      leg: fmtElapsed(competitor.rt - prevRt),
    });
  }
  return rows;
}

/**
 * Förklaringarna under sträcktabellen (KRAV-10).
 *
 * Utan dem läser löparen en streckrad som att hon missat kontrollen, och en
 * extra stämpling som att hon sprungit fel. Båda är fel slutsats: tiden går
 * inte att lita på i det ena fallet, och i det andra kommer stämplingen inte
 * ens från det här loppet.
 */
function buildNotes(splits) {
  const notes = {};
  if (splits.some((s) => s.unreliable)) {
    notes.unreliableTimes =
      'Stämplingen är registrerad, men tiden är orimlig – kontrollenhetens ' +
      'klocka har troligen visat fel. Ditt resultat påverkas inte.';
  }
  if (splits.some((s) => s.status === 'additional')) {
    notes.extraPunches =
      'Extra stämplingar kommer från en tidigare aktivitet – stämpla TÖM ' +
      'före start så töms pinnen.';
  }
  return notes;
}

function buildSplits(cmp, competitor) {
  if (competitor.punches?.length) return buildPunchSplits(cmp, competitor);
  const radios = [...(competitor.radios || [])].sort((a, b) => a.rt - b.rt);
  const splits = [];
  let prevRt = 0;
  for (const r of radios) {
    splits.push({
      control: controlCode(r.ctrl),
      name: controlLabel(cmp, r.ctrl),
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

export function buildReceipt(cmp, cmpId, competitorId, { now = () => Date.now() } = {}) {
  const c = cmp.competitors[competitorId];
  if (!c) return null;

  const splits = buildSplits(cmp, c);

  const cls = cmp.classes[c.cls];
  const org = cmp.orgs[c.org];
  const { place, finished, total, winnerRt } = placement(cmp, c);
  // Ej start (20), återbud (21) och deltar ej (99) kan ha en tilldelad starttid
  // i MeOS trots att löparen aldrig kom till start. Kvittot ska visa vad som
  // hände, så den tiden döljs (KRAV-4). Utgått räknas som startad.
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
      // Bricknumret slår upp kvittot men lämnar aldrig tjänsten (KRAV-5):
      // det ingår inte i en vanlig resultatlista, följer samma person år
      // efter år, och är den nyckel som annars knyter ihop en löpare mellan
      // tävlingar. Namn och klubb räcker för att känna igen sitt eget kvitto.
      bib: c.bib || '',
      team: teamOf(cmp, competitorId)?.name || '',
    },
    result: {
      status: c.stat,
      statusText,
      preliminary: !!c.prel,
      startTime: started ? fmtClock(c.st) : '',
      finishTime: hasResult ? fmtClock(c.st + c.rt) : '',
      time: hasResult ? fmtElapsed(c.rt) : '',
      place: c.prel ? null : place,
      prelPlace: c.prel ? place : null,
      finished,
      total,
      after: place && place > 1 && winnerRt > 0 ? '+' + fmtElapsed(c.rt - winnerRt) : '',
      // Stafett: den egna sträcktiden säger inte hur laget ligger till. MOP
      // skickar tiden från tidigare sträckor i `input`, och specen definierar
      // lagets totaltid som löptiden plus den – men bara när totalstatusen är
      // OK, alltså när ingen tidigare sträcka har anmärkning (KRAV-3).
      teamTime:
        hasResult && c.input?.tstat === 1 && c.input.it > 0
          ? fmtElapsed(c.rt + c.input.it)
          : '',
    },
    splits,
    notes: buildNotes(splits),
    updated: cmp.updated,
    // Slutar MeOS skicka fryser kvittot i det läge det var. Åldern räknas här
    // och inte i mobilen, eftersom en felställd mobilklocka annars skulle ge
    // fel svar – och kvittosidan behöver veta när den ska säga ifrån (KRAV-4).
    updatedAgeSeconds: cmp.updated
      ? Math.max(0, Math.round((now() - Date.parse(cmp.updated)) / 1000))
      : null,
  };
}

/**
 * Find competitors by card number or name (substring, case-insensitive).
 *
 * Sökningen görs om för varje inläst tävling tills någon ger träff (KRAV-6),
 * så en miss – det löparen får när hen stavar fel – går igenom hela databasen.
 * Därför byggs träfflistans poster först efter filtret: att bygga dem för alla
 * och sedan kasta de flesta kostade 15 ms per miss med 90 dagars data mot 3 ms
 * nu, med samma svar.
 */
export function searchCompetitors(cmp, cmpId, query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const asCard = /^\d+$/.test(q) ? parseInt(q, 10) : null;
  const qLower = q.toLowerCase();
  const hits = [];
  for (const [id, c] of Object.entries(cmp.competitors)) {
    const matchar =
      asCard !== null ? c.card === asCard : c.name.toLowerCase().includes(qLower);
    if (!matchar) continue;
    hits.push({
      id: Number(id),
      cmp: cmpId,
      name: c.name,
      club: cmp.orgs[c.org]?.name || '',
      class: cmp.classes[c.cls]?.name || '',
      statusText: STATUS_TEXT[c.stat] ?? '',
    });
  }
  return hits.sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}
