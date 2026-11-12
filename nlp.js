/* NutriTrack — analitzador de frases, cerca d'aliments i accés a Open Food Facts.
   Funciona al navegador i a Node (per a les proves). Depèn de foods.js. */
(function (root) {
  'use strict';
  const RAW = root.NT_FOODS_RAW || [];

  /* ---------- Normalització ---------- */
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/·/g, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, ' ').replace(/[^a-z0-9.,;+\/ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const STOP = new Set(['de', 'del', 'dels', 'd', 'la', 'el', 'l', 'les', 'els', 'a', 'al', 'en', 'amb', 'un', 'una', 'uns', 'unes', 'i', 'y', 'con']);
  const stem = t => (t.length >= 5 ? t.replace(/(es|s|a|e)$/, '') : t.length >= 4 ? t.replace(/s$/, '') : t);
  const content = toks => toks.filter(t => !STOP.has(t)).map(stem);
  const tok = s => norm(s).split(' ').filter(Boolean);
  const round1 = n => Math.round(n * 10) / 10;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- Base d'aliments ---------- */
  const FOODS = RAW.map(r => {
    const aliases = r[2].split('|').map(a => norm(a)).filter(Boolean);
    const o = r[7] || {};
    return {
      id: r[0], name: r[1], per100: { kcal: r[3], p: r[4], c: r[5], f: r[6] }, o, source: 'local',
      aliasToks: aliases.concat([norm(r[1])]).map(a => content(a.split(' '))).filter(a => a.length),
    };
  });
  const PROTECT = [...new Set(RAW.flatMap(r => r[2].split('|')).map(norm).filter(a => / i /.test(a)))];

  /* ---------- Coincidència ---------- */
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  function contains(big, small) {
    if (!small.length || small.length > big.length) return false;
    for (let i = 0; i + small.length <= big.length; i++) {
      let ok = true;
      for (let j = 0; j < small.length; j++) if (big[i + j] !== small[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }
  const similar = (t, u) => t === u || (t.length >= 3 && u.length >= 3 && (t.startsWith(u) || u.startsWith(t)));
  function scoreAlias(p, a) {
    if (!a.length || !p.length) return { score: 0 };
    if (eq(p, a)) return { score: 1000, partial: false };
    if (contains(p, a)) return { score: 500 + a.length * 10 - (p.length - a.length), partial: true };
    if (contains(a, p)) return { score: 300 + p.length * 10 - (a.length - p.length), partial: true };
    const shared = p.filter(t => a.some(u => similar(t, u))).length;
    const ratio = shared / Math.max(p.length, a.length);
    if (shared >= 1 && ratio >= 0.5) return { score: 100 * ratio, partial: true };
    return { score: 0 };
  }
  function rank(phrase) {
    const p = content(tok(phrase));
    if (!p.length) return [];
    const out = [];
    for (const f of FOODS) {
      let best = { score: 0 };
      for (const a of f.aliasToks) { const s = scoreAlias(p, a); if (s.score > best.score) best = s; }
      if (best.score >= 50) out.push({ food: f, score: best.score, partial: best.partial });
    }
    return out.sort((x, y) => y.score - x.score || (y.food.o.def ? 1 : 0) - (x.food.o.def ? 1 : 0));
  }
  function searchLocal(q, n = 8) { return rank(q).slice(0, n).map(x => x.food); }

  /* ---------- Quantitats ---------- */
  const NUMW = { un: 1, una: 1, uns: 1, unes: 1, uno: 1, dos: 2, dues: 2, tres: 3, quatre: 4, cuatro: 4, cinc: 5, cinco: 5, sis: 6, seis: 6, set: 7, siete: 7, vuit: 8, ocho: 8, nou: 9, nueve: 9, deu: 10, diez: 10, mig: 0.5, mitja: 0.5, mitg: 0.5, medio: 0.5, media: 0.5 };
  const MEAS = {
    plat: 'plat', plats: 'plat', bol: 'plat', bols: 'plat', platet: 'plat',
    cullerada: 'cullerada', cullerades: 'cullerada', culleradeta: 'culleradeta', culleradetes: 'culleradeta',
    got: 'got', gots: 'got', vas: 'got', vasos: 'got', tassa: 'tassa', tasses: 'tassa', taza: 'tassa', tazas: 'tassa',
    copa: 'copa', copes: 'copa', copas: 'copa', llesca: 'llesca', llesques: 'llesca', rebanada: 'llesca', rebanadas: 'llesca',
    rodanxa: 'rodanxa', rodanxes: 'rodanxa', rodaja: 'rodanxa', rodajas: 'rodanxa', tros: 'tros', trossos: 'tros', trozo: 'tros', trozos: 'tros',
    grapat: 'grapat', grapats: 'grapat', punyat: 'grapat', punyats: 'grapat',
    porcio: 'porcio', porcions: 'porcio', racio: 'porcio', racions: 'porcio', porcion: 'porcio', raciones: 'porcio',
    bola: 'bola', boles: 'bola', quadrat: 'quadrat', quadrats: 'quadrat', quadradet: 'quadradet', quadradets: 'quadradet', onsa: 'onsa', onses: 'onsa',
    scoop: 'scoop', scoops: 'scoop', mesura: 'mesura', mesures: 'mesura', llauna: 'llauna', llaunes: 'llauna',
    bossa: 'bossa', bosses: 'bossa', sobre: 'sobre', sobres: 'sobre', canya: 'canya', canyes: 'canya', tercio: 'tercio', tercios: 'tercio',
    unitat: 'unitat', unitats: 'unitat', peca: 'unitat', peces: 'unitat',
  };
  const NUMWORDS = Object.keys(NUMW).sort((a, b) => b.length - a.length).join('|');
  const NUMRE = '(?:\\d+(?:\\.\\d+)?|\\d+\\/\\d+|' + NUMWORDS + ')';
  const MEASRE = Object.keys(MEAS).sort((a, b) => b.length - a.length).join('|');
  const toNum = t => {
    if (NUMW[t] != null) return NUMW[t];
    if (t.includes('/')) { const [a, b] = t.split('/'); return +a / +b; }
    return parseFloat(t);
  };
  const RE_G = /(?:^|\s)(\d+(?:\.\d+)?)\s*(kg|kgs|kilos?|quilos?|kilograms?|g|gr|grs|grams?|gramos?)(?=\s|$)/;
  const RE_ML = /(?:^|\s)(\d+(?:\.\d+)?)\s*(ml|cl|dl|l|lt|litres?|litros?)(?=\s|$)/;
  const RE_MEAS = new RegExp('^(?:(' + NUMRE + ')\\s+)?(' + MEASRE + ')\\s+(?:(?:de|del|d)\\s+)?(.+)$');
  const RE_COUNT = new RegExp('^(' + NUMRE + ')\\s+(.+)$');
  const cleanPhrase = s => {
    s = s.replace(/[.,;]+$/g, '').replace(/^[.,;\s]+/, '').trim();
    let prev;
    do { prev = s; s = s.replace(/^(?:de|del|dels|d|la|el|l|les|els|uns|unes|un|una)\s+/, ''); } while (s !== prev);
    return s.trim();
  };

  function extractQty(seg) {
    let m = seg.match(RE_G);
    if (m) {
      const u = m[2]; const v = parseFloat(m[1]) * (/^k|^quil/.test(u) ? 1000 : 1);
      return { qty: { kind: 'g', value: v }, phrase: cleanPhrase(seg.replace(m[0], ' ')) };
    }
    m = seg.match(RE_ML);
    if (m) {
      const u = m[2]; const mult = u === 'cl' ? 10 : u === 'dl' ? 100 : /^l/.test(u) ? 1000 : 1;
      return { qty: { kind: 'ml', value: parseFloat(m[1]) * mult }, phrase: cleanPhrase(seg.replace(m[0], ' ')) };
    }
    m = seg.match(RE_MEAS);
    if (m) {
      const key = MEAS[m[2]];
      const n = m[1] ? toNum(m[1]) : 1;
      return { qty: key === 'unitat' ? { kind: 'count', n } : { kind: 'measure', n, key }, phrase: cleanPhrase(m[3]) };
    }
    m = seg.match(RE_COUNT);
    if (m && cleanPhrase(m[2])) {
      const n = toNum(m[1]);
      if (n > 0 && n <= 30) return { qty: { kind: 'count', n }, phrase: cleanPhrase(m[2]) };
      return { qty: { kind: 'none' }, phrase: cleanPhrase(m[2]) };      // «100 pa»: sense unitat → cal preguntar
    }
    return { qty: { kind: 'none' }, phrase: cleanPhrase(seg) };
  }

  const fmt = n => String(round1(n)).replace('.', ',');
  const PORTION_LABELS = ['Petita', 'Mitjana', 'Gran'];
  /* Calcula els grams a partir de la quantitat dita i l'aliment triat. */
  function applyQty(it) {
    const q = it.qty || { kind: 'none' }, f = it.food;
    it.grams = null; it.est = false; it.note = ''; it.portions = null;
    const portions = (mult = 1) => {
      if (f && f.o.por) it.portions = f.o.por.map((g, i) => ({ label: PORTION_LABELS[i], g: Math.round(g * mult) }));
      else if (f && f.o.pc) it.portions = [{ label: '1 ' + (f.o.pcn || 'unitat'), g: f.o.pc }];
    };
    if (q.kind === 'g') { it.grams = q.value; return it; }
    if (q.kind === 'ml') {
      const den = (f && f.o.den) || 1;
      it.grams = round1(q.value * den);
      if (den !== 1) it.note = `${fmt(q.value)} ml ≈ ${fmt(it.grams)} g`;
      return it;
    }
    if (!f) return it;
    if (q.kind === 'count') {
      if (f.o.pc) {
        it.grams = Math.round(q.n * f.o.pc); it.est = true;
        it.note = `${fmt(q.n)} × ${f.o.pc} g (${f.o.pcn || 'unitat'}) — pes aproximat`;
      } else { it.note = `No sé quant pesa «${f.name.toLowerCase()}» per unitat: indica els grams.`; portions(); }
      return it;
    }
    if (q.kind === 'measure') {
      const key = q.key;
      if (f.o.pcn && norm(f.o.pcn) === key && f.o.pc) {
        it.grams = Math.round(q.n * f.o.pc); it.est = true;
        it.note = `${fmt(q.n)} × ${f.o.pc} g (${f.o.pcn}) — pes aproximat`; return it;
      }
      const v = f.o.m && f.o.m[key];
      if (v) {
        it.grams = Math.round(q.n * v * 10) / 10; it.est = true;
        it.note = `${fmt(q.n)} × ${key} (≈ ${v} g cadascun) — aproximat`; return it;
      }
      it.note = (key === 'plat' || key === 'porcio')
        ? `Un ${key === 'plat' ? 'plat' : 'ració'} pot ser molt diferent segons la persona: tria una mida o escriu els grams.`
        : `No tinc el pes d'un/a ${key} d'aquest aliment: indica els grams.`;
      portions(q.n);
      return it;
    }
    it.note = 'No has indicat la quantitat: escriu els grams.';
    portions();
    return it;
  }

  /* ---------- Frases ---------- */
  const MEAL_RE = [
    ['esmorzar', /\b(esmorzar|esmorzat|desayun\w*)\b/], ['sopar', /\b(sopar|sopat|cenado|cena)\b/],
    ['snack', /\b(berenar|berenat|snack|merienda|merendado)\b/], ['dinar', /\b(dinar|dinat|comido|almuerzo|comida)\b/],
  ];
  const INTRO = /\b(?:(?:m|me)\s+)?(?:he|hem|has|ha)\s+(?:menjat|dinat|sopat|esmorzat|berenat|pres|begut|tingut|comido|cenado|desayunado|merendado|tomado|bebido|picat)\b|\bper\s+(?:a\s+)?(?:esmorzar|dinar|sopar|berenar|snack)\b|\bde\s+berenar\b|\b(?:avui|ara|hoy)\b/g;

  function splitSegments(text) {
    let s = norm(text).replace(/(\d),(\d)/g, '$1.$2');
    for (const a of PROTECT) s = s.split(' ' + a + ' ').join(' ' + a.replace(/ i /g, ' \u0001 ') + ' ');
    s = s.replace(/[,;+]/g, '|')
      .replace(/\s+(?:i|y|e|and)\s+/g, '|')
      .replace(new RegExp('\\s+(?:amb|con)\\s+(?=' + NUMRE + '(?:\\s|$))', 'g'), '|');
    return s.split('|').map(x => x.replace(/\u0001/g, 'i').trim()).filter(Boolean);
  }

  function resolveSegment(seg) {
    const { qty, phrase } = extractQty(seg);
    if (!phrase || !content(tok(phrase)).length) return null;
    const list = rank(phrase);
    const it = { raw: seg, phrase, qty, ok: false, source: 'local', from: 'text', tied: [], partial: false, needsConfirm: false, noFood: false };
    if (!list.length) {
      it.food = null; it.noFood = true; it.name = cap(phrase); it.per100 = { kcal: 0, p: 0, c: 0, f: 0 };
      applyQty(it); return it;
    }
    const top = list[0];
    it.food = top.food; it.name = top.food.name; it.per100 = { ...top.food.per100 };
    it.partial = top.partial;
    if (top.partial) it.needsConfirm = true;
    else {
      it.tied = list.filter(x => x.score === top.score && !x.partial).map(x => x.food);
      if (it.tied.length > 1 && it.tied.some(f => f.o.ask)) it.needsConfirm = true;
      if (it.tied.length < 2) it.tied = [];
    }
    applyQty(it);
    return it;
  }

  function parseText(text) {
    const t0 = norm(text);
    let meal = null;
    for (const [k, re] of MEAL_RE) if (re.test(t0)) { meal = k; break; }
    const cleaned = norm(text).replace(INTRO, ' ').replace(/\b(esmorzar|dinar|sopar|berenar)\b/g, ' ');
    const items = splitSegments(cleaned).map(resolveSegment).filter(Boolean);
    return { meal, items };
  }

  /* Substitueix l'aliment d'un element (mantenint la quantitat) */
  function setFood(it, food) {
    it.food = food; it.name = food.name; it.per100 = { ...food.per100 }; it.source = food.source || 'local';
    it.noFood = false; it.ok = true; it.tied = it.tied && it.tied.includes(food) ? it.tied : [];
    if (it.qty && it.qty.kind !== 'g' && !it.userGrams) applyQty(it);
    return it;
  }

  /* ---------- Open Food Facts (gratuït, sense clau) ---------- */
  const num = v => (v == null || v === '' || isNaN(+v) ? null : +v);
  function mapOFF(p) {
    const n = p.nutriments || {};
    let kcal = num(n['energy-kcal_100g']);
    if (kcal == null && num(n['energy-kcal']) != null) kcal = num(n['energy-kcal']);
    if (kcal == null && num(n['energy_100g']) != null) kcal = num(n['energy_100g']) / 4.184;
    if (kcal == null && num(n['energy-kj_100g']) != null) kcal = num(n['energy-kj_100g']) / 4.184;
    const name = [p.product_name || p.generic_name, p.brands && String(p.brands).split(',')[0]].filter(Boolean).join(' · ');
    return {
      id: 'off:' + (p.code || name), name: name || 'Producte sense nom', code: p.code || '', source: 'off', o: {},
      hasEnergy: kcal != null,
      per100: { kcal: round1(kcal || 0), p: round1(num(n.proteins_100g) || 0), c: round1(num(n.carbohydrates_100g) || 0), f: round1(num(n.fat_100g) || 0) },
    };
  }
  async function fetchJSON(url, ms = 12000) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { if (timer) clearTimeout(timer); }
  }
  async function offSearch(q) {
    const e = encodeURIComponent(q);
    const urls = [
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${e}&search_simple=1&action=process&json=1&page_size=12&fields=code,product_name,generic_name,brands,nutriments`,
      `https://search.openfoodfacts.org/search?q=${e}&page_size=12&fields=code,product_name,brands,nutriments`,
    ];
    let lastErr = null;
    for (const u of urls) {
      try {
        const d = await fetchJSON(u);
        const arr = d.products || d.hits || [];
        const out = arr.map(mapOFF).filter(x => x.hasEnergy && x.name !== 'Producte sense nom');
        if (out.length) return out;
      } catch (err) { lastErr = err; }
    }
    if (lastErr) throw lastErr;
    return [];
  }
  async function offProduct(code) {
    const d = await fetchJSON(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,generic_name,brands,nutriments`);
    if (d.status !== 1 || !d.product) return null;
    d.product.code = d.product.code || code;
    return mapOFF(d.product);
  }

  const NT = { FOODS, norm, parseText, applyQty, setFood, searchLocal, rank, offSearch, offProduct, mapOFF, round1 };
  root.NT = NT;
  if (typeof module !== 'undefined' && module.exports) module.exports = NT;
})(typeof window !== 'undefined' ? window : globalThis);
