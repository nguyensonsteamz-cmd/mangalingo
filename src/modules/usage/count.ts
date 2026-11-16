/**
 * Google Cloud Translation bills by characters of the submitted text: Unicode code points (an emoji or a
 * letter with a combining mark counts per code point, not per UTF-16 unit), whitespace included.
 */
export function countChars(text: string): number {
  let n = 0;
  for (const _ of text) n++; // string iteration walks code points
  return n;
}

/** What is sent (and counted): NFC, whitespace collapsed, trimmed. */
export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}
