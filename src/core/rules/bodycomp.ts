// Rules 5–9: body composition from Withings weights and weekly waist entries.
import { addDays, diffDays } from '../dates';
import type { Flag, Goal } from '../model';
import { maxDeficit } from './guardrails';

export interface DatedValue {
  date: string;
  value: number;
}

export const MIN_WEIGH_INS = 4;
/** recomp / lean-bulk ceiling; a cut allows up to maxDeficit('cut') */
export const MAX_DEFICIT_KCAL = 250;
const ADD_CARBS_KCAL = 200;
const TRIM_CARBS_KCAL = -150;

/** Rule 5 — mean of the 7 days ending at `end`, or null if fewer than 4 weigh-ins. */
export function avg7(weights: DatedValue[], end: string): number | null {
  const from = addDays(end, -6);
  // one value per day: the latest logged for that date
  const byDay = new Map<string, number>();
  for (const w of weights) if (w.date >= from && w.date <= end) byDay.set(w.date, w.value);
  if (byDay.size < MIN_WEIGH_INS) return null;
  const vals = [...byDay.values()];
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Rolling 7-day average series for charting (one point per day that has an average). */
export function avg7Series(weights: DatedValue[]): DatedValue[] {
  if (weights.length === 0) return [];
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const out: DatedValue[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const v = avg7(sorted, d);
    if (v !== null) out.push({ date: d, value: v });
  }
  return out;
}

/** Latest waist entry on or before `date`, no older than `maxAgeDays`. */
export function waistAt(waists: DatedValue[], date: string, maxAgeDays = 10): number | null {
  let best: DatedValue | null = null;
  for (const w of waists) {
    if (w.date > date || diffDays(date, w.date) > maxAgeDays) continue;
    if (!best || w.date > best.date) best = w;
  }
  return best ? best.value : null;
}

export interface BodyCompInput {
  weights: DatedValue[];
  waists: DatedValue[];
  liftTrend: 'rising' | 'flat' | 'falling' | 'unknown';
  refDate: string;
  goal?: Goal;
}

export interface BodyCompResult {
  avgNow: number | null;
  change2w: number | null;
  change4w: number | null;
  waistChange4w: number | null;
  flags: Flag[];
}

export function evaluateBodyComp(input: BodyCompInput): BodyCompResult {
  const { weights, waists, liftTrend, refDate, goal = 'recomp' } = input;
  const avgNow = avg7(weights, refDate);
  const avg2 = avg7(weights, addDays(refDate, -14));
  const avg4 = avg7(weights, addDays(refDate, -28));
  const waistNow = waistAt(waists, refDate);
  const waist4 = waistAt(waists, addDays(refDate, -28));

  const change2w = avgNow !== null && avg2 !== null ? avgNow - avg2 : null;
  const change4w = avgNow !== null && avg4 !== null ? avgNow - avg4 : null;
  const waistChange4w = waistNow !== null && waist4 !== null ? waistNow - waist4 : null;
  const flags: Flag[] = [];

  if (avgNow === null) {
    flags.push({
      rule: 5,
      area: 'body',
      level: 'info',
      title: `Not enough weigh-ins this week (need ${MIN_WEIGH_INS} of 7 days)`,
      detail: 'Weigh in most mornings so the 7-day average means something.',
    });
    return { avgNow, change2w, change4w, waistChange4w, flags };
  }

  const kg = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} kg`;
  const cm = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} cm`;

  if (goal === 'recomp') {
    if (change2w !== null && change2w < -0.5) {
      flags.push({ rule: 6, area: 'body', level: 'warn', title: `Weight ${kg(change2w)} in 2 weeks`, detail: 'Recomp runs at maintenance. Add one carb portion at dinner (about +200 kcal/day).', kcalDelta: ADD_CARBS_KCAL });
    } else if (change4w !== null && change4w > 0.5 && waistChange4w !== null && waistChange4w > 0.5) {
      flags.push({ rule: 8, area: 'body', level: 'warn', title: `Weight ${kg(change4w)} and waist ${cm(waistChange4w)} in 4 weeks`, detail: 'Trim the dinner carb portion slightly (about −150 kcal/day). Keep every meal and the protein target.', kcalDelta: TRIM_CARBS_KCAL });
    } else if (change4w !== null && Math.abs(change4w) <= 0.5 && waistChange4w !== null && waistChange4w <= 0.5 && liftTrend === 'rising') {
      flags.push({ rule: 7, area: 'body', level: 'good', title: 'On track: change nothing', detail: 'Weight steady, waist steady or down, lifts going up. That is a working recomp.' });
    }
  } else if (goal === 'lean-bulk') {
    // target roughly +0.25 to +0.5 kg per month
    if (change4w !== null && change4w < 0.2) {
      flags.push({ rule: 6, area: 'body', level: 'warn', title: `Weight ${kg(change4w)} in 4 weeks: not gaining`, detail: 'Add one carb portion a day (about +200 kcal/day).', kcalDelta: ADD_CARBS_KCAL });
    } else if (change4w !== null && (change4w > 1.0 || (waistChange4w !== null && waistChange4w > 1.0))) {
      flags.push({ rule: 8, area: 'body', level: 'warn', title: `Gaining fast: weight ${kg(change4w)}${waistChange4w !== null ? `, waist ${cm(waistChange4w)}` : ''} in 4 weeks`, detail: 'Slow it down: trim one carb portion slightly (about −150 kcal/day).', kcalDelta: TRIM_CARBS_KCAL });
    } else if (change4w !== null && liftTrend !== 'falling') {
      flags.push({ rule: 7, area: 'body', level: 'good', title: 'On track: change nothing', detail: 'Gaining slowly while lifts hold or rise. That is a lean bulk.' });
    }
  } else {
    // cut: target roughly −0.25 to −0.75 kg per week
    if (change2w !== null && change2w > -0.2) {
      flags.push({ rule: 8, area: 'body', level: 'warn', title: `Weight ${kg(change2w)} in 2 weeks: not losing`, detail: 'Trim one carb portion (about −150 kcal/day). Keep every meal and the protein target.', kcalDelta: TRIM_CARBS_KCAL });
    } else if (change2w !== null && change2w < -1.5) {
      flags.push({ rule: 6, area: 'body', level: 'warn', title: `Weight ${kg(change2w)} in 2 weeks: too fast`, detail: 'Losing this fast costs muscle. Add one carb portion back (about +200 kcal/day).', kcalDelta: ADD_CARBS_KCAL });
    } else if (change2w !== null && liftTrend !== 'falling') {
      flags.push({ rule: 7, area: 'body', level: 'good', title: 'On track: change nothing', detail: 'Losing at a sustainable pace with lifts holding.' });
    }
  }
  if (waistNow === null) {
    flags.push({ rule: 7, area: 'body', level: 'info', title: 'Log your waist this week', detail: 'Waist is the second half of the body-composition check.' });
  }

  return { avgNow, change2w, change4w, waistChange4w, flags: flags.map((f) => enforceRule9(f, maxDeficit(goal))) };
}

/** Rule 9 — hard ceiling on any suggested deficit. Applied to every body flag. */
export function enforceRule9(flag: Flag, cap = MAX_DEFICIT_KCAL): Flag {
  if (flag.kcalDelta !== undefined && flag.kcalDelta < -cap) {
    return { ...flag, kcalDelta: -cap };
  }
  return flag;
}
