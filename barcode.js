/* NutriTrack — lector de codis de barres EAN-13 / EAN-8 / UPC-A.
   Decodificador propi en JavaScript pur (sense llibreries ni dependències): funciona a Safari
   (iPhone/iPad) perquè només necessita píxels d'un <canvas>, no l'API BarcodeDetector.
   Llegeix línies d'escaneig en diversos angles i desplaçaments, en tots dos sentits. */
(function (root) {
  'use strict';

  // Amplades de barres/espais (en mòduls) de cada xifra. L = codi A; G = L invertit; la meitat dreta usa L.
  const L = [[3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2], [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]];
  const G = L.map(p => p.slice().reverse());
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const MAX_AVG = 0.48, MAX_IND = 0.7;

  function variance(c, pat) {
    let total = 0, plen = 0;
    for (let i = 0; i < pat.length; i++) { total += c[i]; plen += pat[i]; }
    if (total < plen) return Infinity;
    const unit = total / plen, maxInd = MAX_IND * unit;
    let tv = 0;
    for (let i = 0; i < pat.length; i++) {
      const d = Math.abs(c[i] - pat[i] * unit);
      if (d > maxInd) return Infinity;
      tv += d;
    }
    return tv / total;
  }
  function matchDigit(c, allowG) {
    let best = -1, bv = MAX_AVG, type = 'L';
    for (let d = 0; d < 10; d++) {
      let v = variance(c, L[d]); if (v < bv) { bv = v; best = d; type = 'L'; }
      if (allowG) { v = variance(c, G[d]); if (v < bv) { bv = v; best = d; type = 'G'; } }
    }
    return best < 0 ? null : { d: best, type };
  }
  function checksumOK(digits) {                     // EAN-13 i EAN-8 (pesos alternats 3/1 des de la dreta)
    let s = 0;
    for (let i = digits.length - 2, w = 3; i >= 0; i--, w = 4 - w) s += digits[i] * w;
    return (10 - (s % 10)) % 10 === digits[digits.length - 1];
  }

  /* ---- Una línia de gris → binari (llindar local per blocs) → amplades de franges ---- */
  function binarize(line) {
    const n = line.length, B = 24, nb = Math.ceil(n / B);
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) sm[i] = ((line[i > 0 ? i - 1 : 0]) + 2 * line[i] + line[i < n - 1 ? i + 1 : n - 1]) / 4;
    const bmin = new Float32Array(nb).fill(255), bmax = new Float32Array(nb);
    for (let i = 0; i < n; i++) { const b = (i / B) | 0; if (sm[i] < bmin[b]) bmin[b] = sm[i]; if (sm[i] > bmax[b]) bmax[b] = sm[i]; }
    const bits = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const b = (i / B) | 0; let mn = 255, mx = 0;
      for (let k = Math.max(0, b - 3); k <= Math.min(nb - 1, b + 3); k++) { if (bmin[k] < mn) mn = bmin[k]; if (bmax[k] > mx) mx = bmax[k]; }
      bits[i] = (mx - mn >= 30 && sm[i] < (mn + mx) / 2) ? 1 : 0;
    }
    return bits;
  }
  function runsOf(bits) {
    const runs = []; let cur = bits[0], len = 1;
    for (let i = 1; i < bits.length; i++) { if (bits[i] === cur) len++; else { runs.push(len); cur = bits[i]; len = 1; } }
    runs.push(len);
    return { runs, firstBlack: bits[0] === 1 };
  }

  function tryAt(runs, i) {
    const unitOf = k => (runs[k] + runs[k + 1] + runs[k + 2]) / 3;
    if (i + 3 > runs.length) return null;
    const start = [runs[i], runs[i + 1], runs[i + 2]];
    if (variance(start, [1, 1, 1]) >= MAX_AVG) return null;
    const u = unitOf(i);
    if (i > 0 && runs[i - 1] < 2.5 * u) return null;                       // cal zona de silenci abans del codi
    const digit4 = (pos, allowG) => {
      const c = [runs[pos], runs[pos + 1], runs[pos + 2], runs[pos + 3]];
      const s = c[0] + c[1] + c[2] + c[3];
      if (Math.abs(s / 7 - u) > 0.4 * u) return null;
      return matchDigit(c, allowG);
    };
    const guard = (pos, pat) => variance(runs.slice(pos, pos + pat.length), pat) < MAX_AVG;
    const endQuiet = pos => runs[pos + 3] === undefined || runs[pos + 3] >= 2.5 * u;   // zona de silenci després del codi

    // EAN-13 / UPC-A: 3 + 24 + 5 + 24 + 3 = 59 franges
    if (i + 59 <= runs.length) {
      let pos = i + 3, ok = true; const left = [];
      for (let k = 0; k < 6 && ok; k++) { const r = digit4(pos, true); if (!r) ok = false; else { left.push(r); pos += 4; } }
      if (ok && guard(pos, [1, 1, 1, 1, 1])) {
        pos += 5; const right = [];
        for (let k = 0; k < 6 && ok; k++) { const r = digit4(pos, false); if (!r) ok = false; else { right.push(r.d); pos += 4; } }
        if (ok && guard(pos, [1, 1, 1]) && endQuiet(pos)) {
          const parity = left.map(x => x.type).join('');
          const first = PARITY.indexOf(parity);
          if (first >= 0) {
            const digits = [first, ...left.map(x => x.d), ...right];
            if (checksumOK(digits)) return { text: digits.join(''), format: first === 0 ? 'UPC-A' : 'EAN-13' };
          }
        }
      }
    }
    // EAN-8: 3 + 16 + 5 + 16 + 3 = 43 franges
    if (i + 43 <= runs.length) {
      let pos = i + 3, ok = true; const digits = [];
      for (let k = 0; k < 4 && ok; k++) { const r = digit4(pos, false); if (!r) ok = false; else { digits.push(r.d); pos += 4; } }
      if (ok && guard(pos, [1, 1, 1, 1, 1])) {
        pos += 5;
        for (let k = 0; k < 4 && ok; k++) { const r = digit4(pos, false); if (!r) ok = false; else { digits.push(r.d); pos += 4; } }
        if (ok && guard(pos, [1, 1, 1]) && endQuiet(pos) && checksumOK(digits)) return { text: digits.join(''), format: 'EAN-8' };
      }
    }
    return null;
  }

  function decodeLine(line) {
    for (let pass = 0; pass < 2; pass++) {
      const bits = binarize(pass ? Float32Array.from(line).reverse() : line);
      const { runs, firstBlack } = runsOf(bits);
      for (let i = 0; i < runs.length - 42; i++) {
        if ((firstBlack ? i % 2 === 0 : i % 2 === 1) === false) continue;       // l'inici ha de ser una barra
        const r = tryAt(runs, i);
        if (r) return r;
      }
    }
    return null;
  }

  /* ---- Mostreig de línies sobre una imatge de gris ---- */
  function sampleLine(gray, w, h, cx, cy, dx, dy) {
    // intersecció de la recta amb el rectangle [0,w-1]x[0,h-1]
    let tmin = -1e9, tmax = 1e9;
    if (Math.abs(dx) > 1e-9) { const a = (0 - cx) / dx, b = (w - 1 - cx) / dx; tmin = Math.max(tmin, Math.min(a, b)); tmax = Math.min(tmax, Math.max(a, b)); }
    if (Math.abs(dy) > 1e-9) { const a = (0 - cy) / dy, b = (h - 1 - cy) / dy; tmin = Math.max(tmin, Math.min(a, b)); tmax = Math.min(tmax, Math.max(a, b)); }
    const n = Math.floor(tmax - tmin);
    if (n < 60) return null;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = tmin + i;
      out[i] = gray[Math.round(cy + dy * t) * w + Math.round(cx + dx * t)];
    }
    return out;
  }

  function toGray(img) {
    const { data, width: w, height: h } = img, g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (77 * data[j] + 150 * data[j + 1] + 29 * data[j + 2]) >> 8;
    return { gray: g, w, h };
  }

  const FAST = { angles: [0, 90, 8, -8, 16, -16, 82, 98, 24, -24], offsets: [0, -0.12, 0.12, -0.24, 0.24, -0.36, 0.36] };
  const FULL = { angles: [0, 90, 5, -5, 10, -10, 15, -15, 20, -20, 30, -30, 80, 85, 95, 100, 70, 110, 45, -45, 60, 120], offsets: [] };
  for (let o = -0.45; o <= 0.451; o += 0.03) FULL.offsets.push(+o.toFixed(2));

  /* Decodifica un ImageData ({data,width,height}). thorough=true per a fotos fixes (més lent). */
  function decodeImageData(img, thorough) {
    const { gray, w, h } = toGray(img);
    const cfg = thorough ? FULL : FAST, span = Math.min(w, h);
    for (const off of cfg.offsets) {
      for (const ang of cfg.angles) {
        const a = ang * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
        const cx = w / 2 + (-dy) * off * span, cy = h / 2 + dx * off * span;     // desplaçament perpendicular a la línia
        if (cx < 0 || cy < 0 || cx > w - 1 || cy > h - 1) continue;
        const line = sampleLine(gray, w, h, cx, cy, dx, dy);
        if (!line) continue;
        const r = decodeLine(line);
        if (r) return r;
      }
    }
    return null;
  }

  const NTBarcode = { decodeImageData, decodeLine, checksumOK };
  root.NTBarcode = NTBarcode;
  if (typeof module !== 'undefined' && module.exports) module.exports = NTBarcode;
})(typeof window !== 'undefined' ? window : globalThis);
