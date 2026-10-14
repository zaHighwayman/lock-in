import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import { avg7, avg7Series, enforceRule9, evaluateBodyComp, MAX_DEFICIT_KCAL, type DatedValue } from './bodycomp';

/** daily weights from `start` for `days` days, value = f(dayIndex) */
function series(start: string, days: number, f: (i: number) => number, every = 1): DatedValue[] {
  const out: DatedValue[] = [];
  for (let i = 0; i < days; i += every) out.push({ date: addDays(start, i), value: f(i) });
  return out;
}

const REF = '2026-10-11';
const START = addDays(REF, -34);

describe('rule 5: 7-day average', () => {
  it('averages the 7 days ending at the date', () => {
    const w = series(addDays(REF, -6), 7, (i) => 68 + i * 0.1);
    expect(avg7(w, REF)).toBeCloseTo(68.3);
  });
  it('needs at least 4 weigh-ins', () => {
    const w = series(addDays(REF, -6), 7, () => 68, 2); // 4 entries: days 0,2,4,6
    expect(avg7(w, REF)).toBe(68);
    expect(avg7(w.slice(0, 3), REF)).toBeNull();
  });
  it('builds a chart series', () => {
    const w = series(START, 10, () => 68);
    expect(avg7Series(w).length).toBe(7);
  });
});

describe('rules 6–8: weekly body comp', () => {
  it('rule 6: down > 0.5 kg in 2 weeks → add carbs', () => {
    const w = series(START, 35, (i) => 69 - i * 0.06);
    const r = evaluateBodyComp({ weights: w, waists: [], liftTrend: 'rising', refDate: REF });
    expect(r.flags[0].rule).toBe(6);
    expect(r.flags[0].kcalDelta).toBe(200);
  });

  it('rule 7: flat weight, flat waist, rising lifts → on track', () => {
    const w = series(START, 35, (i) => 68 + (i % 2) * 0.2);
    const waists = [{ date: addDays(REF, -28), value: 76 }, { date: REF, value: 75.8 }];
    const r = evaluateBodyComp({ weights: w, waists, liftTrend: 'rising', refDate: REF });
    expect(r.flags.map((f) => f.rule)).toEqual([7]);
    expect(r.flags[0].level).toBe('good');
  });

  it('rule 7 is not "on track" when lifts are not rising', () => {
    const w = series(START, 35, () => 68);
    const waists = [{ date: addDays(REF, -28), value: 76 }, { date: REF, value: 76 }];
    const r = evaluateBodyComp({ weights: w, waists, liftTrend: 'flat', refDate: REF });
    expect(r.flags).toEqual([]);
  });

  it('rule 8: weight up > 0.5 kg in a month and waist up → trim carbs', () => {
    const w = series(START, 35, (i) => 68 + i * 0.03);
    const waists = [{ date: addDays(REF, -28), value: 76 }, { date: REF, value: 77 }];
    const r = evaluateBodyComp({ weights: w, waists, liftTrend: 'rising', refDate: REF });
    expect(r.flags[0].rule).toBe(8);
    expect(r.flags[0].kcalDelta).toBe(-150);
  });

  it('rule 8 needs the waist to go up too', () => {
    const w = series(START, 35, (i) => 68 + i * 0.03);
    const waists = [{ date: addDays(REF, -28), value: 76 }, { date: REF, value: 76 }];
    const r = evaluateBodyComp({ weights: w, waists, liftTrend: 'rising', refDate: REF });
    expect(r.flags.find((f) => f.rule === 8)).toBeUndefined();
  });

  it('reports missing data instead of guessing', () => {
    const r = evaluateBodyComp({ weights: [], waists: [], liftTrend: 'rising', refDate: REF });
    expect(r.flags[0].rule).toBe(5);
    expect(r.flags[0].level).toBe('info');
  });
});

describe('rule 9: deficit ceiling', () => {
  it('clamps any bigger deficit to 250 kcal', () => {
    const f = enforceRule9({ rule: 8, area: 'body', level: 'warn', title: 'x', kcalDelta: -500 });
    expect(f.kcalDelta).toBe(-MAX_DEFICIT_KCAL);
  });
  it('no body rule ever suggests more than 250 kcal deficit', () => {
    for (let slope = -0.1; slope <= 0.1; slope += 0.01) {
      const w = series(START, 35, (i) => 68 + i * slope);
      const waists = [{ date: addDays(REF, -28), value: 76 }, { date: REF, value: 78 }];
      const r = evaluateBodyComp({ weights: w, waists, liftTrend: 'rising', refDate: REF });
      for (const f of r.flags) expect(f.kcalDelta ?? 0).toBeGreaterThanOrEqual(-MAX_DEFICIT_KCAL);
    }
  });
});

describe('goals other than recomp', () => {
  const waists = [{ date: addDays(REF, -28), value: 76 }, { date: REF, value: 76.3 }];
  it('lean bulk: flat weight → add carbs, steady gain → on track, fast gain → trim', () => {
    const flat = evaluateBodyComp({ weights: series(START, 35, () => 68), waists, liftTrend: 'rising', refDate: REF, goal: 'lean-bulk' });
    expect(flat.flags[0]).toMatchObject({ rule: 6, kcalDelta: 200 });
    const steady = evaluateBodyComp({ weights: series(START, 35, (i) => 68 + i * 0.012), waists, liftTrend: 'flat', refDate: REF, goal: 'lean-bulk' });
    expect(steady.flags[0]).toMatchObject({ rule: 7, level: 'good' });
    const fast = evaluateBodyComp({ weights: series(START, 35, (i) => 68 + i * 0.05), waists, liftTrend: 'rising', refDate: REF, goal: 'lean-bulk' });
    expect(fast.flags[0]).toMatchObject({ rule: 8, kcalDelta: -150 });
  });
  it('cut: not losing → trim, too fast → add back, steady loss → on track', () => {
    const stuck = evaluateBodyComp({ weights: series(START, 35, () => 75), waists, liftTrend: 'flat', refDate: REF, goal: 'cut' });
    expect(stuck.flags[0]).toMatchObject({ rule: 8, kcalDelta: -150 });
    const crash = evaluateBodyComp({ weights: series(START, 35, (i) => 80 - i * 0.15), waists, liftTrend: 'flat', refDate: REF, goal: 'cut' });
    expect(crash.flags[0]).toMatchObject({ rule: 6, kcalDelta: 200 });
    const good = evaluateBodyComp({ weights: series(START, 35, (i) => 80 - i * 0.06), waists, liftTrend: 'flat', refDate: REF, goal: 'cut' });
    expect(good.flags[0]).toMatchObject({ rule: 7, level: 'good' });
  });
  it('rule 9 cap is 500 kcal on a cut and 250 otherwise', () => {
    const f = { rule: 8, area: 'body' as const, level: 'warn' as const, title: 'x', kcalDelta: -900 };
    expect(enforceRule9(f, 500).kcalDelta).toBe(-500);
    expect(enforceRule9(f).kcalDelta).toBe(-250);
  });
});
