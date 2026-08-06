const form = document.getElementById('searchForm');
const queryInput = document.getElementById('query');
const cmpSelect = document.getElementById('cmpSelect');
const messageEl = document.getElementById('message');
const hitsEl = document.getElementById('hits');
const receiptEl = document.getElementById('receipt');

let refreshTimer = null;
let current = null; // {cmp, id} of the shown receipt

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

async function loadCompetitions() {
  try {
    const res = await fetch('api/competitions');
    const list = await res.json();
    if (list.length > 1) {
      cmpSelect.innerHTML = list
        .map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.date)})</option>`)
        .join('');
      cmpSelect.hidden = false;
    } else {
      cmpSelect.hidden = true;
    }
    if (list.length === 0) {
      showMessage('Ingen tävling är inläst ännu. Kvittot blir tillgängligt när tävlingen skickar resultat.');
    }
  } catch {
    /* offline – ignore */
  }
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
      return `<tr${s.status === 'missing' ? ' class="missRow"' : ''}>
        <td>${esc(s.name)}${badge}</td>
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
      <tr><th>Starttid</th><td class="num">${esc(res.startTime) || '–'}</td></tr>
      ${res.finishTime ? `<tr><th>Måltid</th><td class="num">${esc(res.finishTime)}</td></tr>` : ''}
    </table>
    ${
      r.splits.length
        ? `<hr />
      <table>
        <tr class="splitsHead"><th>Kontroll</th><th class="num">Sträcka</th><th class="num">Total</th><th class="num">Klocka</th></tr>
        ${rows}
      </table>`
        : ''
    }
    <div class="updated">Uppdaterat ${r.updated ? new Date(r.updated).toLocaleTimeString('sv-SE') : '–'}</div>
    <div class="shareRow"><button type="button" id="shareBtn">Dela kvittot</button></div>
  `;
  receiptEl.hidden = false;

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

async function loadReceipt(params, { silent = false } = {}) {
  const qs = new URLSearchParams(params);
  const res = await fetch('api/receipt?' + qs.toString());
  const data = await res.json();
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
  const res = await fetch('api/search?' + params.toString());
  const hits = await res.json();
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

loadCompetitions().then(() => {
  const params = new URLSearchParams(location.search);
  if (params.get('id') || params.get('card')) {
    const p = {};
    for (const k of ['cmp', 'id', 'card']) if (params.get(k)) p[k] = params.get(k);
    if (p.card) queryInput.value = p.card;
    loadReceipt(p);
  }
});
