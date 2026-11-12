/* global agGrid */
const UI = window.TimeBackUI;
const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n).toFixed(2)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtT = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const state = { config: null, jobId: null, dx: null, media: null, parts: [], sel: {}, grid: null, pro: null, partsPaid: null };

async function api(path, body, isForm) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { throw new Error('Could not reach the FixFrame server. Run npm start and open http://localhost:3000.'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ======================= init =======================
async function init() {
  UI.setPalette('noir');
  try {
    state.config = await api('/api/config');
  } catch (err) {
    $('modes').innerHTML = `<div class="err-box">${esc(err.message)}</div>`;
    return;
  }
  const c = state.config;
  const badge = (t, on) => `<span class="badge ${on ? 'on' : ''}">${t}</span>`;
  $('badges').innerHTML = badge(c.aiEnabled ? 'Claude vision' : 'Demo diagnosis', c.aiEnabled) + badge(c.channel3Enabled ? 'Channel3 live' : 'Sample parts', c.channel3Enabled) + badge(c.paypalEnabled ? 'PayPal sandbox' : 'PayPal demo', c.paypalEnabled);
  $('modes').innerHTML = [
    [c.aiEnabled, c.aiEnabled ? `Live diagnosis with ${c.model}` : 'Live diagnosis needs an Anthropic key (demo clip works now)'],
    [c.channel3Enabled, c.channel3Enabled ? 'Real parts and prices from Channel3' : 'Sample parts until a Channel3 key is set'],
    [c.paypalEnabled, c.paypalEnabled ? 'PayPal sandbox checkout' : 'Simulated PayPal checkout'],
  ].map(([on, t]) => `<span><i class="${on ? 'on' : ''}"></i>${t}</span>`).join('');

  $('file').addEventListener('change', (e) => e.target.files[0] && analyze(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) analyze(f); });
  $('demoBtn').addEventListener('click', loadDemo);
  $('newBtn').addEventListener('click', () => location.assign('fix.html'));
  if (c.paypalEnabled) loadPayPalSdk();
  if (new URLSearchParams(location.search).get('demo')) loadDemo();
}

// ======================= analyze =======================
function showAnalyzing(previewHtml) {
  $('uploadView').classList.add('hidden');
  $('resultView').classList.add('hidden');
  $('analyzeView').classList.remove('hidden');
  $('scanMedia').insertAdjacentHTML('afterbegin', previewHtml);
  $('aSteps').innerHTML = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function aStep(text, live) {
  const li = document.createElement('li');
  li.textContent = text;
  if (live) li.classList.add('live');
  $('aSteps').appendChild(li);
  return li;
}
async function runSteps(promise, lines) {
  let last = aStep(lines[0], true);
  for (const line of lines.slice(1)) {
    await sleep(650);
    last.classList.remove('live');
    last = aStep(line, true);
  }
  const out = await promise;
  last.classList.remove('live');
  return out;
}

async function loadDemo() {
  showAnalyzing('<img src="media/demo-poster.jpg" alt="" />');
  try {
    const data = await runSteps(api('/api/demo'), ['Pulling 8 frames from your clip', 'Spotting what looks wrong', 'Matching the fault to parts', 'Writing your repair steps']);
    showResults(data, { url: data.media.url, type: 'video' });
  } catch (err) { fail(err); }
}

async function analyze(file) {
  const url = URL.createObjectURL(file);
  const isImg = file.type.startsWith('image/');
  showAnalyzing(isImg ? `<img src="${url}" alt="" />` : `<video src="${url}" autoplay muted loop playsinline></video>`);
  const fd = new FormData();
  fd.append('media', file);
  fd.append('note', $('note').value);
  try {
    const data = await runSteps(api('/api/diagnose', fd, true), ['Uploading your clip', 'Pulling frames from your video', 'Spotting what looks wrong', 'Matching the fault to parts', 'Writing your repair steps']);
    const media = data.source === 'demo' ? { url: 'media/demo-faucet.mp4', type: 'video' } : { url, type: isImg ? 'image' : 'video' };
    showResults(data, media);
  } catch (err) { fail(err); }
}

function fail(err) {
  $('aSteps').insertAdjacentHTML('beforeend', `<li class="err">${esc(err.message)}</li>`);
  setTimeout(() => {
    $('analyzeView').classList.add('hidden');
    $('uploadView').classList.remove('hidden');
    $('scanMedia').querySelectorAll('img,video').forEach((n) => n.remove());
  }, 3200);
}

// ======================= results =======================
function showResults(data, media) {
  state.jobId = data.id;
  state.dx = data.diagnosis;
  state.media = media;
  $('analyzeView').classList.add('hidden');
  $('resultView').classList.remove('hidden');
  UI.setPalette(state.dx.category);
  renderPlayer();
  renderDx(data.notice);
  renderSteps();
  loadParts();
  loadPros();
  window.TimeBackReveal && window.TimeBackReveal();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- player with overlay boxes + marker timeline ----------
function renderPlayer() {
  const dx = state.dx;
  const player = $('player');
  const v = $('video');
  $('ov').innerHTML = dx.markers.map((m, i) => `<div class="box ${m.box.y < 0.12 ? 'below' : ''} ${m.box.x + m.box.w / 2 > 0.6 ? 'right' : ''}" data-i="${i}" style="left:${m.box.x * 100}%;top:${m.box.y * 100}%;width:${m.box.w * 100}%;height:${m.box.h * 100}%"><span class="tag">${esc(m.label)}</span></div>`).join('');
  $('markerChips').innerHTML = dx.markers.map((m, i) => `<button class="mchip" data-i="${i}" type="button"><b>${fmtT(m.t)}</b>${esc(m.label)}</button>`).join('');
  $('markerChips').onclick = (e) => { const b = e.target.closest('.mchip'); if (b) seekMarker(Number(b.dataset.i)); };

  if (state.media.type === 'image') {
    v.replaceWith(Object.assign(document.createElement('img'), { id: 'video', src: state.media.url, alt: 'Your photo' }));
    document.querySelectorAll('.box').forEach((b) => b.classList.add('show'));
    $('timeline').classList.add('hidden');
    $('playBtn').classList.add('hidden');
    return;
  }
  v.src = state.media.url;
  v.loop = true;
  v.addEventListener('loadedmetadata', () => {
    const d = v.duration || 12;
    $('timeline').insertAdjacentHTML('beforeend', dx.markers.map((m, i) => `<div class="mk" data-i="${i}" style="left:${(m.t / d) * 100}%"><i></i><span>${fmtT(m.t)}</span></div>`).join(''));
    v.play().catch(() => {});
  }, { once: true });
  $('playBtn').onclick = () => (v.paused ? v.play() : v.pause());
  v.addEventListener('play', () => ($('playBtn').textContent = '❚❚'));
  v.addEventListener('pause', () => ($('playBtn').textContent = '▶'));
  $('timeline').onclick = (e) => {
    const r = $('timeline').getBoundingClientRect();
    v.currentTime = ((e.clientX - r.left) / r.width) * (v.duration || 12);
  };
  const tick = () => {
    const t = v.currentTime;
    const d = v.duration || 12;
    $('tlFill').style.width = `${(t / d) * 100}%`;
    $('tlHead').style.left = `${(t / d) * 100}%`;
    $('tlTime').textContent = `${fmtT(t)} / ${fmtT(d)}`;
    // Show only the marker nearest to the playhead (within 1s), so labels never overlap.
    let near = -1;
    dx.markers.forEach((m, i) => { if (Math.abs(t - m.t) < 1 && (near < 0 || Math.abs(t - m.t) < Math.abs(t - dx.markers[near].t))) near = i; });
    const pinned = document.querySelector('.box[data-pin="1"]');
    const show = pinned && v.paused ? Number(pinned.dataset.i) : near;
    document.querySelectorAll('.box').forEach((b) => b.classList.toggle('show', Number(b.dataset.i) === show));
    document.querySelectorAll('.mchip').forEach((c) => c.classList.toggle('on', Number(c.dataset.i) === show));
    syncSteps(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function seekMarker(i) {
  const v = $('video');
  const m = state.dx.markers[i];
  if (v.tagName === 'VIDEO') {
    v.pause();
    v.currentTime = m.t;
  }
  document.querySelectorAll('.box').forEach((b) => (b.dataset.pin = b.dataset.i === String(i) ? '1' : ''));
  $('player').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- diagnosis card ----------
function renderDx(notice) {
  const dx = state.dx;
  $('dxItem').textContent = dx.item;
  $('dxProblem').textContent = dx.problem;
  $('dxSummary').textContent = dx.summary;
  $('dxPills').innerHTML = `<span class="pillx ${dx.difficulty}">${dx.difficulty[0].toUpperCase() + dx.difficulty.slice(1)} fix</span><span class="pillx">~${dx.minutes} min</span><span class="pillx">${esc(dx.category)}</span>`;
  UI.countDot($('dxConf'), Math.round(dx.confidence * 100), (v) => v.toFixed(0), 1100);
  UI.ruler($('confRuler'), dx.confidence);
  $('dxTools').innerHTML = dx.tools.map((t) => `<span>${esc(t)}</span>`).join('');
  $('dxSafety').innerHTML = dx.safety.map((s) => `<div class="safety">⚠ ${esc(s)}</div>`).join('');
  $('dxNotice').innerHTML = notice ? `<div class="notice">${esc(notice)}</div>` : '';
}

// ---------- steps pinned to timestamps ----------
function renderSteps() {
  const dx = state.dx;
  $('stepsMeta').textContent = `${dx.steps.length} steps · ~${dx.minutes} min`;
  $('stepsList').innerHTML = dx.steps.map((s, i) => `<div class="step" data-i="${i}"><span class="n">${i + 1}</span><span><b>${esc(s.title)}</b><small>${esc(s.detail)}</small></span><span class="ts">▶ ${fmtT(s.t)}</span></div>`).join('');
  $('stepsList').onclick = (e) => {
    const el = e.target.closest('.step');
    if (!el) return;
    const s = dx.steps[Number(el.dataset.i)];
    document.querySelectorAll('.step').forEach((x) => x.classList.toggle('on', x === el));
    state.stepPinned = Number(el.dataset.i);
    const v = $('video');
    if (v.tagName === 'VIDEO') { v.currentTime = s.t; v.play().catch(() => {}); }
    $('player').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => (state.stepPinned = null), 2500);
  };
}
function syncSteps(t) {
  if (state.stepPinned != null) return;
  const steps = state.dx.steps;
  let best = -1;
  steps.forEach((s, i) => { if (Math.abs(s.t - t) < 1.3 && (best < 0 || Math.abs(s.t - t) < Math.abs(steps[best].t - t))) best = i; });
  document.querySelectorAll('.step').forEach((x, i) => x.classList.toggle('on', i === best));
}

// ======================= parts (Channel3) + verdict =======================
async function loadParts() {
  $('cartSum').innerHTML = '<p class="muted">Finding parts…</p>';
  try {
    const { parts } = await api(`/api/jobs/${state.jobId}/parts`);
    state.parts = parts;
    state.sel = {};
    parts.forEach((p) => { state.sel[p.key] = cheapest(p.offers); });
    renderParts();
  } catch (err) {
    $('cartSum').innerHTML = `<div class="err-box">${esc(err.message)}</div>`;
  }
}
const cheapest = (offers) => offers.reduce((best, o, i) => (best < 0 || o.price < offers[best].price ? i : best), -1);

function renderParts() {
  const live = state.parts.some((p) => p.source === 'channel3');
  $('partsSrc').textContent = live ? 'Live from Channel3' : 'Sample offers';
  $('partsSrc').className = `src ${live ? 'live' : ''}`;
  $('partChips').innerHTML = state.parts.map((p) => `<div class="part-chip">${p.crop ? `<img src="${p.crop}" alt="Photo search crop" />` : `<span class="ph">×${p.qty}</span>`}
    <span><b>${esc(p.name)}</b><small>${esc(p.why)}${p.required ? '' : ' · optional'}</small></span>
    <button class="ghost" data-k="${esc(p.key)}" type="button" style="padding:6px 12px;font-size:12px">${p.crop ? 'Photo matched' : 'Find by photo'}</button></div>`).join('');
  $('partChips').onclick = (e) => { const b = e.target.closest('button[data-k]'); if (b) visualSearch(b.dataset.k, b); };
  const rows = state.parts.flatMap((p) => p.offers.map((o, i) => ({ id: `${p.key}:${i}`, partKey: p.key, part: p.name, offer: i, required: p.required, ...o })));
  if (!state.grid) createGrid();
  state.grid.setGridOption('rowData', rows);
  renderCart();
}

async function visualSearch(key, btn) {
  btn.disabled = true;
  btn.textContent = 'Searching…';
  try {
    const r = await api(`/api/jobs/${state.jobId}/visual-search`, { partKey: key });
    const p = state.parts.find((x) => x.key === key);
    Object.assign(p, { offers: r.offers, source: r.source, crop: r.crop });
    state.sel[key] = cheapest(r.offers);
    renderParts();
  } catch (err) {
    btn.textContent = 'Try again';
    btn.disabled = false;
  }
}

function createGrid() {
  if (!window.agGrid) {
    $('grid').innerHTML = '<p class="muted">The parts grid needs AG Grid. Run npm install and npm start.</p>';
    state.grid = { setGridOption() {}, refreshCells() {} };
    return;
  }
  state.grid = agGrid.createGrid($('grid'), {
    columnDefs: [
      { headerName: '', width: 54, cellClass: 'center-cell', sortable: false, filter: false,
        cellRenderer: (p) => `<input type="radio" class="pick-radio" ${state.sel[p.data.partKey] === p.data.offer ? 'checked' : ''} aria-label="Pick ${esc(p.data.title)}">`,
        onCellClicked: (p) => pick(p.data) },
      { headerName: 'Part', field: 'part', width: 190, filter: 'agTextColumnFilter' },
      { headerName: 'Product', field: 'title', flex: 2, minWidth: 220, tooltipField: 'title',
        cellRenderer: (p) => `<div class="thumb-cell">${p.data.image ? `<img src="${esc(p.data.image)}" alt="" loading="lazy">` : '<span class="ph"></span>'}<span>${esc(p.value)}</span></div>` },
      { headerName: 'Store', field: 'merchant', flex: 1, minWidth: 140 },
      { headerName: 'Price', field: 'price', width: 110, type: 'rightAligned', sort: 'asc', filter: false, valueFormatter: (p) => money(p.value),
        cellClass: (p) => (state.sel[p.data.partKey] === p.data.offer ? 'bold' : '') },
      { headerName: 'Stock', field: 'availability', width: 110, cellRenderer: (p) => `<span class="avail ${/InStock/i.test(p.value) ? '' : 'low'}">${/InStock/i.test(p.value) ? 'In stock' : /Limited|Low/i.test(p.value || '') ? 'Low stock' : /PreOrder/i.test(p.value || '') ? 'Pre-order' : esc(p.value || 'Unknown')}</span>` },
      { headerName: '', field: 'url', width: 80, sortable: false, filter: false, cellRenderer: (p) => (p.value ? `<a href="${esc(p.value)}" target="_blank" rel="noopener" style="color:var(--lime)">View</a>` : '') },
    ],
    defaultColDef: { sortable: true, resizable: true, filter: true },
    getRowId: (p) => p.data.id,
    rowClassRules: { 'row-chosen': (p) => p.data && state.sel[p.data.partKey] === p.data.offer },
    postSortRows: (p) => { p.nodes.sort((a, b) => a.data.part.localeCompare(b.data.part) || a.data.price - b.data.price); },
    domLayout: 'autoHeight',
    rowHeight: 52,
    animateRows: true,
    suppressCellFocus: true,
  });
}

function pick(row) {
  if (state.partsPaid) return;
  const cur = state.sel[row.partKey];
  state.sel[row.partKey] = cur === row.offer && !row.required ? -1 : row.offer;
  state.grid.refreshCells({ force: true });
  state.grid.redrawRows();
  renderCart();
}

function chosenParts() {
  return state.parts.filter((p) => state.sel[p.key] >= 0).map((p) => ({ part: p, offer: p.offers[state.sel[p.key]] }));
}

function renderCart() {
  const chosen = chosenParts();
  const total = chosen.reduce((s, c) => s + c.offer.price * (c.part.qty || 1), 0);
  state.repairTotal = total;
  $('cartSum').innerHTML = chosen.map((c) => `<div class="line"><span>${esc(c.part.name)}<br><small style="color:var(--ink-3)">${esc(c.offer.merchant)}</small></span><b>${money(c.offer.price * (c.part.qty || 1))}</b></div>`).join('')
    + `<div class="total"><span>Parts total</span><div class="dmx" id="cartTotal"></div></div>`;
  UI.dot($('cartTotal'), `$${total.toFixed(2)}`);
  const canPay = chosen.length && !state.partsPaid;
  $('ppParts').classList.toggle('hidden', !canPay || !state.config.paypalEnabled);
  $('demoPayParts').classList.toggle('hidden', !canPay || state.config.paypalEnabled);
  $('demoPayParts').onclick = payPartsDemo;
  renderVerdict();
}

function renderVerdict() {
  const dx = state.dx;
  const repair = state.repairTotal || 0;
  const save = Math.max(0, dx.replace.price - repair);
  UI.countText($('vRepair'), repair, (v) => `$${v.toFixed(0)}`);
  UI.countText($('vReplace'), dx.replace.price, (v) => `$${v.toFixed(0)}`);
  UI.countText($('vSave'), save, (v) => `$${v.toFixed(0)}`, 1300);
  $('vRepairFoot').textContent = `${chosenParts().length} parts · ~${dx.minutes} min`;
  $('vReplaceFoot').textContent = dx.replace.item;
  const bits = [`${dx.waste_kg} kg kept out of landfill`];
  if (dx.water_gal_year) bits.push(`~${dx.water_gal_year.toLocaleString()} gal of water a year`);
  $('vImpact').textContent = bits.join(' · ');
}

// ======================= PayPal: parts =======================
function loadPayPalSdk() {
  const add = (intent, ns, cb) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(state.config.paypalClientId)}&currency=${state.config.currency}&intent=${intent}`;
    s.dataset.namespace = ns;
    s.onload = cb;
    document.head.appendChild(s);
  };
  add('capture', 'paypalCapture', () => {
    window.paypalCapture.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'pay' },
      createOrder: async () => (await api('/api/orders/parts', partsPayload())).id,
      onApprove: async (d) => partsPaid(await api(`/api/orders/${d.orderID}/capture`, {})),
      onError: (err) => alert(`PayPal error: ${err.message || err}`),
    }).render('#ppParts');
  });
  add('authorize', 'paypalAuthorize', () => (state.authSdkReady = true));
}
const partsPayload = () => ({ jobId: state.jobId, selections: chosenParts().map((c) => ({ partKey: c.part.key, offer: state.sel[c.part.key] })) });
async function payPartsDemo() {
  $('demoPayParts').disabled = true;
  const o = await api('/api/orders/parts', partsPayload());
  partsPaid(await api(`/api/orders/${o.id}/capture`, {}));
}
function partsPaid(r) {
  state.partsPaid = r;
  $('ppParts').classList.add('hidden');
  $('demoPayParts').classList.add('hidden');
  $('partsPaid').innerHTML = `<div class="vresult ok" style="margin-top:14px"><h3>Parts ordered</h3><span>Paid ${money(r.total)} with PayPal${r.demo ? ' (demo)' : ''} · order ${esc(r.id)}</span>
    <a class="btn light" href="${doneHref('diy')}" style="justify-self:start">See what you saved <span class="plus">→</span></a></div>`;
  UI.setPalette('done');
}

// ======================= pros: pay only if fixed =======================
async function loadPros() {
  const { pros } = await api(`/api/jobs/${state.jobId}/pros`);
  const colors = ['#a6d0f5', '#f3a3c4', '#cfe4c9', '#f7c79b'];
  $('pros').innerHTML = pros.map((p, i) => `<div class="pro" data-id="${p.id}">
    <div class="top-r"><span class="av" style="background:${colors[i % 4]}">${esc(p.name.split(' ').map((w) => w[0]).join('').slice(0, 2))}</span>${p.verified ? '<span class="pillx">Verified</span>' : ''}</div>
    <div><b>${esc(p.name)}</b><br><small>★ ${p.rating} · ${p.jobs} jobs · ${esc(p.eta)}</small></div>
    <div class="q"><div class="dmx sm" data-q="${p.quote}"></div><button class="ghost" data-book="${p.id}" type="button">Book</button></div></div>`).join('');
  document.querySelectorAll('[data-q]').forEach((el) => UI.dot(el, `$${el.dataset.q}`));
  $('pros').onclick = (e) => { const b = e.target.closest('[data-book]'); if (b) bookPro(pros.find((p) => p.id === b.dataset.book)); };
  setFlow('book');
}

function setFlow(now, bad) {
  const order = ['book', 'hold', 'repair', 'verify', 'pay'];
  const idx = order.indexOf(now);
  document.querySelectorAll('#flow .fs').forEach((el, i) => {
    el.className = `fs ${i < idx ? 'done' : ''} ${i === idx ? (bad ? 'bad' : 'now') : ''}`;
  });
}

async function bookPro(pro) {
  if (state.pro && state.pro.status !== 'VOIDED') return;
  document.querySelectorAll('.pro').forEach((el) => el.classList.toggle('sel', el.dataset.id === pro.id));
  state.pro = { ...pro, status: 'CREATED' };
  setFlow('hold');
  if (state.config.paypalEnabled && state.authSdkReady) {
    $('proAction').innerHTML = `<p class="muted">Approve a <b>${money(pro.quote)}</b> hold with PayPal. You won't be charged unless the repair is verified.</p><div class="pp-wrap" id="ppPro" style="max-width:420px;margin-top:10px"></div>`;
    window.paypalAuthorize.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'paypal' },
      createOrder: async () => (await api('/api/pro/orders', { jobId: state.jobId, proId: pro.id })).id,
      onApprove: async (d) => held(await api(`/api/pro/orders/${d.orderID}/authorize`, { jobId: state.jobId })),
    }).render('#ppPro');
  } else {
    $('proAction').innerHTML = `<p class="muted">Approve a <b>${money(pro.quote)}</b> hold. You won't be charged unless the repair is verified.</p><button class="btn pay" id="holdDemo" style="max-width:420px;margin-top:10px">Hold ${money(pro.quote)} with PayPal (demo)</button>`;
    $('holdDemo').onclick = async () => {
      $('holdDemo').disabled = true;
      const o = await api('/api/pro/orders', { jobId: state.jobId, proId: pro.id });
      held(await api(`/api/pro/orders/${o.id}/authorize`, { jobId: state.jobId }));
    };
  }
}

function held(r) {
  state.pro.status = 'HELD';
  state.pro.authorizationId = r.authorizationId;
  setFlow('repair');
  $('proAction').innerHTML = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><span class="hold-badge">${money(state.pro.quote)} held by PayPal · not charged</span><small class="muted" style="margin:0">Authorization ${esc(r.authorizationId)}</small></div>
    <h3 style="margin:0 0 8px">After ${esc(state.pro.name)} finishes, film it again</h3>
    <div class="verify-box">
      <label class="drop" style="min-height:150px"><input type="file" id="afterFile" accept="video/*,image/*" capture="environment"><div><b>Upload your after-clip</b><p style="font-size:13px">FixFrame compares it to the original problem</p></div></label>
      <div class="side-card" style="padding:0;gap:10px">
        <small class="muted" style="margin:0">Or try the demo after-clips:</small>
        <button class="demo-card" data-demo="fixed" type="button"><video src="media/demo-faucet-fixed.mp4" muted loop autoplay playsinline style="width:110px;height:62px;object-fit:cover;border-radius:12px"></video><span><b>Repaired faucet</b><small>No drip, dry handle base</small></span></button>
        <button class="demo-card" data-demo="leaking" type="button"><video src="media/demo-faucet.mp4" muted loop autoplay playsinline style="width:110px;height:62px;object-fit:cover;border-radius:12px"></video><span><b>Still leaking</b><small>See what happens if it isn't fixed</small></span></button>
      </div>
    </div>
    <div id="verifyOut" style="margin-top:14px"></div>`;
  $('afterFile').onchange = (e) => e.target.files[0] && verify({ file: e.target.files[0] });
  document.querySelectorAll('[data-demo]').forEach((b) => (b.onclick = () => verify({ demo: b.dataset.demo })));
}

async function verify({ file, demo }) {
  setFlow('verify');
  const out = $('verifyOut');
  out.innerHTML = '<ol class="steps"><li class="live">Comparing the after-clip to the original problem…</li></ol>';
  const fd = new FormData();
  fd.append('jobId', state.jobId);
  if (demo) fd.append('demo', demo);
  if (file) fd.append('media', file);
  try {
    const [r] = await Promise.all([api('/api/pro/verify', fd, true), sleep(1400)]);
    const v = r.verdict;
    if (v.fixed) {
      setFlow('pay');
      document.querySelectorAll('#flow .fs').forEach((el) => el.classList.add('done'));
      state.pro.status = 'CAPTURED';
      state.pro.payment = r.payment;
      out.innerHTML = `<div class="vresult ok"><h3>✓ Verified fixed · ${Math.round(v.confidence * 100)}% confident</h3><span>${esc(v.reason)}</span>
        <span><b>${money(r.payment.amount)}</b> released to ${esc(state.pro.name)} via PayPal${r.payment.demo ? ' (demo)' : ''} · capture ${esc(r.payment.captureId)}</span>
        <a class="btn light" href="${doneHref('pro')}" style="justify-self:start">See your repair summary <span class="plus">→</span></a></div>`;
      UI.setPalette('done');
    } else {
      setFlow('verify', true);
      out.innerHTML = `<div class="vresult no"><h3>✗ Not fixed yet</h3><span>${esc(v.reason)}</span><span>${esc(r.payment.message)}</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ghost" id="voidBtn" type="button">Cancel and release the hold</button></div></div>`;
      $('voidBtn').onclick = async () => {
        const x = await api('/api/pro/void', { jobId: state.jobId });
        state.pro.status = 'VOIDED';
        out.insertAdjacentHTML('beforeend', `<div class="notice" style="margin-top:10px">${esc(x.message)}</div>`);
      };
    }
  } catch (err) {
    out.innerHTML = `<div class="err-box">${esc(err.message)}</div>`;
  }
}

// ======================= summary page =======================
function doneHref(mode) {
  const dx = state.dx;
  const repair = mode === 'pro' ? state.pro.quote : state.repairTotal;
  const payload = {
    mode, item: dx.item, problem: dx.problem, category: dx.category,
    repair, replace: dx.replace.price, replaceItem: dx.replace.item, saved: Math.max(0, dx.replace.price - repair),
    waste: dx.waste_kg, water: dx.water_gal_year || 0, minutes: dx.minutes,
    parts: mode === 'diy' ? chosenParts().map((c) => ({ name: c.part.name, store: c.offer.merchant, price: c.offer.price })) : [],
    pro: mode === 'pro' ? { name: state.pro.name, amount: state.pro.quote, capture: state.pro.payment && state.pro.payment.captureId } : null,
    order: mode === 'diy' ? state.partsPaid && state.partsPaid.id : null,
    demo: mode === 'diy' ? state.partsPaid && state.partsPaid.demo : state.pro && state.pro.payment && state.pro.payment.demo,
  };
  try { sessionStorage.setItem('fixframe:done', JSON.stringify(payload)); } catch (e) { /* storage blocked */ }
  return `done.html#${encodeURIComponent(JSON.stringify(payload))}`;
}

init();
