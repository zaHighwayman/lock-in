import { describe, expect, it } from 'vitest';
import {
  deloadSuggestion, detectStall, dropShare, isDeloadWeek, isDropping, liftTrend, prefill, suggestNext,
  type ExerciseSession, type Target,
} from './lifting';

const bench: Target = { sets: 3, repMin: 5, repMax: 8, increment: 2.5 };
const s = (date: string, sets: [number, number][], isDeload = false): ExerciseSession => ({
  date,
  isDeload,
  sets: sets.map(([weight, reps]) => ({ weight, reps })),
});

describe('rule 1: double progression', () => {
  it('starts with a hint when there is no history', () => {
    const r = suggestNext([], bench);
    expect(r.kind).toBe('start');
    expect(r.reps).toEqual([5, 5, 5]);
  });

  it('adds the increment when every set hits the top of the range at the same weight', () => {
    const r = suggestNext([s('2026-10-01', [[60, 8], [60, 8], [60, 8]])], bench);
    expect(r.kind).toBe('increase');
    expect(r.weight).toBe(62.5);
    expect(r.reps).toEqual([5, 5, 5]);
  });

  it('keeps the weight and adds one rep to the first set below the top', () => {
    const r = suggestNext([s('2026-10-01', [[60, 8], [60, 7], [60, 6]])], bench);
    expect(r.kind).toBe('repeat');
    expect(r.weight).toBe(60);
    expect(r.reps).toEqual([8, 8, 6]);
  });

  it('does not increase if a set was missing', () => {
    const r = suggestNext([s('2026-10-01', [[60, 8], [60, 8]])], bench);
    expect(r.kind).toBe('repeat');
    expect(r.reps).toEqual([8, 8, 8]);
  });

  it('does not increase when one set was lighter', () => {
    const r = suggestNext([s('2026-10-01', [[60, 8], [60, 8], [57.5, 8]])], bench);
    expect(r.kind).toBe('repeat');
    expect(r.weight).toBe(57.5);
  });

  it('uses dumbbell increments', () => {
    const r = suggestNext([s('2026-10-01', [[12, 20], [12, 20], [12, 20]])], { sets: 3, repMin: 12, repMax: 20, increment: 1 });
    expect(r.weight).toBe(13);
  });

  it('ignores deload sessions when deciding', () => {
    const r = suggestNext(
      [s('2026-10-01', [[60, 8], [60, 8], [60, 8]]), s('2026-10-08', [[52.5, 5], [52.5, 5]], true)],
      bench,
    );
    expect(r.kind).toBe('increase');
    expect(r.weight).toBe(62.5);
  });

  it('AMRAP: beat total reps, then add load at 12+ every set', () => {
    const pull: Target = { sets: 3, repMin: 5, repMax: null, increment: 2.5 };
    const a = suggestNext([s('2026-10-01', [[0, 9], [0, 8], [0, 7]])], pull);
    expect(a.kind).toBe('repeat');
    expect(a.reps).toEqual([10, 8, 7]);
    const b = suggestNext([s('2026-10-01', [[0, 12], [0, 12], [0, 13]])], pull);
    expect(b.kind).toBe('add-load');
    expect(b.weight).toBe(2.5);
  });
});

describe('rule 2: stall detection', () => {
  it('needs 3 sessions', () => {
    expect(detectStall([s('a', [[60, 8]]), s('b', [[60, 8]])])).toBe(false);
  });
  it('flags 3 sessions with no weight or rep increase', () => {
    const h = [s('2026-09-01', [[60, 6], [60, 6], [60, 5]]), s('2026-09-04', [[60, 6], [60, 5], [60, 5]]), s('2026-09-08', [[60, 6], [60, 6], [60, 5]])];
    expect(detectStall(h)).toBe(true);
  });
  it('does not flag when reps went up', () => {
    const h = [s('2026-09-01', [[60, 6], [60, 6], [60, 5]]), s('2026-09-04', [[60, 6], [60, 6], [60, 5]]), s('2026-09-08', [[60, 7], [60, 6], [60, 5]])];
    expect(detectStall(h)).toBe(false);
  });
  it('does not flag when weight went up even with fewer reps', () => {
    const h = [s('2026-09-01', [[60, 8], [60, 8], [60, 8]]), s('2026-09-04', [[62.5, 5], [62.5, 5], [62.5, 5]]), s('2026-09-08', [[62.5, 5], [62.5, 5], [62.5, 5]])];
    expect(detectStall(h)).toBe(false);
  });
  it('skips deload sessions', () => {
    const h = [s('1', [[60, 6]]), s('2', [[60, 7]]), s('3', [[50, 5]], true), s('4', [[60, 8]])];
    expect(detectStall(h)).toBe(false);
  });
});

describe('rule 3: deload', () => {
  it('is every 6th program week', () => {
    const start = '2026-09-07'; // Monday
    expect(isDeloadWeek(start, '2026-09-07', 6)).toBe(false);
    expect(isDeloadWeek(start, '2026-10-12', 6)).toBe(true); // week 6
    expect(isDeloadWeek(start, '2026-10-18', 6)).toBe(true); // Sunday of week 6
    expect(isDeloadWeek(start, '2026-10-19', 6)).toBe(false);
    expect(isDeloadWeek(start, '2026-11-16', 6)).toBe(false); // week 11
    expect(isDeloadWeek(start, '2026-11-23', 6)).toBe(true); // week 12
  });
  it('returns false without a start date', () => {
    expect(isDeloadWeek(null, '2026-10-12', 6)).toBe(false);
  });
  it('halves the sets and drops the load ~10 %', () => {
    const d = deloadSuggestion({ kind: 'increase', weight: 62.5, reps: [5, 5, 5], message: '' }, bench);
    expect(d.reps.length).toBe(2);
    expect(d.weight).toBe(55);
  });
});

describe('rule 4: pre-fill', () => {
  it('returns one row per planned set with the suggested weight', () => {
    const p = prefill([s('2026-10-01', [[60, 8], [60, 8], [60, 8]])], bench, false);
    expect(p.sets).toEqual([{ weight: 62.5, reps: 5 }, { weight: 62.5, reps: 5 }, { weight: 62.5, reps: 5 }]);
  });
  it('applies deload', () => {
    const p = prefill([s('2026-10-01', [[60, 8], [60, 8], [60, 8]])], bench, true);
    expect(p.sets.length).toBe(2);
  });
});

describe('lift trend helpers (rules 7 and 17)', () => {
  const rising = [s('2026-09-01', [[60, 6]]), s('2026-09-29', [[65, 6]])];
  const falling = [s('2026-09-01', [[60, 8]]), s('2026-09-29', [[55, 6]])];
  it('detects a drop vs 2 weeks earlier', () => {
    expect(isDropping(falling, '2026-09-30')).toBe(true);
    expect(isDropping(rising, '2026-09-30')).toBe(false);
  });
  it('returns null without enough history', () => {
    expect(isDropping([s('2026-09-29', [[60, 6]])], '2026-09-30')).toBeNull();
  });
  it('computes the share dropping', () => {
    expect(dropShare([rising, falling], '2026-09-30')).toBe(0.5);
  });
  it('summarises trend', () => {
    expect(liftTrend([rising, rising, falling], '2026-09-30')).toBe('rising');
    expect(liftTrend([], '2026-09-30')).toBe('unknown');
  });
});
