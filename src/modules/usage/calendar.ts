/**
 * Calendar helpers in UTC. The monthly usage period resets at 00:00 UTC on the 1st of each month, the same boundary on
 * every device and time zone. The boundary comes from the date (checked on every access), never from a timer.
 */
const p2 = (n: number) => String(n).padStart(2, '0');

export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
export const dayKey = (d: Date) => `${monthKey(d)}-${p2(d.getUTCDate())}`;
export const firstOfMonth = (d: Date) => `${monthKey(d)}-01`;
export const firstOfNextMonth = (d: Date) => {
  const y = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 11 ? 1 : d.getUTCMonth() + 2;
  return `${y}-${p2(m)}-01`;
};
/** "2026-12-01" -> "2026-12-01T00:00:00Z" */
export const resetInstant = (isoDate: string) => `${isoDate}T00:00:00Z`;
