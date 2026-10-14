// Rules 14–17: personal baselines, low-recovery streaks, sleep, burnout.
import { addDays, clockFromNoon } from '../dates';
import type { Flag, SleepRecovery } from '../model';

export interface Baseline {
  mean: number;
  sd: number;
  n: number;
}

export const BASELINE_DAYS = 14;
export const BASELINE_MIN = 10;
export const LOW_STREAK = 3;
export const SLEEP_TARGET_MIN = 8 * 60;
export const BEDTIME_SD_MAX = 60;

function stats(values: number[]): Baseline {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  return { mean, sd, n };
}

/** Rule 14 — baseline from the 14 days before `date` (excluding it). */
export function baseline(rows: SleepRecovery[], date: string, key: 'restingHr' | 'hrv'): Baseline | null {
  const from = addDays(date, -BASELINE_DAYS);
  const vals = rows
    .filter((r) => r.date >= from && r.date < date && typeof r[key] === 'number')
    .map((r) => r[key] as number);
  return vals.length >= BASELINE_MIN ? stats(vals) : null;
}

/** Is a single day below par against its own baseline? null = can't tell. */
export function dayIsLow(rows: SleepRecovery[], day: SleepRecovery): boolean | null {
  const hrB = baseline(rows, day.date, 'restingHr');
  const hrvB = baseline(rows, day.date, 'hrv');
  if (!hrB && !hrvB) return null;
  const hrHigh = hrB && day.restingHr !== undefined ? day.restingHr > hrB.mean + Math.max(hrB.sd, 2) : false;
  const hrvLow = hrvB && day.hrv !== undefined ? day.hrv < hrvB.mean - hrvB.sd : false;
  return hrHigh || hrvLow;
}

/** Rule 15 — consecutive low days ending at the latest data on or before refDate. */
export function lowStreak(rows: SleepRecovery[], refDate: string): number {
  const sorted = rows.filter((r) => r.date <= refDate).sort((a, b) => a.date.localeCompare(b.date));
  let streak = 0;
  let expect: string | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const r = sorted[i];
    if (expect && r.date !== expect) break;
    if (dayIsLow(sorted, r) !== true) break;
    streak++;
    expect = addDays(r.date, -1);
  }
  return streak;
}

export function recoveryFlag(rows: SleepRecovery[], refDate: string): Flag | null {
  const streak = lowStreak(rows, refDate);
  if (streak < LOW_STREAK) return null;
  return {
    rule: 15,
    area: 'recovery',
    level: 'warn',
    title: `Recovery low ${streak} days in a row`,
    detail: 'Resting HR above or HRV below your 14-day baseline. Make the next hard run an easy one.',
  };
}

/** Rule 16 — weekly sleep average and bedtime consistency over the 7 days ending refDate. */
export function sleepCheck(rows: SleepRecovery[], refDate: string) {
  const from = addDays(refDate, -6);
  const week = rows.filter((r) => r.date >= from && r.date <= refDate);
  const sleeps = week.map((r) => r.sleepMin).filter((v): v is number => typeof v === 'number');
  const beds = week.map((r) => r.bedtime).filter((v): v is string => !!v).map(clockFromNoon);
  const avgSleep = sleeps.length ? sleeps.reduce((a, b) => a + b, 0) / sleeps.length : null;
  const bedSd = beds.length >= 3 ? stats(beds).sd : null;
  const flags: Flag[] = [];
  if (avgSleep !== null && avgSleep < SLEEP_TARGET_MIN) {
    const h = Math.floor(avgSleep / 60);
    const m = Math.round(avgSleep % 60);
    flags.push({
      rule: 16,
      area: 'recovery',
      level: 'warn',
      title: `Sleep averaged ${h} h ${m} min this week`,
      detail: 'Target is 8 h+: lights out 22:00, wake 06:30.',
    });
  }
  if (bedSd !== null && bedSd > BEDTIME_SD_MAX) {
    flags.push({
      rule: 16,
      area: 'recovery',
      level: 'warn',
      title: `Bedtime varied ±${Math.round(bedSd)} min`,
      detail: 'Keep lights out close to 22:00 every night, weekends included.',
    });
  }
  return { avgSleep, bedSd, nights: week.length, flags };
}

/** Rule 17 — lifts dropping two weeks in a row plus any recovery flag. */
export const BURNOUT_DROP_SHARE = 0.3;

export function burnoutFlag(dropThisWeek: number | null, dropLastWeek: number | null, recoveryFlags: Flag[]): Flag | null {
  if (dropThisWeek === null || dropLastWeek === null) return null;
  if (dropThisWeek < BURNOUT_DROP_SHARE || dropLastWeek < BURNOUT_DROP_SHARE) return null;
  if (recoveryFlags.length === 0) return null;
  return {
    rule: 17,
    area: 'recovery',
    level: 'warn',
    title: 'Possible burnout: lifts dropping 2 weeks + poor recovery',
    detail: 'Take an extra rest day this week and eat a bit more (add the dinner carb portion) before pushing harder.',
    kcalDelta: 200,
  };
}
