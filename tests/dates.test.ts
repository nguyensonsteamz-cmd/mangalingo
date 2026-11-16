import { describe, expect, it } from 'vitest';
import { dayLabel, groupByDay } from '@/ui/dates';

const now = new Date(2026, 10, 17, 15, 0, 0); // Tue 17 Nov 2026
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime();

describe('date groups', () => {
  it('labels today, yesterday and older days with the weekday', () => {
    expect(dayLabel(at(2026, 11, 17), now)).toBe('Hôm nay');
    expect(dayLabel(at(2026, 11, 16, 23), now)).toBe('Hôm qua');
    expect(dayLabel(at(2026, 11, 10), now)).toBe('Thứ Ba, 10/11/2026');
    expect(dayLabel(at(2025, 12, 31), now)).toBe('Thứ Tư, 31/12/2025');
  });
  it('groups a newest-first list by calendar day and keeps the order', () => {
    const items = [at(2026, 11, 17, 12), at(2026, 11, 17, 9), at(2026, 11, 16, 20), at(2026, 11, 1)].map((t) => ({ t }));
    const g = groupByDay(items, (x) => x.t, now);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['Hôm nay', 2], ['Hôm qua', 1], ['Chủ nhật, 01/11/2026', 1]]);
  });
});
