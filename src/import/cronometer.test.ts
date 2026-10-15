import { describe, expect, it } from 'vitest';
import { cronometerEntry, parseCronometerDaily } from './cronometer';

describe('Cronometer daily nutrition CSV', () => {
  const csv = `Date,Energy (kcal),Alcohol (g),Caffeine (mg),Water (g),Protein (g),Carbs (g),Net Carbs (g),Fiber (g),Fat (g),Sodium (mg),Completed
2026-10-13,2450.4,0,80,2100,118.25,280.5,250.1,30.4,80.2,1830.6,true
2026-10-14,0,0,0,0,0,0,0,0,0,0,false
2026-10-15,1210,0,0,900,60,140,120,20,40,900,false`;
  it('reads day totals and skips empty days', () => {
    const { days, missing } = parseCronometerDaily(csv);
    expect(missing).toEqual([]);
    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({ date: '2026-10-13', kcal: 2450.4, protein: 118.25, carbs: 280.5, fat: 80.2, sodiumMg: 1830.6 });
  });
  it('uses Carbs, not Net Carbs', () => {
    expect(parseCronometerDaily(csv).days[1].carbs).toBe(140);
  });
  it('makes one food entry per day with a stable id', () => {
    const e = cronometerEntry(parseCronometerDaily(csv).days[0]);
    expect(e).toMatchObject({ id: 'cronometer-2026-10-13', source: 'cronometer', nutrients: { kcal: 2450, protein: 118.3, sodiumMg: 1831 } });
  });
  it('reports missing columns', () => {
    expect(parseCronometerDaily('Day,Foo\n2026-10-13,1').missing).toContain('kcal');
  });
});
