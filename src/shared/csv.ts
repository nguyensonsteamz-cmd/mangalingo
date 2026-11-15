/** RFC 4180 CSV parsing/serialisation with delimiter auto-detection (comma, semicolon, tab). */

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const needsQuote = /[",\n\r;]/;
export function toCsv(rows: (string | number | undefined | null)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          let s = v === undefined || v === null ? '' : String(v);
          // Neutralise spreadsheet formula injection.
          if (/^[=+\-@]/.test(s)) s = `'${s}`;
          return needsQuote.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}

/** Maps header names (case/space-insensitive, with aliases) to column indexes. */
export function headerIndex(header: string[], aliases: Record<string, string[]>): Record<string, number> {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ''));
  const out: Record<string, number> = {};
  for (const [key, names] of Object.entries(aliases)) {
    const idx = norm.findIndex((h) => names.includes(h));
    if (idx >= 0) out[key] = idx;
  }
  return out;
}
