/**
 * Google Cloud Translation bills by characters of the submitted text: Unicode code points (an emoji or a
 * letter with a combining mark counts per code point, not per UTF-16 unit), whitespace included.
 */
export function countChars(text: string): number {
  let n = 0;
  for (const _ of text) n++; // string iteration walks code points
  return n;
}

/** What is sent (and counted) for a short text: NFC, whitespace collapsed, trimmed. */
export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * What is sent (and counted) for a chunk of a long text: NFC, spaces / tabs collapsed, line breaks kept (3+ in a row become
 * a paragraph break), trimmed. Keeping the breaks keeps the paragraph structure of the translation.
 */
export function normalizeChunk(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
