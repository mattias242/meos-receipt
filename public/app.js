const form = document.getElementById('searchForm');
const queryInput = document.getElementById('query');
const cmpSelect = document.getElementById('cmpSelect');
const messageEl = document.getElementById('message');
const hitsEl = document.getElementById('hits');
const receiptEl = document.getElementById('receipt');

let refreshTimer = null;
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
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  current = null;
}

async function loadHealth() {
  const res = await anrop('api/health');
  mailEnabled = Boolean(res.data.email);
}

async function loadCompetitions() {
  const res = await anrop('api/competitions');
  const list = Array.isArray(res.data) ? res.data : [];
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

  receiptEl.innerHTML = `
    <div class="cmpName">${esc(r.competition.name)}</div>
    <div class="cmpMeta">${esc(r.competition.date)}${r.competition.organizer ? ' · ' + esc(r.competition.organizer) : ''}</div>
    <hr />
    <div class="runnerName">${esc(r.runner.name)}</div>
    <div class="runnerMeta">
      ${esc(r.runner.club)}${r.runner.team ? ' · ' + esc(r.runner.team) : ''}<br />
      Klass: ${esc(r.runner.class)}${r.runner.bib ? ' · Nr ' + esc(r.runner.bib) : ''}
      ${r.runner.card ? ' · Bricka ' + esc(r.runner.card) : ''}
    </div>
    <hr />
    ${res.time ? `<div class="bigTime">${esc(res.time)}</div>` : ''}
    <div class="status ${statusClass(r)}">${esc(res.statusText)}</div>
    ${res.preliminary ? '<div class="prel">Preliminärt resultat – ej fastställt</div>' : ''}
    ${place}
    ${res.after ? `<div class="place">Efter segraren: ${esc(res.after)}</div>` : ''}
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
      <a class="btn" id="pdfBtn" href="api/receipt.pdf?cmp=${r.competition.id}&id=${r.runner.id}">Ladda ner PDF</a>
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
    setStatus('Skickar…', false);
    const res = await anrop('api/receipt/email', {
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
    btn.disabled = false;
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
        <span class="meta">${esc(h.club)} · ${esc(h.class)}${h.card ? ' · Bricka ' + esc(h.card) : ''}</span>
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
async function anrop(url, opts) {
  try {
    const res = await fetch(url, opts);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null; // svar utan JSON-kropp
    }
    return { ok: res.ok, status: res.status, data: data ?? {} };
  } catch {
    return { offline: true, ok: false, status: 0, data: {} };
  }
}

async function loadReceipt(params, { silent = false } = {}) {
  const qs = new URLSearchParams(params);
  const res = await anrop('api/receipt?' + qs.toString());
  if (res.offline) {
    // Under automatisk uppdatering: behåll kvittot som visas och tig, annars
    // blinkar ett felmeddelande varje gång täckningen glappar.
    if (!silent) showMessage('Ingen kontakt med tjänsten. Kontrollera uppkopplingen.');
    return;
  }
  const data = res.data;
  if (res.status === 300 && data.alternatives) {
    // Flera löpare delar brickan – låt användaren välja.
    showMessage('Flera löpare har den brickan – välj i listan.');
    renderHits(data.alternatives);
    return;
  }
  if (!res.ok) {
    if (!silent) showMessage(data.error || 'Kunde inte hämta kvittot.');
    return;
  }
  showMessage('');
  hitsEl.hidden = true;
  renderReceipt(data);
  current = { cmp: data.competition.id, id: data.runner.id };

  history.replaceState(null, '', `?cmp=${current.cmp}&id=${current.id}`);

  // Auto-refresh while the result is not final.
  const done = data.result.status > 0 && !data.result.preliminary;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (!done) {
    refreshTimer = setInterval(
      () => loadReceipt({ cmp: current.cmp, id: current.id }, { silent: true }),
      15000
    );
  }
}

async function search(q) {
  clearResults();
  const params = new URLSearchParams({ q });
  if (!cmpSelect.hidden) params.set('cmp', cmpSelect.value);
  const res = await anrop('api/search?' + params.toString());
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
    if (p.card) queryInput.value = p.card;
    loadReceipt(p);
  }
});
