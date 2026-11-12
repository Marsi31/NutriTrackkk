'use strict';
/* NutriTrack — tot s'emmagatzema localment (localStorage + IndexedDB per a fotos). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY = 'nutritrack.v1';
const MEALS = { esmorzar: 'Esmorzar', dinar: 'Dinar', sopar: 'Sopar', snack: 'Berenar / Snack' };
const DEFAULTS = { goals: { kcal: 2000, p: 120, c: 230, f: 65 }, entries: [], weights: [] };

/* ---------- Estat ---------- */
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY)) || {};
    return { ...structuredClone(DEFAULTS), ...s, goals: { ...DEFAULTS.goals, ...(s.goals || {}) } };
  } catch { return structuredClone(DEFAULTS); }
}
let S = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(S));
let currentDate = todayISO();
let editingId = null;
let pendingPhoto = null;      // Blob nou
let photoRemoved = false;

/* ---------- Utilitats ---------- */
function todayISO(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return todayISO(d); };
const fmtDate = (iso, opt) => new Date(iso + 'T12:00:00').toLocaleDateString('ca', opt);
const r0 = n => Math.round(n);
const r1 = n => Math.round(n * 10) / 10;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}
const sum = (list, k) => list.reduce((a, e) => a + (e[k] || 0), 0);
const dayEntries = d => S.entries.filter(e => e.date === d);

/* ---------- Fotos (IndexedDB) ---------- */
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('nutritrack-photos', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('p');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function photoOp(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('p', mode); const st = t.objectStore('p');
    const req = fn(st);
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
const putPhoto = (id, blob) => photoOp('readwrite', s => s.put(blob, id));
const getPhoto = id => photoOp('readonly', s => s.get(id));
const delPhoto = id => photoOp('readwrite', s => s.delete(id));

async function resizeImage(file, max = 900) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = r0(bmp.width * k); c.height = r0(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
}

/* ---------- Navegació ---------- */
function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $('#fab').style.display = name === 'home' || name === 'history' ? '' : 'none';
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  if (name === 'weight') renderWeight();
  if (name === 'profile') renderProfile();
  window.scrollTo(0, 0);
}
$$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

/* ---------- Inici ---------- */
const CIRC = 2 * Math.PI * 52;
function renderHome() {
  const list = dayEntries(currentDate);
  const g = S.goals;
  const kcal = sum(list, 'kcal');
  const isToday = currentDate === todayISO();
  $('#day-label').textContent = isToday ? 'Avui' : currentDate === addDays(todayISO(), -1) ? 'Ahir' : fmtDate(currentDate, { day: 'numeric', month: 'long' });
  $('#day-sub').textContent = fmtDate(currentDate, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#next-day').style.visibility = isToday ? 'hidden' : 'visible';

  const left = g.kcal - kcal;
  $('#kcal-left').textContent = r0(Math.abs(left));
  $('#kcal-left-label').textContent = left >= 0 ? 'kcal restants' : 'kcal de més';
  $('#kcal-eaten').textContent = r0(kcal);
  $('#kcal-goal').textContent = g.kcal;
  const ring = $('#ring-fg');
  const pct = g.kcal > 0 ? Math.min(kcal / g.kcal, 1) : 0;
  ring.style.strokeDashoffset = CIRC * (1 - pct);
  ring.classList.toggle('over', left < 0);

  const macros = [['Proteïnes', 'p', 'var(--p)'], ['Hidrats', 'c', 'var(--c)'], ['Greixos', 'f', 'var(--f)']];
  $('#macros').innerHTML = macros.map(([n, k, col]) => {
    const v = sum(list, k), goal = g[k], w = goal > 0 ? Math.min(v / goal * 100, 100) : 0;
    const rest = goal - v;
    return `<div class="macro"><div class="macro-head"><b>${n}</b>
      <span>${r0(v)} / ${goal} g · ${rest >= 0 ? r0(rest) + ' g restants' : r0(-rest) + ' g de més'}</span></div>
      <div class="bar"><i style="width:${w}%;background:${col}"></i></div></div>`;
  }).join('');

  $('#meals').innerHTML = Object.entries(MEALS).map(([key, label]) => {
    const items = list.filter(e => e.meal === key);
    return `<div class="meal"><div class="meal-head"><b>${label}</b><span>${r0(sum(items, 'kcal'))} kcal</span></div>
      ${items.map(entryHTML).join('') || '<p class="empty">Cap aliment</p>'}</div>`;
  }).join('');
  hydratePhotos();
}
function entryHTML(e) {
  return `<div class="entry" data-id="${e.id}">
    ${e.photo ? `<img data-photo="${e.id}" alt="">` : ''}
    <div class="info"><b>${esc(e.name)}</b><small>${r1(e.qty)} g · P ${r0(e.p)} · H ${r0(e.c)} · G ${r0(e.f)}</small></div>
    <span class="kc">${r0(e.kcal)} kcal</span></div>`;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlCache = new Map();
async function hydratePhotos() {
  for (const img of $$('img[data-photo]')) {
    const id = img.dataset.photo;
    try {
      if (!urlCache.has(id)) { const b = await getPhoto(id); if (b) urlCache.set(id, URL.createObjectURL(b)); }
      if (urlCache.has(id)) img.src = urlCache.get(id);
    } catch { /* sense foto */ }
  }
}
$('#meals').addEventListener('click', ev => {
  const img = ev.target.closest('img[data-photo]');
  if (img && img.src) { $('#viewer-img').src = img.src; $('#viewer').hidden = false; return; }
  const row = ev.target.closest('.entry');
  if (row) openSheet(row.dataset.id);
});
$('#viewer').addEventListener('click', () => ($('#viewer').hidden = true));
$('#prev-day').onclick = () => { currentDate = addDays(currentDate, -1); renderHome(); };
$('#next-day').onclick = () => { if (currentDate < todayISO()) { currentDate = addDays(currentDate, 1); renderHome(); } };

/* ---------- Historial ---------- */
function renderHistory() {
  const days = [...new Set(S.entries.map(e => e.date))].sort().reverse();
  $('#history-list').innerHTML = days.length ? days.map(d => {
    const l = dayEntries(d);
    return `<div class="day-row" data-date="${d}"><div><b>${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
      <small>${l.length} aliments · P ${r0(sum(l, 'p'))} · H ${r0(sum(l, 'c'))} · G ${r0(sum(l, 'f'))}</small></div>
      <span class="kc">${r0(sum(l, 'kcal'))}<small> kcal</small></span></div>`;
  }).join('') : '<p class="empty">Encara no hi ha cap àpat registrat.</p>';
}
$('#history-list').addEventListener('click', ev => {
  const r = ev.target.closest('.day-row'); if (!r) return;
  currentDate = r.dataset.date; showView('home');
});

/* ---------- Pes ---------- */
function renderWeight() {
  const w = [...S.weights].sort((a, b) => a.date.localeCompare(b.date));
  $('#weight-empty').hidden = w.length >= 2;
  $('#weight-chart').style.display = w.length >= 2 ? 'block' : 'none';
  $('#weight-delta').textContent = w.length >= 2 ? `${r1(w.at(-1).kg - w[0].kg) > 0 ? '+' : ''}${r1(w.at(-1).kg - w[0].kg)} kg` : '';
  if (w.length >= 2) drawChart(w);
  $('#weight-list').innerHTML = [...w].reverse().map(x =>
    `<div class="day-row" data-wid="${x.id}"><div><b>${fmtDate(x.date, { day: 'numeric', month: 'long', year: 'numeric' })}</b><small>Toca per eliminar</small></div>
     <span class="kc">${r1(x.kg)} kg</span></div>`).join('');
}
$('#weight-form').addEventListener('submit', ev => {
  ev.preventDefault();
  const kg = parseFloat($('#weight-input').value.replace(',', '.'));
  if (!kg) return;
  const date = todayISO();
  S.weights = S.weights.filter(x => x.date !== date);
  S.weights.push({ id: uid(), date, kg });
  save(); $('#weight-input').value = ''; renderWeight(); toast('Pes desat');
});
$('#weight-list').addEventListener('click', ev => {
  const r = ev.target.closest('[data-wid]'); if (!r) return;
  if (confirm('Eliminar aquest registre de pes?')) { S.weights = S.weights.filter(x => x.id !== r.dataset.wid); save(); renderWeight(); }
});
function drawChart(w) {
  const c = $('#weight-chart'), dpr = window.devicePixelRatio || 1;
  const W = c.clientWidth, H = 220;
  c.width = W * dpr; c.height = H * dpr;
  const x = c.getContext('2d'); x.scale(dpr, dpr); x.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim(), muted = css.getPropertyValue('--muted').trim(), line = css.getPropertyValue('--line').trim();
  const vals = w.map(p => p.kg);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max - min < 1) { min -= 0.5; max += 0.5; }
  const pad = { l: 38, r: 12, t: 12, b: 26 };
  const px = i => pad.l + (w.length === 1 ? 0 : i / (w.length - 1)) * (W - pad.l - pad.r);
  const py = v => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  x.font = '11px -apple-system, sans-serif'; x.fillStyle = muted; x.strokeStyle = line; x.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const v = min + (max - min) * i / 3, y = py(v);
    x.beginPath(); x.moveTo(pad.l, y); x.lineTo(W - pad.r, y); x.stroke();
    x.textAlign = 'right'; x.fillText(r1(v), pad.l - 6, y + 4);
  }
  x.textAlign = 'left'; x.fillText(fmtDate(w[0].date, { day: 'numeric', month: 'short' }), pad.l, H - 6);
  x.textAlign = 'right'; x.fillText(fmtDate(w.at(-1).date, { day: 'numeric', month: 'short' }), W - pad.r, H - 6);
  const grad = x.createLinearGradient(0, pad.t, 0, H - pad.b);
  grad.addColorStop(0, accent + '55'); grad.addColorStop(1, accent + '00');
  x.beginPath(); w.forEach((p, i) => i ? x.lineTo(px(i), py(p.kg)) : x.moveTo(px(i), py(p.kg)));
  x.lineTo(px(w.length - 1), H - pad.b); x.lineTo(px(0), H - pad.b); x.closePath(); x.fillStyle = grad; x.fill();
  x.beginPath(); w.forEach((p, i) => i ? x.lineTo(px(i), py(p.kg)) : x.moveTo(px(i), py(p.kg)));
  x.strokeStyle = accent; x.lineWidth = 3; x.lineJoin = 'round'; x.stroke();
  w.forEach((p, i) => { x.beginPath(); x.arc(px(i), py(p.kg), 4, 0, 7); x.fillStyle = accent; x.fill(); });
}
window.addEventListener('resize', () => { if ($('#view-weight').classList.contains('active')) renderWeight(); });

/* ---------- Perfil ---------- */
function renderProfile() {
  const g = S.goals;
  $('#g-kcal').value = g.kcal; $('#g-p').value = g.p; $('#g-c').value = g.c; $('#g-f').value = g.f;
  updateGoalHint();
}
function updateGoalHint() {
  const k = 4 * (+$('#g-p').value || 0) + 4 * (+$('#g-c').value || 0) + 9 * (+$('#g-f').value || 0);
  $('#g-hint').textContent = `Els macros sumen ≈ ${r0(k)} kcal (4/4/9 kcal per gram).`;
}
['g-p', 'g-c', 'g-f'].forEach(id => $('#' + id).addEventListener('input', updateGoalHint));
$('#goals-form').addEventListener('submit', ev => {
  ev.preventDefault();
  S.goals = { kcal: +$('#g-kcal').value, p: +$('#g-p').value, c: +$('#g-c').value, f: +$('#g-f').value };
  save(); renderHome(); renderHistory(); toast('Objectius desats');
});
$('#export-btn').onclick = () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `nutritrack-${todayISO()}.json`; a.click();
};
$('#import-input').addEventListener('change', async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.entries)) throw 0;
    S = { ...structuredClone(DEFAULTS), ...d }; save(); renderProfile(); toast('Còpia importada (les fotos no s\'inclouen)');
  } catch { toast('Fitxer no vàlid'); }
  ev.target.value = '';
});
$('#wipe-btn').onclick = async () => {
  if (!confirm('Això esborrarà TOTES les dades d\'aquest dispositiu. Continuar?')) return;
  S = structuredClone(DEFAULTS); save();
  try { const db = await idb(); db.close(); indexedDB.deleteDatabase('nutritrack-photos'); } catch {}
  urlCache.clear(); renderProfile(); toast('Dades esborrades');
};

/* ---------- Full d'afegir / editar ---------- */
const F = id => $('#' + id);
const A = { items: [], meal: 'dinar' };                 // estat de l'assistent
const macrosText = n => `P ${r1(n.p)} · H ${r1(n.c)} · G ${r1(n.f)} g`;
const nutOf = it => { const k = (it.grams > 0 ? it.grams : 0) / 100; return { kcal: it.per100.kcal * k, p: it.per100.p * k, c: it.per100.c * k, f: it.per100.f * k }; };

function guessMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'esmorzar' : h < 16 ? 'dinar' : h < 19 ? 'snack' : 'sopar';
}
function updateChips() { $$('#meal-chips .chip').forEach(c => c.classList.toggle('active', c.dataset.meal === A.meal)); }
$('#meal-chips').addEventListener('click', ev => {
  const b = ev.target.closest('.chip'); if (!b) return;
  A.meal = b.dataset.meal; updateChips(); updateTotals();
});
const setMsg = t => { $('#a-msg').textContent = t || ''; };

function showPhoto(url) {
  F('f-photo-preview').hidden = !url; F('f-photo-remove').hidden = !url;
  F('a-photo-note').hidden = !url;
  if (url) { F('f-photo-preview').src = url; F('a-photo-preview').src = url; }
}
async function handlePhotoFile(file) {
  if (!file) return;
  try { pendingPhoto = await resizeImage(file); photoRemoved = false; showPhoto(URL.createObjectURL(pendingPhoto)); }
  catch { toast('No s\'ha pogut processar la foto'); }
}
F('a-photo').addEventListener('change', async ev => { await handlePhotoFile(ev.target.files[0]); ev.target.value = ''; });
F('f-photo').addEventListener('change', async ev => { await handlePhotoFile(ev.target.files[0]); ev.target.value = ''; });
const removePhoto = () => { pendingPhoto = null; photoRemoved = true; showPhoto(null); };
F('f-photo-remove').onclick = removePhoto;
F('a-photo-remove').onclick = removePhoto;

function resetAssist() {
  A.items = []; A.meal = guessMeal(); updateChips();
  F('a-text').value = ''; setMsg(''); renderAssist();
}

function openSheet(id = null) {
  editingId = id; pendingPhoto = null; photoRemoved = false;
  const e = id ? S.entries.find(x => x.id === id) : null;
  $('#sheet').classList.toggle('edit-mode', !!e);
  $('#sheet-title').textContent = e ? 'Edita aliment' : 'Afegeix menjar';
  F('delete-btn').hidden = !e;
  const per = e ? (e.per100 || (e.qty > 0 ? { kcal: e.kcal / e.qty * 100, p: e.p / e.qty * 100, c: e.c / e.qty * 100, f: e.f / e.qty * 100 } : { kcal: 0, p: 0, c: 0, f: 0 })) : null;
  F('f-meal').value = e ? e.meal : guessMeal();
  F('f-barcode').value = e?.barcode || '';
  F('f-name').value = e?.name || '';
  F('f-qty').value = e ? e.qty : 100;
  F('f-kcal').value = e ? r1(per.kcal) : '';
  F('f-p').value = e ? r1(per.p) : 0;
  F('f-c').value = e ? r1(per.c) : 0;
  F('f-f').value = e ? r1(per.f) : 0;
  F('lookup-msg').textContent = '';
  $('#manual-box').open = !!e;
  showPhoto(null);
  if (!e) resetAssist();
  if (e?.photo) getPhoto(e.id).then(b => b && showPhoto(URL.createObjectURL(b)));
  if (e) F('a-photo-note').hidden = true;
  updatePreview();
  $('#sheet-backdrop').hidden = false;
  $('#sheet').scrollTop = 0;
}
function closeSheet() { $('#sheet-backdrop').hidden = true; stopScan(); }
$('#fab').onclick = () => openSheet();
$('#sheet-close').onclick = closeSheet;
$('#sheet-backdrop').addEventListener('click', ev => { if (ev.target.id === 'sheet-backdrop') closeSheet(); });

/* ----- Assistent: calcular a partir d'una frase ----- */
function decorate(it) { it.picker = null; it.userGrams = it.qty && it.qty.kind === 'g'; it.manual = false; return it; }

async function calculate() {
  const text = F('a-text').value.trim();
  if (!text) { setMsg('Escriu què has menjat i les quantitats (per exemple: 200 g d\'arròs blanc cuit i 150 g de pollastre a la planxa).'); return; }
  const parsed = NT.parseText(text);
  if (!parsed.items.length) { setMsg('No he entès cap aliment. Prova amb frases com «150 g de coliflor» o «dos ous ferrats».'); return; }
  if (parsed.meal) { A.meal = parsed.meal; updateChips(); }
  const keep = A.items.filter(it => it.from === 'barcode');
  A.items = keep.concat(parsed.items.map(decorate));
  setMsg('');
  renderAssist();
  const missing = A.items.filter(it => it.noFood && !it.manual);
  const need = A.items.filter(it => blockers(it).length).length;
  setMsg(need ? `Revisa ${need} element${need > 1 ? 's' : ''} marcat${need > 1 ? 's' : ''} en taronja abans de desar.` : 'Ho he calculat. Revisa-ho i toca «Afegeix a l\'àpat».');
  for (const it of missing.slice(0, 4)) await autoOff(it);
  if ($('#sheet-backdrop').hidden === false) $('#a-results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
F('calc-btn').onclick = calculate;
F('a-text').addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); calculate(); } });

function blockers(it) {
  const b = [];
  if (it.noFood && !it.manual) b.push('Tria l\'aliment o escriu-ne els valors per 100 g');
  else if (it.needsConfirm && !it.ok) b.push(it.partial ? 'Confirma que l\'aliment és correcte' : 'Tria quin aliment és');
  if (!(it.grams > 0)) b.push('Indica quants grams');
  return b;
}
function srcLabel(it) {
  if (it.from === 'barcode') return `Codi ${it.barcode} · Open Food Facts`;
  if (it.noFood && !it.manual) return 'No trobat a la base d\'aliments';
  if (it.manual) return 'Valors escrits per tu';
  return it.source === 'off' ? 'Open Food Facts' : 'Base d\'aliments genèrics';
}
function itemHTML(it, i) {
  const n = nutOf(it), b = blockers(it);
  let chips = '';
  if (it.tied && it.tied.length > 1) {
    chips += `<div class="chip-row"><span>${it.tied.some(f => f.o.ask) ? 'Quin?' : 'Variant'}</span>${it.tied.map(f =>
      `<button type="button" class="chip ${it.food === f && (it.ok || !it.needsConfirm) ? 'active' : ''}" data-act="state" data-id="${f.id}">${esc(f.name)}</button>`).join('')}</div>`;
  }
  if (it.partial && !it.ok && it.food && !it.noFood) {
    chips += `<div class="confirm">Ho he entès com «${esc(it.name)}». <button type="button" class="chip" data-act="confirm">Sí, és correcte</button></div>`;
  }
  if (it.portions) {
    chips += `<div class="chip-row"><span>Ració</span>${it.portions.map(p =>
      `<button type="button" class="chip ${it.grams === p.g ? 'active' : ''}" data-act="portion" data-g="${p.g}" data-l="${esc(p.label)}">${esc(p.label)} · ${p.g} g</button>`).join('')}</div>`;
  }
  const p = it.per100;
  return `<div class="item ${b.length ? 'pending' : ''}" data-i="${i}">
    <div class="item-top"><div class="item-name"><b>${esc(it.name)}</b><small>${esc(srcLabel(it))}</small></div>
      <button type="button" class="link" data-act="change">Canvia</button>
      <button type="button" class="x" data-act="remove" aria-label="Elimina">✕</button></div>
    <div class="item-mid">
      <div class="qty"><button type="button" data-act="minus" aria-label="Menys">−</button>
        <input type="text" inputmode="decimal" data-act="grams" value="${it.grams > 0 ? it.grams : ''}" placeholder="grams" aria-label="Grams"><span>g</span>
        <button type="button" data-act="plus" aria-label="Més">+</button></div>
      <div class="item-kcal"><b data-k="kcal">${r0(n.kcal)}</b> kcal<small data-k="macros">${macrosText(n)}</small></div></div>
    <div class="flag" data-k="flag">${esc(b[0] || '')}</div>
    <div class="note ${it.est ? 'est' : ''}" data-k="note">${esc(it.note || '')}</div>
    ${chips}
    ${it.picker ? pickerHTML(it, i) : ''}
    <details class="per100" ${it.noFood && !it.manual ? 'open' : ''}><summary>Valors per 100 g (editable)</summary>
      <div class="grid4">
        ${[['kcal', 'kcal'], ['p', 'Prot.'], ['c', 'Hidr.'], ['f', 'Greix']].map(([k, l]) =>
          `<label>${l}<input type="text" inputmode="decimal" data-act="p100" data-f="${k}" value="${p[k]}"></label>`).join('')}
      </div></details>
  </div>`;
}
function pickerHTML(it, i) {
  return `<div class="picker"><input type="search" data-act="pk-q" value="${esc(it.picker.q)}" placeholder="Cerca un aliment…" enterkeyhint="search">
    <div class="pk-res" id="pk-res-${i}">${pickerResults(it)}</div>
    <div class="row end"><button type="button" class="btn small" data-act="pk-off">Cercar a Open Food Facts</button>
      <button type="button" class="btn small" data-act="pk-close">Tanca</button></div>
    <small class="hint" data-k="pk-status">${esc(it.picker.status || '')}</small></div>`;
}
const per100Text = f => `${r0(f.per100.kcal)} kcal · P ${r1(f.per100.p)} · H ${r1(f.per100.c)} · G ${r1(f.per100.f)} per 100 g`;
function pickerResults(it) {
  const pk = it.picker; let h = '';
  if (pk.local.length) h += '<div class="pk-tag">Base d\'aliments genèrics</div>' + pk.local.map((f, k) =>
    `<button type="button" class="res" data-act="pick" data-s="local" data-n="${k}"><b>${esc(f.name)}</b><small>${per100Text(f)}</small></button>`).join('');
  if (pk.off.length) h += '<div class="pk-tag">Open Food Facts</div>' + pk.off.map((f, k) =>
    `<button type="button" class="res" data-act="pick" data-s="off" data-n="${k}"><b>${esc(f.name)}</b><small>${per100Text(f)}</small></button>`).join('');
  return h || '<p class="empty">Cap resultat local. Prova «Cercar a Open Food Facts».</p>';
}
function renderAssist() {
  $('#a-results').innerHTML = A.items.map(itemHTML).join('');
  updateTotals();
}
function updateTotals() {
  const box = $('#a-totals'), btn = F('a-save'), blk = F('a-block');
  if (!A.items.length) { box.hidden = true; btn.disabled = true; btn.textContent = 'Afegeix a l\'àpat'; blk.textContent = ''; return; }
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  A.items.forEach(it => { const n = nutOf(it); t.kcal += n.kcal; t.p += n.p; t.c += n.c; t.f += n.f; });
  const blocked = A.items.filter(it => blockers(it).length).length;
  const left = S.goals.kcal - sum(dayEntries(currentDate), 'kcal') - t.kcal;
  const when = currentDate === todayISO() ? 'avui' : 'aquell dia';
  box.innerHTML = `<div class="tot-main"><b>${r0(t.kcal)}</b> kcal</div>
    <div class="tot-macros"><span>Prot. ${r1(t.p)} g</span><span>Hidr. ${r1(t.c)} g</span><span>Greix ${r1(t.f)} g</span></div>
    <small>${left >= 0 ? `Et quedarien ${r0(left)} kcal ${when}` : `Superaries l'objectiu per ${r0(-left)} kcal`} · valors orientatius</small>`;
  box.hidden = false;
  btn.disabled = blocked > 0;
  btn.textContent = `Afegeix ${A.items.length} aliment${A.items.length > 1 ? 's' : ''} a ${MEALS[A.meal]}`;
  blk.textContent = blocked ? `Falta completar ${blocked} element${blocked > 1 ? 's' : ''} (en taronja)` : (A.items.some(it => it.est) ? 'Inclou quantitats aproximades: pots corregir-les' : '');
}
function updateLive(i) {
  const it = A.items[i], card = $(`.item[data-i="${i}"]`); if (!it || !card) return;
  const n = nutOf(it), b = blockers(it);
  card.querySelector('[data-k="kcal"]').textContent = r0(n.kcal);
  card.querySelector('[data-k="macros"]').textContent = macrosText(n);
  card.classList.toggle('pending', b.length > 0);
  card.querySelector('[data-k="flag"]').textContent = b[0] || '';
  const note = card.querySelector('[data-k="note"]'); note.textContent = it.note || ''; note.classList.toggle('est', !!it.est);
  card.querySelectorAll('[data-act="portion"]').forEach(x => x.classList.toggle('active', +x.dataset.g === it.grams));
  updateTotals();
}
const parseNum = v => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : Math.max(0, n); };

function setGrams(it, g, keepNote) {
  it.grams = g > 0 ? g : null; it.qty = { kind: 'g', value: g }; it.userGrams = true; it.est = false; if (!keepNote) it.note = '';
}
$('#a-results').addEventListener('input', ev => {
  const el = ev.target, card = el.closest('.item'); if (!card) return;
  const i = +card.dataset.i, it = A.items[i], act = el.dataset.act; if (!it) return;
  if (act === 'grams') { setGrams(it, parseNum(el.value)); updateLive(i); }
  else if (act === 'p100') { it.per100[el.dataset.f] = parseNum(el.value); if (it.noFood) it.manual = true; updateLive(i); }
  else if (act === 'pk-q') { it.picker.q = el.value; it.picker.local = NT.searchLocal(el.value, 8); $(`#pk-res-${i}`).innerHTML = pickerResults(it); }
});
$('#a-results').addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.dataset.act === 'pk-q') { ev.preventDefault(); runOff(A.items[+ev.target.closest('.item').dataset.i]); }
  else if (ev.key === 'Enter' && ev.target.dataset.act === 'grams') { ev.preventDefault(); ev.target.blur(); }
});
$('#a-results').addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT') return;
  const card = el.closest('.item'); if (!card) return;
  const i = +card.dataset.i, it = A.items[i]; if (!it) return;
  switch (el.dataset.act) {
    case 'remove': A.items.splice(i, 1); renderAssist(); break;
    case 'minus': case 'plus': {
      const g = it.grams || 0, step = g >= 100 ? 10 : 5;
      setGrams(it, Math.max(0, r1(g + (el.dataset.act === 'plus' ? step : -step)))); renderAssist(); break;
    }
    case 'state': { const f = it.tied.find(x => x.id === el.dataset.id); if (f) { NT.setFood(it, f); renderAssist(); } break; }
    case 'confirm': it.ok = true; renderAssist(); break;
    case 'portion': { const g = +el.dataset.g; setGrams(it, g, true); it.est = true; it.note = `Ració ${el.dataset.l.toLowerCase()}: ${g} g — aproximat`; renderAssist(); break; }
    case 'change': it.picker = { q: it.phrase || it.name, local: NT.searchLocal(it.phrase || it.name, 8), off: [], status: '' }; renderAssist(); card.querySelector('[data-act="pk-q"]')?.focus(); break;
    case 'pk-close': it.picker = null; renderAssist(); break;
    case 'pk-off': runOff(it); break;
    case 'pick': {
      const f = (el.dataset.s === 'off' ? it.picker.off : it.picker.local)[+el.dataset.n]; if (!f) break;
      NT.setFood(it, f); it.picker = null; it.partial = false; it.needsConfirm = false; it.manual = false;
      if (f.source === 'off' && !f.hasEnergy) it.noFood = true;
      renderAssist(); break;
    }
  }
});

/* ----- Open Food Facts: cerca per text ----- */
async function runOff(it) {
  if (!it || !it.picker) return;
  const q = (it.picker.q || '').trim(); if (!q) return;
  it.picker.status = 'Cercant a Open Food Facts…'; refreshPicker(it);
  if (navigator.onLine === false) { it.picker.status = 'Sense connexió. Pots escriure els valors per 100 g a sota.'; refreshPicker(it); return; }
  try {
    it.picker.off = await NT.offSearch(q);
    it.picker.status = it.picker.off.length ? 'Resultats d\'Open Food Facts (dades de la comunitat: comprova-les).' : 'Cap resultat a Open Food Facts. Prova una altra paraula o escriu els valors per 100 g.';
  } catch { it.picker.status = 'No s\'ha pogut connectar amb Open Food Facts. Pots escriure els valors per 100 g a sota.'; }
  refreshPicker(it);
}
function refreshPicker(it) {
  const i = A.items.indexOf(it); if (i < 0 || !it.picker) return;
  const res = $(`#pk-res-${i}`); if (res) res.innerHTML = pickerResults(it);
  const st = $(`.item[data-i="${i}"] [data-k="pk-status"]`); if (st) st.textContent = it.picker.status || '';
}
async function autoOff(it) {
  const q = it.phrase || it.name;
  it.picker = { q, local: NT.searchLocal(q, 8), off: [], status: '' };
  renderAssist();
  await runOff(it);
}

/* ----- Desar el resultat de l'assistent ----- */
F('a-save').onclick = async () => {
  if (!A.items.length || A.items.some(it => blockers(it).length)) return;
  const btn = F('a-save'); btn.disabled = true;
  let total = 0;
  for (const it of A.items) {
    const k = it.grams / 100;
    const e = {
      id: uid(), date: currentDate, photo: false, meal: A.meal, name: it.name, barcode: it.barcode || '',
      qty: it.grams, kcal: it.per100.kcal * k, p: it.per100.p * k, c: it.per100.c * k, f: it.per100.f * k,
      per100: { kcal: it.per100.kcal, p: it.per100.p, c: it.per100.c, f: it.per100.f },
    };
    if (pendingPhoto) { try { await putPhoto(e.id, pendingPhoto); e.photo = true; } catch { /* sense foto */ } }
    S.entries.push(e); total += e.kcal;
  }
  save();
  const n = A.items.length;
  closeSheet(); showView(currentTabIsHistory() ? 'history' : 'home');
  toast(`${n} aliment${n > 1 ? 's' : ''} afegit${n > 1 ? 's' : ''} · ${r0(total)} kcal`);
};

/* ----- Formulari manual / edició (funcionalitat original) ----- */
function calc() {
  const q = +F('f-qty').value || 0, k = q / 100;
  return { qty: q, kcal: (+F('f-kcal').value || 0) * k, p: (+F('f-p').value || 0) * k, c: (+F('f-c').value || 0) * k, f: (+F('f-f').value || 0) * k };
}
function updatePreview() {
  const t = calc();
  F('f-preview').innerHTML = `${r0(t.kcal)} kcal<small>P ${r1(t.p)} g · H ${r1(t.c)} g · G ${r1(t.f)} g</small>`;
}
['f-qty', 'f-kcal', 'f-p', 'f-c', 'f-f'].forEach(id => F(id).addEventListener('input', updatePreview));

$('#food-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const t = calc();
  const base = {
    meal: F('f-meal').value, name: F('f-name').value.trim(), barcode: F('f-barcode').value.trim(),
    qty: t.qty, kcal: t.kcal, p: t.p, c: t.c, f: t.f,
    per100: { kcal: +F('f-kcal').value || 0, p: +F('f-p').value || 0, c: +F('f-c').value || 0, f: +F('f-f').value || 0 },
  };
  let entry;
  if (editingId) { entry = S.entries.find(x => x.id === editingId); Object.assign(entry, base); }
  else { entry = { id: uid(), date: currentDate, photo: false, ...base }; S.entries.push(entry); }
  try {
    if (pendingPhoto) { await putPhoto(entry.id, pendingPhoto); entry.photo = true; urlCache.delete(entry.id); }
    else if (photoRemoved && entry.photo) { await delPhoto(entry.id); entry.photo = false; urlCache.delete(entry.id); }
  } catch { toast('No s\'ha pogut desar la foto'); }
  save(); closeSheet(); showView(currentTabIsHistory() ? 'history' : 'home'); toast('Desat');
});
const currentTabIsHistory = () => $('#view-history').classList.contains('active');
$('#delete-btn').onclick = async () => {
  if (!confirm('Eliminar aquest aliment?')) return;
  const e = S.entries.find(x => x.id === editingId);
  if (e?.photo) { try { await delPhoto(e.id); } catch {} urlCache.delete(e.id); }
  S.entries = S.entries.filter(x => x.id !== editingId);
  save(); closeSheet(); renderHome(); renderHistory();
};

/* ---------- Codis de barres ---------- */
async function lookupBarcode(code) {              // formulari manual
  const msg = F('lookup-msg');
  code = (code || '').replace(/\D/g, '');
  if (!code) { msg.textContent = 'Introdueix un codi de barres.'; return; }
  msg.textContent = 'Cercant…';
  try {
    const p = await NT.offProduct(code);
    if (!p) { msg.textContent = 'Producte no trobat. Pots introduir-lo manualment.'; return; }
    F('f-barcode').value = code;
    F('f-name').value = p.name;
    if (p.hasEnergy) F('f-kcal').value = p.per100.kcal;
    F('f-p').value = p.per100.p; F('f-c').value = p.per100.c; F('f-f').value = p.per100.f;
    updatePreview();
    msg.textContent = p.hasEnergy ? 'Producte trobat (valors per 100 g). Ajusta la quantitat.' : 'Trobat, però sense calories: completa-les a mà.';
  } catch { msg.textContent = 'No s\'ha pogut connectar. Cal Internet per cercar codis.'; }
}
$('#lookup-btn').onclick = () => lookupBarcode(F('f-barcode').value);

async function addBarcodeItem(code) {             // assistent
  setMsg(`Cercant el codi ${code} a Open Food Facts…`);
  try {
    const p = await NT.offProduct(code);
    if (!p) { setMsg(`El codi ${code} no és a Open Food Facts. Descriu l'aliment a la caixa de text.`); return; }
    const it = decorate({
      from: 'barcode', barcode: code, food: p, name: p.name, per100: { ...p.per100 }, source: 'off', ok: true, needsConfirm: false,
      partial: false, tied: [], noFood: !p.hasEnergy, qty: { kind: 'none' }, grams: null, est: false, note: 'Indica quants grams n\'has menjat.', portions: null,
    });
    A.items.push(it); renderAssist();
    setMsg(p.hasEnergy ? 'Producte trobat. Indica quants grams n\'has menjat (valors per 100 g de l\'etiqueta).' : 'Producte trobat, però sense dades nutricionals: escriu-les a «Valors per 100 g».');
    const inp = $(`.item[data-i="${A.items.length - 1}"] [data-act="grams"]`);
    if (inp) { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); inp.focus(); }
  } catch { setMsg('No s\'ha pogut connectar amb Open Food Facts (cal Internet). Torna-ho a provar.'); }
}

let scanCtx = 'assist', scanStream = null, scanning = false, lastCode = null, lastCount = 0, missCount = 0, lastTick = 0;
const scanCanvas = document.createElement('canvas');
const scanMsg = t => { $('#scan-msg').textContent = t; };
function openScanner(ctx) {
  scanCtx = ctx; $('#scanner').hidden = false; F('scan-code').value = '';
  scanMsg('Obrint la càmera…'); startCamera();
}
async function startCamera() {
  const v = $('#scan-video');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    scanMsg('Aquí no es pot obrir la càmera en directe (cal HTTPS). Fes servir «Foto del codi» o escriu-lo.'); return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    v.setAttribute('playsinline', ''); v.muted = true; v.srcObject = scanStream;
    await v.play();
    scanning = true; lastCode = null; lastCount = 0; missCount = 0;
    scanMsg('Apunta al codi de barres i mantén el mòbil quiet'); scanLoop();
  } catch (err) {
    scanMsg(err && err.name === 'NotAllowedError'
      ? 'Permís de càmera denegat. Activa\'l a Ajustos › Safari › Càmera, o fes servir «Foto del codi».'
      : `No s'ha pogut obrir la càmera (${err && err.name}). Prova «Foto del codi» o escriu el codi.`);
  }
}
function scanLoop() {
  if (!scanning) return;
  const v = $('#scan-video'), now = performance.now();
  if (now - lastTick >= 110 && v.readyState >= 2 && v.videoWidth) {
    lastTick = now;
    const k = Math.min(1, 960 / v.videoWidth);
    scanCanvas.width = Math.round(v.videoWidth * k); scanCanvas.height = Math.round(v.videoHeight * k);
    const cx = scanCanvas.getContext('2d', { willReadFrequently: true });
    cx.drawImage(v, 0, 0, scanCanvas.width, scanCanvas.height);
    const r = NTBarcode.decodeImageData(cx.getImageData(0, 0, scanCanvas.width, scanCanvas.height), false);
    if (r) {
      missCount = 0;
      if (r.text === lastCode) lastCount++; else { lastCode = r.text; lastCount = 1; }
      if (lastCount >= 2) { onBarcode(r.text); return; }          // dues lectures iguals seguides: evita falsos positius
    } else if (++missCount > 8) { lastCode = null; lastCount = 0; }
  }
  requestAnimationFrame(scanLoop);
}
function stopScan() {
  scanning = false;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  const v = $('#scan-video'); if (v) v.srcObject = null;
  $('#scanner').hidden = true;
}
function onBarcode(code) {
  stopScan();
  if (scanCtx === 'form') { F('f-barcode').value = code; lookupBarcode(code); }
  else addBarcodeItem(code);
}
$('#a-scan-btn').onclick = () => openScanner('assist');
$('#scan-btn').onclick = () => openScanner('form');
$('#scan-close').onclick = stopScan;
$('#scan-go').onclick = () => {
  const c = F('scan-code').value.replace(/\D/g, '');
  if (c.length < 8 || c.length > 14) { scanMsg('Un codi EAN/UPC té entre 8 i 14 xifres.'); return; }
  onBarcode(c);
};
F('scan-code').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); $('#scan-go').click(); } });
F('scan-photo').addEventListener('change', async ev => {
  const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
  scanMsg('Llegint el codi de la foto…');
  await new Promise(r => setTimeout(r, 40));
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0, c.width, c.height);
    const r = NTBarcode.decodeImageData(cx.getImageData(0, 0, c.width, c.height), true);
    if (r) onBarcode(r.text);
    else scanMsg('No he pogut llegir el codi de la foto. Acosta\'t, enfoca bé, evita reflexos o escriu el codi.');
  } catch { scanMsg('No s\'ha pogut obrir la foto.'); }
});

/* ---------- Inici ---------- */
showView('home');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
