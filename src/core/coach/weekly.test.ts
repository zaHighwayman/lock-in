import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, ORIGINAL_PROFILE, SEED_EXERCISES } from '../../db/seed';
import { addDays } from '../dates';
import { buildWeek, type CoachData } from './weekly';

const REF = '2026-10-18'; // Sunday

function data(): CoachData {
  const sessions = [-27, -20, -13, -6].map((d, i) => ({ id: `s${i}`, updatedAt: 0, date: addDays(REF, d), name: 'Upper A', startedAt: 0, endedAt: 1 }));
  const sets = sessions.flatMap((s, i) =>
    [1, 2, 3].map((n) => ({ id: `${s.id}-${n}`, updatedAt: 0, sessionId: s.id, exerciseId: 'bench-press', date: s.date, order: 0, setNo: n, weight: 57.5 + i * 1.25, reps: 8, done: true })),
  );
  const body = Array.from({ length: 35 }, (_, i) => ({ id: `b${i}`, updatedAt: 0, date: addDays(REF, i - 34), weightKg: 68, source: 'manual' as const }));
  return {
    settings: { ...DEFAULT_SETTINGS, ...ORIGINAL_PROFILE, programStartDate: '2026-09-14' },
    exercises: SEED_EXERCISES,
    sessions,
    sets,
    runs: [{ id: 'r1', updatedAt: 0, date: addDays(REF, -1), type: 'benchmark', distanceKm: 4, durationSec: 1190 }],
    body: [...body, { id: 'w1', updatedAt: 0, date: addDays(REF, -28), waistCm: 76, source: 'manual' }, { id: 'w2', updatedAt: 0, date: REF, waistCm: 75.5, source: 'manual' }],
    sleep: [],
    activity: [
      { id: 'a1', updatedAt: 0, date: addDays(REF, -1), steps: 8000, activeKcal: 500, exerciseMin: 30, source: 'apple-health' },
      { id: 'a2', updatedAt: 0, date: REF, steps: 10000, activeKcal: 600, exerciseMin: 40, source: 'apple-health' },
      { id: 'a0', updatedAt: 0, date: addDays(REF, -9), steps: 99999, source: 'apple-health' },
    ],
    food: [{ id: 'f1', updatedAt: 0, date: REF, slot: 'dinner', name: 'Chili', nutrients: { kcal: 650, protein: 50, carbs: 70, fat: 15, sodiumMg: 300 } }],
  };
}

describe('weekly build', () => {
  it('aggregates the week and runs the rules', () => {
    const w = buildWeek(data(), REF);
    expect(w.weekStart).toBe('2026-10-12');
    expect(w.input.week.programWeek).toBe(5);
    expect(w.input.week.deloadNext).toBe(true);
    expect(w.flags.some((f) => f.rule === 3)).toBe(true);
    expect(w.flags.some((f) => f.rule === 7 && f.level === 'good')).toBe(true);
    expect(w.input.lifting.lifts[0]).toMatchObject({ exercise: 'Bench press', pr: true });
    expect(w.input.running.thisWeekBenchmark).toEqual([1190]);
    expect(w.input.nutrition.proteinTargetG).toBe(102);
    expect(w.input.activity).toMatchObject({ daysWithData: 2, avgSteps: 9000, exerciseMinTotal: 70 });
  });
  it('contains only aggregates, no raw daily weights or food names', () => {
    const json = JSON.stringify(buildWeek(data(), REF).input);
    expect(json).not.toContain('Chili');
    expect(json.match(/"weightKg"/)).toBeNull();
  });
});
