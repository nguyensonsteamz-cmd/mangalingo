/** Calendar helpers (LOCAL time). The month boundary comes from the date, never from a timer. */
const p2 = (n: number) => String(n).padStart(2, '0');

export const monthKey = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
export const dayKey = (d: Date) => `${monthKey(d)}-${p2(d.getDate())}`;
export const firstOfMonth = (d: Date) => `${monthKey(d)}-01`;
export const firstOfNextMonth = (d: Date) => {
  const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
  const m = d.getMonth() === 11 ? 1 : d.getMonth() + 2;
  return `${y}-${p2(m)}-01`;
};
