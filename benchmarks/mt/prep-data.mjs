// Builds data/iwslt.jsonl and data/alt.jsonl from the public test splits (evaluation only).
//   iwslt: thainq107/iwslt2015-en-vi (test split, 1268 TED sentence pairs) -> fixed-seed sample of 100 (3..60 words)
//   alt:   Lots-of-LoRAs/task549_alt_translation_en_vi (test split, Asian Language Treebank news, CC-BY-4.0 upstream)
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import fs from 'node:fs';

const RAW = process.argv[2] || 'D:/extension/.tmp/mtlab/raw';

const detok = (t) =>
  t
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/\s+([,.?!;:%)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .replace(/(\w)\s+'\s*(\w)/g, "$1'$2")
    .replace(/\s+'(s|t|re|ve|ll|d|m)\b/g, "'$1")
    .replace(/\s+/g, ' ')
    .trim();

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const iw = await parquetReadObjects({ file: await asyncBufferFromFile(`${RAW}/iwslt_test.parquet`) });
const r = rng(20261116);
const idx = iw.map((_, i) => i).filter((i) => {
  const n = iw[i].en.split(/\s+/).length;
  return n >= 3 && n <= 60;
});
const pick = [];
while (pick.length < 100) {
  const i = idx[Math.floor(r() * idx.length)];
  if (!pick.includes(i)) pick.push(i);
}
fs.writeFileSync('data/iwslt.jsonl', pick.map((i) => JSON.stringify({ idx: i, en: detok(iw[i].en), vi: detok(iw[i].vi) })).join('\n') + '\n');

const alt = await parquetReadObjects({ file: await asyncBufferFromFile(`${RAW}/alt_test.parquet`) });
const rows = alt
  .map((a, k) => {
    const m = [...a.input.matchAll(/Input:\s*([\s\S]*?)\nOutput:/g)];
    const en = m.length ? m[m.length - 1][1].trim() : null;
    const out = Array.isArray(a.output) ? a.output[0] : a.output;
    return { idx: k, en, vi: String(out).trim() };
  })
  .filter((x) => x.en && x.vi);
fs.writeFileSync('data/alt.jsonl', rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log('iwslt', pick.length, 'alt', rows.length);
console.log(fs.readFileSync('data/iwslt.jsonl', 'utf8').split('\n').slice(0, 2).join('\n'));
console.log(JSON.stringify(rows[0]));
