const form = document.getElementById('searchForm');
const queryInput = document.getElementById('query');
const cmpSelect = document.getElementById('cmpSelect');
const messageEl = document.getElementById('message');
const hitsEl = document.getElementById('hits');
const receiptEl = document.getElementById('receipt');
const cmpNamn = document.getElementById('cmpNamn');

/**
 * Tävlingen ur adressen /t/<id> (KRAV-18), när sidan öppnats via den adress
 * som tryckts i PM eller satts som QR-kod. Null på förstasidan.
 */
const bunden = (() => {
  const m = /^\/t\/(\d+)\/?$/.exec(location.pathname || '');
  return m ? m[1] : null;
})();

let refreshTimer = null;
// Sant medan ett mejlutskick är på väg. Kvittot får inte ritas om då: noderna
// byts ut och svaret skulle hamna på ett formulär som inte längre syns.
let mejlPågår = false;
let current = null; // {cmp, id} of the shown receipt
let mailEnabled = false; // sätts från /api/health (KRAV-16)

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

function showMessage(text) {
  messageEl.textContent = text;
  messageEl.hidden = !text;
}

function clearResults() {
  hitsEl.hidden = true;
  hitsEl.innerHTML = '';
  receiptEl.hidden = true;
  receiptEl.innerHTML = '';
  showMessage('');
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  current = null;
}

async function loadHealth() {
  const res = await anrop('/api/health');
  mailEnabled = Boolean(res.data.email);
}

async function loadCompetitions() {
  const res = await anrop('/api/competitions');
  const list = Array.isArray(res.data) ? res.data : [];

  // Öppnad via tävlingens egen adress: väljaren behövs inte, och löparen ska
  // se vilken tävling det gäller. Adressen trycks i förväg, så tävlingen kan
  // mycket väl saknas ännu – då är det inget fel, bara för tidigt.
  if (bunden) {
    cmpSelect.hidden = true;
    const min = list.find((c) => String(c.id) === bunden);
    if (min) {
      cmpNamn.textContent = `${min.name} · ${min.date}`;
      cmpNamn.hidden = false;
    } else if (!res.offline) {
      showMessage('Inga resultat har kommit in för den här tävlingen än. Prova igen när loppet har startat.');
    }
    return;
  }

  if (list.length > 1) {
    cmpSelect.innerHTML = list
      .map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.date)})</option>`)
      .join('');
    cmpSelect.hidden = false;
  } else {
    cmpSelect.hidden = true;
  }
  // Utan kontakt säger sökningen ifrån när löparen försöker – ingen anledning
  // att påstå att tävlingen saknas.
  if (list.length === 0 && !res.offline) {
    showMessage('Ingen tävling är inläst ännu. Kvittot blir tillgängligt när tävlingen skickar resultat.');
  }
}

/** Minuter utan ny data innan ett oavgjort kvitto flaggas som inaktuellt. */
const INAKTUELL_EFTER_MINUTER = 10;

/**
 * Slutar MeOS skicka fryser kvittot. En löpare som gått i mål och ser "Ute på
 * banan" tror då att stämplingen inte registrerats, fast felet ligger hos
 * tävlingsdatorn. Notisen visas bara när resultatet ännu inte är fastställt –
 * efter tävlingen slutar MeOS skicka helt normalt, och då vore den bara brus.
 */
function inaktuellNotis(r) {
  const alder = r.updatedAgeSeconds;
  const fastställt = r.result.status > 0 && !r.result.preliminary;
  if (fastställt || typeof alder !== 'number' || alder < INAKTUELL_EFTER_MINUTER * 60) return '';
  const minuter = Math.floor(alder / 60);
  return `<div class="stale">Tjänsten har inte fått ny data från tävlingen på ${minuter} minuter.
    Ditt resultat kan redan vara registrerat – fråga tävlingsledningen om det dröjer.</div>`;
}

function statusClass(r) {
  if (r.result.status === 1) return 'ok';
  if (r.result.status === 0 || r.result.preliminary) return 'pending';
  return 'bad';
}

function renderReceipt(r) {
  const res = r.result;
  const rows = r.splits
    .map((s) => {
      const badge =
        s.status === 'missing'
          ? ' <span class="badge miss">saknas</span>'
          : s.status === 'additional'
            ? ' <span class="badge extra">extra</span>'
            : '';
      return `<tr class="splitsBody${s.status === 'missing' ? ' missRow' : ''}">
        <th scope="row">${esc(s.name)}${badge}</th>
        <td class="num">${esc(s.leg) || '–'}</td>
        <td class="num">${esc(s.elapsed) || '–'}</td>
        <td class="num">${esc(s.clock) || '–'}</td>
      </tr>`;
    })
    .join('');

  const place = res.place
    ? `<div class="place">Placering: <strong>${res.place}</strong> av ${res.finished} i mål</div>`
    : res.prelPlace
      ? `<div class="place">Prel. placering: <strong>${res.prelPlace}</strong> av ${res.finished} i mål</div>`
      : '';

  // Kvittot ritas om var 15:e sekund. Att skriva en e-postadress på en mobil
  // tar lätt längre än så, och adressen ligger i en nod som byts ut. Detsamma
  // gäller beskedet efter ett utskick: utan detta försvann "Kvittot är
  // skickat" vid nästa uppdatering, medan löparen fortfarande tittade på det.
  const påbörjadAdress = document.getElementById('mailTo')?.value || '';
  const tidigareMejlbesked = document.getElementById('mailStatus')?.textContent || '';

  receiptEl.innerHTML = `
    <div class="cmpName">${esc(r.competition.name)}</div>
    <div class="cmpMeta">${esc(r.competition.date)}${r.competition.organizer ? ' · ' + esc(r.competition.organizer) : ''}</div>
    <hr />
    <div class="runnerName">${esc(r.runner.name)}</div>
    <div class="runnerMeta">
      ${esc(r.runner.club)}${r.runner.team ? ' · ' + esc(r.runner.team) : ''}<br />
      Klass: ${esc(r.runner.class)}${r.runner.bib ? ' · Nr ' + esc(r.runner.bib) : ''}
    </div>
    <hr />
    ${res.time ? `<div class="bigTime">${esc(res.time)}</div>` : ''}
    <div class="status ${statusClass(r)}">${esc(res.statusText)}</div>
    ${res.preliminary ? '<div class="prel">Preliminärt resultat – ej fastställt</div>' : ''}
    ${place}
    ${res.after ? `<div class="place">Efter segraren: ${esc(res.after)}</div>` : ''}
    ${res.teamTime ? `<div class="place">Lagets tid: <strong>${esc(res.teamTime)}</strong></div>` : ''}
    <hr />
    <table>
      <tr><th scope="row">Starttid</th><td class="num">${esc(res.startTime) || '–'}</td></tr>
      ${res.finishTime ? `<tr><th scope="row">Måltid</th><td class="num">${esc(res.finishTime)}</td></tr>` : ''}
    </table>
    ${
      r.splits.length
        ? `<hr />
      <table>
        <tr class="splitsHead"><th scope="col">Kontroll</th><th scope="col" class="num">Sträcka</th><th scope="col" class="num">Total</th><th scope="col" class="num">Klocka</th></tr>
        ${rows}
      </table>`
        : res.startTime
          ? '<hr /><div class="noPunches">Inga stämplingar registrerade</div>'
          : ''
    }
    ${inaktuellNotis(r)}
    <div class="updated">Uppdaterat ${r.updated ? new Date(r.updated).toLocaleTimeString('sv-SE') : '–'}</div>
    <div class="shareRow">
      <button type="button" id="shareBtn">Dela kvittot</button>
      <a class="btn" id="pdfBtn" href="/api/receipt.pdf?cmp=${encodeURIComponent(r.competition.id)}&id=${encodeURIComponent(r.runner.id)}">Ladda ner PDF</a>
    </div>
    <form class="mailRow" id="mailForm" hidden>
      <label for="mailTo">Få kvittot mejlat som PDF</label>
      <div class="mailInputs">
        <input type="email" id="mailTo" placeholder="din@epost.se" required />
        <button type="submit">Skicka</button>
      </div>
      <div class="mailStatus" id="mailStatus" hidden></div>
    </form>
  `;
  receiptEl.hidden = false;

  // Mejlformuläret visas bara om servern har e-post konfigurerat (KRAV-16).
  const mailForm = document.getElementById('mailForm');
  const mailStatus = document.getElementById('mailStatus');
  if (mailEnabled) mailForm.hidden = false;
  if (påbörjadAdress) document.getElementById('mailTo').value = påbörjadAdress;
  if (tidigareMejlbesked) {
    mailStatus.textContent = tidigareMejlbesked;
    mailStatus.hidden = false;
  }

  mailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('mailTo').value.trim();
    const btn = mailForm.querySelector('button');
    const setStatus = (text, isError) => {
      mailStatus.textContent = text;
      mailStatus.classList.toggle('error', !!isError);
      mailStatus.hidden = !text;
    };

    btn.disabled = true;
    mejlPågår = true;
    setStatus('Skickar…', false);
    try {
      const res = await anrop('/api/receipt/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmp: r.competition.id, id: r.runner.id, email }),
      });
      if (res.offline) {
        setStatus('Ingen kontakt med tjänsten. Försök igen.', true);
      } else if (res.ok) {
        setStatus(`Kvittot är skickat till ${email}.`, false);
        mailForm.reset();
      } else {
        setStatus(res.data.error || 'Kunde inte skicka kvittot.', true);
      }
    } finally {
      mejlPågår = false;
      btn.disabled = false;
    }
  });

  document.getElementById('shareBtn').addEventListener('click', async () => {
    const url = new URL(location.href);
    url.search = `?cmp=${r.competition.id}&id=${r.runner.id}`;
    const title = `Resultat: ${r.runner.name}`;
    if (navigator.share) {
      try { await navigator.share({ title, url: url.toString() }); } catch { /* avbrutet */ }
    } else {
      await navigator.clipboard.writeText(url.toString());
      showMessage('Länk kopierad!');
      setTimeout(() => showMessage(''), 2500);
    }
  });
}

function renderHits(hits) {
  hitsEl.innerHTML = hits
    .map(
      (h) => `<li><button type="button" data-cmp="${h.cmp}" data-id="${h.id}">
        <strong>${esc(h.name)}</strong>
        <span class="meta">${esc(h.club)} · ${esc(h.class)}</span>
      </button></li>`
    )
    .join('');
  hitsEl.hidden = false;
}

/**
 * Alla anrop till tjänsten går genom den här: löparna är på mobildata vid
 * arenan (KRAV-13), och tappad täckning ska ge ett begripligt besked i stället
 * för en sida som ser ut att hänga. Returnerar { offline: true } när anropet
 * inte kom fram alls.
 */
async function anrop(url, opts, timeoutMs = 25000) {
  // Adresserna är rotabsoluta med flit: sidan serveras både från / och från
  // /t/<id> (KRAV-18), och en relativ adress löses då mot /t/ och ger 404 –
  // utan att servern märker något, eftersom HTML:en levererades felfritt.
  // Utan tidsgräns väntar sidan hur länge som helst på ett svar som kanske
  // aldrig kommer – ett glapp i mobilnätet ser då ut som att sidan hängt sig.
  const avbryt = new AbortController();
  const klocka = setTimeout(() => avbryt.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: avbryt.signal });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null; // svar utan JSON-kropp
    }
    return { ok: res.ok, status: res.status, data: data ?? {} };
  } catch {
    // Både nätverksfel och timeout hamnar här: för löparen är det samma sak.
    return { offline: true, ok: false, status: 0, data: {} };
  } finally {
    clearTimeout(klocka);
  }
}

function stoppaUppdatering() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
}

/**
 * Schemalägger nästa automatiska uppdatering.
 *
 * Det här låg på setInterval(15 s) medan varje anrop får ta upp till 25 s. En
 * långsam server fick då varje mobil att lägga en ny begäran ovanpå den förra
 * – flest anrop precis när servern har det som svårast. Timern sätts därför om
 * först när det föregående anropet är klart, vilket ger en naturlig inbromsning
 * i stället för en påspädning.
 */
function planeraUppdatering() {
  stoppaUppdatering();
  if (!current) return; // inget kvitto att uppdatera
  refreshTimer = setTimeout(
    () => loadReceipt({ cmp: current.cmp, id: current.id }, { silent: true }),
    15000
  );
}

async function loadReceipt(params, { silent = false } = {}) {
  const qs = new URLSearchParams(params);
  const res = await anrop('/api/receipt?' + qs.toString());
  if (res.offline) {
    // Under automatisk uppdatering: behåll kvittot som visas och tig, annars
    // blinkar ett felmeddelande varje gång täckningen glappar. Kedjan måste
    // sättas om här också – annars slutar sidan uppdatera sig för gott vid
    // första glappet i mobilnätet, och löparen ser ett fruset kvitto.
    if (!silent) showMessage('Ingen kontakt med tjänsten. Kontrollera uppkopplingen.');
    planeraUppdatering();
    return;
  }
  const data = res.data;
  if (res.status === 300 && data.alternatives) {
    // Flera löpare delar brickan – låt användaren välja.
    stoppaUppdatering();
    current = null;
    showMessage('Flera löpare har den brickan – välj i listan.');
    renderHits(data.alternatives);
    return;
  }
  if (!res.ok) {
    if (!silent) showMessage(data.error || 'Kunde inte hämta kvittot.');
    // Ett serverfel går över; ett 404 betyder att kvittot är borta (gallrat
    // eller fel länk) och kommer inte tillbaka av att vi frågar igen.
    if (silent && res.status >= 500) planeraUppdatering();
    else stoppaUppdatering();
    return;
  }
  showMessage('');
  hitsEl.hidden = true;
  // Ett pågående utskick håller kvar formuläret: ritas kvittot om byts noderna
  // ut, och svaret skrivs till ett formulär som inte längre sitter på sidan.
  // Löparen ser då ingenting hända och trycker igen – på ett tak om fem.
  if (!(silent && mejlPågår)) renderReceipt(data);
  current = { cmp: data.competition.id, id: data.runner.id };

  // Delar löparen sitt kvitto ska mottagaren hamna på samma tävling (KRAV-18)
  history.replaceState(
    null,
    '',
    bunden ? `/t/${bunden}?id=${current.id}` : `?cmp=${current.cmp}&id=${current.id}`
  );

  // Auto-refresh while the result is not final.
  const done = data.result.status > 0 && !data.result.preliminary;
  if (done) stoppaUppdatering();
  else planeraUppdatering();
}

async function search(q) {
  clearResults();
  const params = new URLSearchParams({ q });
  if (bunden) params.set('cmp', bunden);
  else if (!cmpSelect.hidden) params.set('cmp', cmpSelect.value);
  const res = await anrop('/api/search?' + params.toString());
  if (res.offline) {
    showMessage('Ingen kontakt med tjänsten. Kontrollera uppkopplingen och försök igen.');
    return;
  }
  const hits = res.data;
  if (!res.ok) {
    showMessage(hits.error || 'Sökningen misslyckades.');
    return;
  }
  if (hits.length === 0) {
    showMessage(`Ingen träff på "${q}". Kontrollera bricknumret eller prova med namn.`);
    return;
  }
  if (hits.length === 1) {
    await loadReceipt({ cmp: hits[0].cmp, id: hits[0].id });
    return;
  }
  renderHits(hits);
}

hitsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (btn) loadReceipt({ cmp: btn.dataset.cmp, id: btn.dataset.id });
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = queryInput.value.trim();
  if (q) search(q);
});

Promise.all([loadHealth(), loadCompetitions()]).then(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('id') || params.get('card')) {
    const p = {};
    for (const k of ['cmp', 'id', 'card']) if (params.get(k)) p[k] = params.get(k);
    // /t/4?id=31 har inget cmp – utan detta slås löpar-id upp i senaste
    // tävlingen, och id:na återanvänds mellan tävlingar (KRAV-6/KRAV-18).
    if (bunden) p.cmp = bunden;
    if (p.card) queryInput.value = p.card;
    loadReceipt(p);
  }
});
