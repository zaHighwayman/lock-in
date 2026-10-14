// Rules 10–13: running balance, interval progression, 4 km benchmark, easy-run distance.
import { addDays, diffDays, formatDuration } from '../dates';
import type { Flag, Run } from '../model';

export const HARD_TYPES: Run['type'][] = ['intervals', 'benchmark'];
export const MAX_HARD_PER_WEEK = 2;

export function isHard(r: Run): boolean {
  return HARD_TYPES.includes(r.type);
}

/** Rule 10 — 80/20 check on the 7 days starting at weekStart. */
export function runBalance(runs: Run[], weekStart: string): { hard: number; easy: number; hardShare: number | null; flags: Flag[] } {
  const end = addDays(weekStart, 6);
  const week = runs.filter((r) => r.date >= weekStart && r.date <= end);
  const hard = week.filter(isHard);
  const easy = week.filter((r) => !isHard(r));
  const hardSec = hard.reduce((a, r) => a + r.durationSec, 0);
  const totalSec = week.reduce((a, r) => a + r.durationSec, 0);
  const flags: Flag[] = [];
  if (hard.length > MAX_HARD_PER_WEEK) {
    flags.push({
      rule: 10,
      area: 'running',
      level: 'warn',
      title: `${hard.length} hard runs this week`,
      detail: 'The plan has 2 (intervals + Saturday benchmark). Make the extra ones easy so the lifting recovers.',
    });
  }
  return { hard: hard.length, easy: easy.length, hardShare: totalSec ? hardSec / totalSec : null, flags };
}

/** Rep caps: 8 × 400 m or 6 × 3 min. */
export function intervalCap(spec: Run['intervals']): number {
  if (!spec) return 8;
  if (spec.workSec !== undefined && spec.workSec >= 150) return 6;
  return 8;
}

/** Rule 11 — add one rep every 2 weeks, up to the cap. */
export function nextIntervals(runs: Run[], refDate: string): { reps: number; message: string; spec: Run['intervals'] } | null {
  const iv = runs
    .filter((r) => r.type === 'intervals' && r.intervals && r.date <= refDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (iv.length === 0) return null;
  const last = iv[iv.length - 1];
  const spec = last.intervals!;
  const cap = intervalCap(spec);
  // first date of the current streak at this rep count
  let since = last.date;
  for (let i = iv.length - 1; i >= 0 && iv[i].intervals!.reps === spec.reps; i--) since = iv[i].date;
  const work = spec.workM ? `${spec.workM} m` : spec.workSec ? formatDuration(spec.workSec) : 'rep';
  if (spec.reps >= cap) return { reps: spec.reps, spec, message: `At the cap (${cap} × ${work}). Hold it and run the reps a little faster.` };
  if (diffDays(refDate, since) >= 14) {
    return { reps: spec.reps + 1, spec, message: `2 weeks at ${spec.reps} × ${work} → go ${spec.reps + 1} × ${work}.` };
  }
  return { reps: spec.reps, spec, message: `Stay at ${spec.reps} × ${work} (add a rep after 2 weeks at this count).` };
}

/** Benchmark time normalised to 4 km. */
export function time4k(r: Run): number {
  return r.distanceKm > 0 ? (r.durationSec * 4) / r.distanceKm : r.durationSec;
}

const TARGET_LADDER = [20 * 60, 19 * 60, 18 * 60 + 30, 18 * 60];

/** Rule 12 — current 4 km target: the first rung not beaten in 3 of the last 4 benchmarks. */
export function benchmarkStatus(runs: Run[]) {
  const b = runs.filter((r) => r.type === 'benchmark').sort((a, c) => a.date.localeCompare(c.date));
  const times = b.map(time4k);
  const last4 = times.slice(-4);
  const consistentlyUnder = (t: number) => last4.filter((x) => x < t).length >= 3;
  const target = TARGET_LADDER.find((t) => !consistentlyUnder(t)) ?? TARGET_LADDER[TARGET_LADDER.length - 1];
  return {
    count: b.length,
    best: times.length ? Math.min(...times) : null,
    last: times.length ? times[times.length - 1] : null,
    target,
    history: b.map((r) => ({ date: r.date, sec: time4k(r) })),
  };
}

/** Rule 13 — easy-run distance target, 4.5 km in week 1 rising to 5.75 km by week 12. */
export function easyTargetKm(programWeek: number, weeks = 12): number {
  const w = Math.min(Math.max(programWeek, 1), weeks);
  const km = 4.5 + ((w - 1) * 1.25) / (weeks - 1);
  return Math.round(km * 4) / 4;
}

export function nextEasyKm(runs: Run[], programWeek: number, recoveryLow: boolean): number {
  const target = easyTargetKm(programWeek);
  const easy = runs.filter((r) => r.type === 'easy').sort((a, b) => a.date.localeCompare(b.date));
  const last = easy[easy.length - 1];
  if (!last) return 4.5;
  if (recoveryLow) return Math.min(last.distanceKm, target);
  return Math.min(target, Math.round((last.distanceKm + 0.5) * 4) / 4);
}
