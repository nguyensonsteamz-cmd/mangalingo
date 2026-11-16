// BLEU and chrF++ re-implemented from the published definitions (Papineni 2002; Popović 2017). They follow sacreBLEU's
// defaults (13a tokenisation, exponential smoothing, chrF++ = char n=1..6 + word n=1..2, beta=2) but are NOT byte-identical to
// sacreBLEU (Python could not be used on this machine: see docs/TRANSLATION_BENCHMARK_LAB.md). Compare systems only against
// each other under these functions.
const tok13a = (s) =>
  ' ' + s.replace(/<skipped>/g, '').replace(/-\n/g, '').replace(/\n/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') + ' ';
function tokenize13a(s) {
  s = tok13a(s);
  s = s.replace(/([\{-\~\[-\` -\&\(-\+\:-\@\/])/g, ' $1 ');
  s = s.replace(/([^0-9])([\.,])/g, '$1 $2 ').replace(/([\.,])([^0-9])/g, ' $1 $2').replace(/([0-9])(-)/g, '$1 $2 ');
  return s.split(/\s+/).filter(Boolean);
}
const ngrams = (toks, n) => {
  const m = new Map();
  for (let i = 0; i + n <= toks.length; i++) { const k = toks.slice(i, i + n).join('\u0001'); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
};

export function bleu(hyps, refs) {
  const match = [0, 0, 0, 0], total = [0, 0, 0, 0]; let hl = 0, rl = 0;
  hyps.forEach((h, i) => {
    const ht = tokenize13a(h), rt = tokenize13a(refs[i]); hl += ht.length; rl += rt.length;
    for (let n = 1; n <= 4; n++) {
      const hg = ngrams(ht, n), rg = ngrams(rt, n);
      for (const [k, c] of hg) match[n - 1] += Math.min(c, rg.get(k) ?? 0);
      total[n - 1] += Math.max(0, ht.length - n + 1);
    }
  });
  // sacreBLEU 'exp' smoothing: orders with zero matches get 1/2^k
  let smooth = 1, logp = 0;
  for (let n = 0; n < 4; n++) {
    let p;
    if (total[n] === 0) p = 0;
    else if (match[n] === 0) { smooth *= 2; p = 1 / (smooth * total[n]); }
    else p = match[n] / total[n];
    logp += Math.log(p || 1e-9) / 4;
  }
  const bp = hl >= rl ? 1 : Math.exp(1 - rl / Math.max(hl, 1));
  return +(100 * bp * Math.exp(logp)).toFixed(2);
}

export function chrfpp(hyps, refs, charOrder = 6, wordOrder = 2, beta = 2) {
  const stats = []; // per order: [hypTotal, refTotal, match]
  for (let n = 0; n < charOrder + wordOrder; n++) stats.push([0, 0, 0]);
  hyps.forEach((h, i) => {
    const hc = [...h.replace(/\s+/g, '')], rc = [...refs[i].replace(/\s+/g, '')];
    const hw = h.split(/\s+/).filter(Boolean).map((w) => w), rw = refs[i].split(/\s+/).filter(Boolean);
    const strip = (ws) => ws.map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || w); // punctuation split like chrF++
    const hws = strip(hw), rws = strip(rw);
    for (let n = 1; n <= charOrder; n++) {
      const a = ngrams(hc, n), b = ngrams(rc, n); const s = stats[n - 1];
      for (const [k, c] of a) { s[0] += c; s[2] += Math.min(c, b.get(k) ?? 0); } for (const c of b.values()) s[1] += c;
    }
    for (let n = 1; n <= wordOrder; n++) {
      const a = ngrams(hws, n), b = ngrams(rws, n); const s = stats[charOrder + n - 1];
      for (const [k, c] of a) { s[0] += c; s[2] += Math.min(c, b.get(k) ?? 0); } for (const c of b.values()) s[1] += c;
    }
  });
  let P = 0, R = 0, k = 0;
  for (const [h, r, m] of stats) { if (h > 0 && r > 0) { P += m / h; R += m / r; k++; } }
  P /= k || 1; R /= k || 1;
  const b2 = beta * beta;
  return P + R === 0 ? 0 : +(100 * ((1 + b2) * P * R) / (b2 * P + R)).toFixed(2);
}

/** share of 4-grams that repeat inside a hypothesis (degeneration / looping detector) */
export function repetition(hyps) {
  let rep = 0, tot = 0;
  for (const h of hyps) {
    const t = h.split(/\s+/).filter(Boolean); const seen = new Set();
    for (let i = 0; i + 4 <= t.length; i++) { const k = t.slice(i, i + 4).join(' '); tot++; if (seen.has(k)) rep++; seen.add(k); }
  }
  return tot ? +(100 * rep / tot).toFixed(2) : 0;
}

/** glossary recall on the long text: how many of the expected target terms appear (case-insensitive) */
export const GLOSSARY = {
  'en-vi': [['hải đăng'], ['người gác đèn', 'người canh', 'người giữ đèn', 'người trông coi'], ['kỹ sư'], ['ngư dân'], ['bảo tàng'], ['ngọn tháp', 'tháp'], ['trưởng làng', 'thị trưởng']],
  'vi-en': [['lighthouse'], ['keeper'], ['engineer'], ['fisherm'], ['museum'], ['tower'], ['mayor', 'village head', 'village chief', 'head of the village']],
};
export function termRecall(text, direction) {
  const g = GLOSSARY[direction]; const t = text.toLowerCase();
  const hit = g.filter((alts) => alts.some((a) => t.includes(a))).length;
  return +(100 * hit / g.length).toFixed(1);
}
