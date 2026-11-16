/** Date grouping for notes / vocabulary lists: "Hôm nay", "Hôm qua", then "Thứ Ba, 17/11/2026". */
const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const pad = (n: number) => String(n).padStart(2, '0');

export function dayLabel(ts: number, now = new Date()): string {
  const d = new Date(ts);
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  return `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export interface DayGroup<T> {
  /** local-day key yyyy-mm-dd */
  key: string;
  label: string;
  items: T[];
}

/** Groups items by local calendar day, keeping the order of the input (so a newest-first list gives newest day first). */
export function groupByDay<T>(items: T[], ts: (x: T) => number, now = new Date()): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const it of items) {
    const d = new Date(ts(it));
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(it);
    else out.push({ key, label: dayLabel(ts(it), now), items: [it] });
  }
  return out;
}
