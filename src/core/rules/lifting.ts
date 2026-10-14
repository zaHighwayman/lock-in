// Rules 1–4: double progression, stall detection, deload, pre-fill. Plus lift trend for rule 17.
import { programWeek, diffDays } from '../dates';
import type { Flag } from '../model';

export interface LoggedSet {
  weight: number;
  reps: number;
}

/** Working sets of one exercise in one session (completed sets only). */
export interface ExerciseSession {
  date: string;
  isDeload?: boolean;
  sets: LoggedSet[];
}

export interface Target {
  sets: number;
  repMin: number;
  /** null = AMRAP */
  repMax: number | null;
  increment: number;
}

export interface Suggestion {
  kind: 'start' | 'increase' | 'repeat' | 'add-load';
  weight: number;
  /** planned reps per set, length = target.sets */
  reps: number[];
  message: string;
}

/** Once every AMRAP set reaches this, suggest adding load. */
export const AMRAP_LOAD_AT = 12;
export const DELOAD_LOAD = 0.9;

export function roundTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

function floorTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.floor(value / step + 1e-9) * step;
}

const fmt = (kg: number) => `${+kg.toFixed(2)} kg`;

/** The weight that every set was done with (the lightest set). */
export function workingWeight(sets: LoggedSet[]): number {
  return sets.length ? Math.min(...sets.map((s) => s.weight)) : 0;
}

export function totalReps(sets: LoggedSet[]): number {
  return sets.reduce((a, s) => a + s.reps, 0);
}

function lastNormalSession(history: ExerciseSession[]): ExerciseSession | undefined {
  const withSets = history.filter((h) => h.sets.length > 0);
  for (let i = withSets.length - 1; i >= 0; i--) if (!withSets[i].isDeload) return withSets[i];
  return withSets[withSets.length - 1];
}

/**
 * Rule 1 — double progression.
 * `history` is sorted oldest → newest.
 */
export function suggestNext(history: ExerciseSession[], t: Target): Suggestion {
  const last = lastNormalSession(history);
  if (!last) {
    return {
      kind: 'start',
      weight: 0,
      reps: Array(t.sets).fill(t.repMin),
      message:
        t.repMax === null
          ? 'First session: as many clean reps as possible each set.'
          : `First session: pick a weight you can do for ${t.repMin}–${t.repMax} reps with 1–3 left in the tank.`,
    };
  }

  const w = workingWeight(last.sets);
  const lastReps = last.sets.map((s) => s.reps);
  const pad = (arr: number[], fill: number) =>
    Array.from({ length: t.sets }, (_, i) => arr[i] ?? arr[arr.length - 1] ?? fill);

  if (t.repMax === null) {
    const enoughSets = last.sets.length >= t.sets;
    if (enoughSets && lastReps.every((r) => r >= AMRAP_LOAD_AT)) {
      return {
        kind: 'add-load',
        weight: roundTo(w + t.increment, t.increment),
        reps: Array(t.sets).fill(t.repMin),
        message: `${AMRAP_LOAD_AT}+ reps on every set → add ${fmt(t.increment)}.`,
      };
    }
    const planned = pad(lastReps, t.repMin);
    planned[0] += 1;
    return {
      kind: 'repeat',
      weight: w,
      reps: planned,
      message: `Beat ${totalReps(last.sets)} total reps.`,
    };
  }

  const repMax = t.repMax;
  const allTop =
    last.sets.length >= t.sets && last.sets.every((s) => s.weight === w && s.reps >= repMax);

  if (allTop) {
    const next = roundTo(w + t.increment, t.increment);
    return {
      kind: 'increase',
      weight: next,
      reps: Array(t.sets).fill(t.repMin),
      message: `All sets hit ${repMax} → ${fmt(next)}.`,
    };
  }

  const planned = pad(lastReps, t.repMin).map((r) => Math.min(Math.max(r, t.repMin), repMax));
  const idx = planned.findIndex((r) => r < repMax);
  if (idx >= 0) planned[idx] += 1;
  return {
    kind: 'repeat',
    weight: w,
    reps: planned,
    message: idx >= 0 ? `Same weight, +1 rep on set ${idx + 1}.` : 'Same weight, finish every set at the top of the range.',
  };
}

/** Rule 3 — is this date inside a deload week? */
export function isDeloadWeek(startDate: string | null, date: string, every: number): boolean {
  if (!startDate || every <= 0) return false;
  const wk = programWeek(startDate, date);
  return wk > 0 && wk % every === 0;
}

/** Rule 3 — turn a normal suggestion into a deload one: half the sets, ~90 % load. */
export function deloadSuggestion(s: Suggestion, t: Target): Suggestion {
  const sets = Math.max(1, Math.ceil(t.sets / 2));
  const weight = s.weight > 0 ? floorTo(s.weight * DELOAD_LOAD, t.increment || 0.5) : 0;
  return {
    kind: 'repeat',
    weight,
    reps: s.reps.slice(0, sets).map(() => t.repMin),
    message: `Deload: ${sets} set${sets > 1 ? 's' : ''} × ${t.repMin} at ${weight > 0 ? fmt(weight) : 'bodyweight'}. Leave reps in the tank.`,
  };
}

/** Rule 4 — planned rows for the logger. */
export function prefill(history: ExerciseSession[], t: Target, deload: boolean) {
  let s = suggestNext(history, t);
  if (deload) s = deloadSuggestion(s, t);
  return { suggestion: s, sets: s.reps.map((reps) => ({ weight: s.weight, reps })) };
}

/** Compare two sessions: heavier working weight wins, otherwise more total reps. */
function improved(a: ExerciseSession, over: ExerciseSession): boolean {
  const wa = workingWeight(a.sets);
  const wb = workingWeight(over.sets);
  if (wa !== wb) return wa > wb;
  return totalReps(a.sets) > totalReps(over.sets);
}

export const STALL_SESSIONS = 3;

/**
 * Rule 2 — stall: across the last 3 sessions (deloads ignored),
 * neither of the later two improved on the first.
 */
export function detectStall(history: ExerciseSession[]): boolean {
  const normal = history.filter((h) => !h.isDeload && h.sets.length > 0);
  if (normal.length < STALL_SESSIONS) return false;
  const [first, ...rest] = normal.slice(-STALL_SESSIONS);
  return !rest.some((s) => improved(s, first));
}

export function stallFlag(exerciseName: string): Flag {
  return {
    rule: 2,
    area: 'lifting',
    level: 'warn',
    title: `${exerciseName}: no progress in ${STALL_SESSIONS} sessions`,
    detail: 'In order: 1) check sleep and food this week, 2) hold the weight one more week, 3) swap to a variation.',
  };
}

/** Estimated 1RM of the best set (Epley); bodyweight sets count reps only. */
export function sessionScore(s: ExerciseSession): number {
  return Math.max(0, ...s.sets.map((x) => (x.weight > 0 ? x.weight * (1 + x.reps / 30) : x.reps)));
}

/**
 * For rule 17: is this exercise performing worse now than ~2 weeks earlier?
 * Returns null when there is not enough history.
 */
export function isDropping(history: ExerciseSession[], refDate: string, drop = 0.02): boolean | null {
  const normal = history.filter((h) => !h.isDeload && h.sets.length > 0 && h.date <= refDate);
  if (normal.length < 2) return null;
  const latest = normal[normal.length - 1];
  if (diffDays(refDate, latest.date) > 10) return null;
  const earlier = [...normal].reverse().find((h) => diffDays(latest.date, h.date) >= 14);
  if (!earlier) return null;
  return sessionScore(latest) < sessionScore(earlier) * (1 - drop);
}

/** Share of exercises (with enough data) that are dropping at refDate. */
export function dropShare(histories: ExerciseSession[][], refDate: string): number | null {
  const results = histories.map((h) => isDropping(h, refDate)).filter((r): r is boolean => r !== null);
  if (results.length === 0) return null;
  return results.filter(Boolean).length / results.length;
}

/** Overall lift direction for rule 7: rising / flat / falling over the last ~4 weeks. */
export function liftTrend(histories: ExerciseSession[][], refDate: string): 'rising' | 'flat' | 'falling' | 'unknown' {
  let up = 0;
  let down = 0;
  for (const h of histories) {
    const normal = h.filter((s) => !s.isDeload && s.sets.length > 0 && s.date <= refDate);
    if (normal.length < 2) continue;
    const latest = normal[normal.length - 1];
    const old = normal.find((s) => diffDays(latest.date, s.date) <= 28) ?? normal[0];
    if (old === latest) continue;
    const a = sessionScore(latest);
    const b = sessionScore(old);
    if (a > b * 1.005) up++;
    else if (a < b * 0.98) down++;
  }
  if (up + down === 0) return 'unknown';
  if (up > down) return 'rising';
  if (down > up) return 'falling';
  return 'flat';
}
