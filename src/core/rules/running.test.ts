import { describe, expect, it } from 'vitest';
import type { Run } from '../model';
import { benchmarkStatus, easyTargetKm, nextEasyKm, nextIntervals, runBalance } from './running';

let n = 0;
const run = (date: string, type: Run['type'], km: number, sec: number, intervals?: Run['intervals']): Run => ({
  id: String(n++), updatedAt: 0, date, type, distanceKm: km, durationSec: sec, intervals,
});

describe('rule 10: 80/20', () => {
  const ws = '2026-10-05';
  it('accepts the planned 2 hard runs', () => {
    const r = runBalance([run('2026-10-05', 'easy', 5, 1800), run('2026-10-06', 'intervals', 5, 1800), run('2026-10-10', 'benchmark', 4, 1230)], ws);
    expect(r.hard).toBe(2);
    expect(r.flags).toEqual([]);
  });
  it('flags a third hard run', () => {
    const r = runBalance([run('2026-10-06', 'intervals', 5, 1800), run('2026-10-08', 'intervals', 5, 1800), run('2026-10-10', 'benchmark', 4, 1230)], ws);
    expect(r.flags[0].rule).toBe(10);
  });
  it('only counts runs inside the week', () => {
    const r = runBalance([run('2026-10-04', 'intervals', 5, 1800), run('2026-10-12', 'intervals', 5, 1800)], ws);
    expect(r.hard).toBe(0);
  });
});

describe('rule 11: interval progression', () => {
  const four = { reps: 5, workM: 400, restSec: 90 };
  it('holds for 2 weeks, then adds a rep', () => {
    const runs = [run('2026-09-29', 'intervals', 5, 1800, four), run('2026-10-06', 'intervals', 5, 1800, four)];
    expect(nextIntervals(runs, '2026-10-07')!.reps).toBe(5);
    expect(nextIntervals(runs, '2026-10-13')!.reps).toBe(6);
  });
  it('caps at 8 × 400 m', () => {
    const runs = [run('2026-09-01', 'intervals', 5, 1800, { reps: 8, workM: 400 })];
    expect(nextIntervals(runs, '2026-10-13')!.reps).toBe(8);
  });
  it('caps at 6 × 3 min', () => {
    const runs = [run('2026-09-01', 'intervals', 5, 1800, { reps: 6, workSec: 180 })];
    expect(nextIntervals(runs, '2026-10-13')!.reps).toBe(6);
  });
  it('returns null with no interval runs', () => {
    expect(nextIntervals([], '2026-10-13')).toBeNull();
  });
});

describe('rule 12: benchmark target', () => {
  it('starts at sub-20', () => {
    expect(benchmarkStatus([run('2026-10-03', 'benchmark', 4, 1230)]).target).toBe(1200);
  });
  it('moves to sub-19 after 3 of the last 4 under 20:00', () => {
    const runs = [
      run('2026-09-12', 'benchmark', 4, 1195),
      run('2026-09-19', 'benchmark', 4, 1205),
      run('2026-09-26', 'benchmark', 4, 1190),
      run('2026-10-03', 'benchmark', 4, 1188),
    ];
    const s = benchmarkStatus(runs);
    expect(s.target).toBe(1140);
    expect(s.best).toBe(1188);
  });
  it('normalises slightly long courses to 4 km', () => {
    expect(benchmarkStatus([run('2026-10-03', 'benchmark', 4.1, 1230)]).last).toBeCloseTo(1200);
  });
});

describe('rule 13: easy run length', () => {
  it('ramps from 4.5 km to ~5.75 km over 12 weeks', () => {
    expect(easyTargetKm(1)).toBe(4.5);
    expect(easyTargetKm(12)).toBe(5.75);
    expect(easyTargetKm(20)).toBe(5.75);
  });
  it('adds at most 0.5 km at a time and holds when recovery is low', () => {
    const runs = [run('2026-10-05', 'easy', 4.5, 1700)];
    expect(nextEasyKm(runs, 12, false)).toBe(5);
    expect(nextEasyKm(runs, 12, true)).toBe(4.5);
  });
});
