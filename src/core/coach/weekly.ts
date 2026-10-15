// Runs every rule for one week and builds the compact, aggregated JSON the LLM sees.
import { addDays, programWeek, weekStart as wkStart } from '../dates';
import type { BodyMetric, Exercise, Flag, FoodLogEntry, Run, SetLog, Settings, SleepRecovery, WorkoutSession } from '../model';
import { avg7, evaluateBodyComp } from '../rules/bodycomp';
import {
  detectStall, dropShare, isDeloadWeek, liftTrend, sessionScore, stallFlag, suggestNext,
  type ExerciseSession,
} from '../rules/lifting';
import { dayTotals, proteinTarget } from '../rules/nutrition';
import { burnoutFlag, recoveryFlag, sleepCheck, baseline } from '../rules/recovery';
import { benchmarkStatus, nextEasyKm, nextIntervals, runBalance, time4k } from '../rules/running';

export interface CoachData {
  settings: Settings;
  exercises: Exercise[];
  sessions: WorkoutSession[];
  sets: SetLog[];
  runs: Run[];
  body: BodyMetric[];
  sleep: SleepRecovery[];
  food: FoodLogEntry[];
}

/** Group completed sets by exercise into per-session histories, oldest first. */
export function exerciseHistories(sessions: WorkoutSession[], sets: SetLog[]): Map<string, ExerciseSession[]> {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const byEx = new Map<string, Map<string, ExerciseSession>>();
  for (const s of sets) {
    if (!s.done) continue;
    const sess = sessionById.get(s.sessionId);
    if (!sess) continue;
    let m = byEx.get(s.exerciseId);
    if (!m) byEx.set(s.exerciseId, (m = new Map()));
    let es = m.get(s.sessionId);
    if (!es) m.set(s.sessionId, (es = { date: sess.date, isDeload: sess.isDeload, sets: [] }));
    es.sets.push({ weight: s.weight, reps: s.reps });
  }
  const out = new Map<string, ExerciseSession[]>();
  for (const [ex, m] of byEx) out.set(ex, [...m.values()].sort((a, b) => a.date.localeCompare(b.date)));
  return out;
}

const r1 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

export function buildWeek(data: CoachData, refDate: string) {
  const { settings } = data;
  const ws = wkStart(refDate);
  const we = addDays(ws, 6);
  const inWeek = (d: string) => d >= ws && d <= we;
  const flags: Flag[] = [];
  const exName = new Map(data.exercises.map((e) => [e.id, e.name]));
  const histories = exerciseHistories(data.sessions, data.sets);
  const histList = [...histories.values()];

  // Program / deload
  const week = settings.programStartDate ? programWeek(settings.programStartDate, refDate) : null;
  const deloadNow = isDeloadWeek(settings.programStartDate, refDate, settings.deloadEvery);
  const deloadNext = isDeloadWeek(settings.programStartDate, addDays(refDate, 7), settings.deloadEvery);
  if (deloadNext) {
    flags.push({ rule: 3, area: 'program', level: 'info', title: 'Next week is a deload', detail: 'Same exercises, half the sets, ~10 % lighter, easy runs only.' });
  }

  // Lifting
  const weekSessions = data.sessions.filter((s) => inWeek(s.date) && s.endedAt);
  const lifts: { exercise: string; best: string; next: string; stalled: boolean; pr: boolean }[] = [];
  let progressions = 0;
  for (const [exId, h] of histories) {
    const thisWeek = h.filter((s) => inWeek(s.date));
    if (thisWeek.length === 0) continue;
    const before = h.filter((s) => s.date < ws);
    const ex = data.exercises.find((e) => e.id === exId);
    const target = { sets: 3, repMin: ex?.repMin ?? 8, repMax: ex?.repMax ?? 12, increment: ex?.increment ?? 2.5 };
    const next = suggestNext(h, target);
    if (next.kind === 'increase' || next.kind === 'add-load') progressions++;
    const stalled = detectStall(h);
    if (stalled) flags.push(stallFlag(exName.get(exId) ?? 'Exercise'));
    const bestNow = Math.max(...thisWeek.map(sessionScore));
    const bestBefore = before.length ? Math.max(...before.map(sessionScore)) : 0;
    const top = thisWeek[thisWeek.length - 1].sets;
    lifts.push({
      exercise: exName.get(exId) ?? exId,
      best: top.map((s) => `${s.weight}×${s.reps}`).join(', '),
      next: next.message,
      stalled,
      pr: before.length > 0 && bestNow > bestBefore,
    });
  }
  const trend = liftTrend(histList, refDate);
  const dropNow = dropShare(histList, refDate);
  const dropPrev = dropShare(histList, addDays(refDate, -7));

  // Body
  const weights = data.body.filter((b) => b.weightKg !== undefined).map((b) => ({ date: b.date, value: b.weightKg! }));
  const waists = data.body.filter((b) => b.waistCm !== undefined).map((b) => ({ date: b.date, value: b.waistCm! }));
  const bc = evaluateBodyComp({ weights, waists, liftTrend: trend, refDate, goal: settings.goal });
  flags.push(...bc.flags);

  // Recovery
  const rec = recoveryFlag(data.sleep, refDate);
  if (rec) flags.push(rec);
  const sleep = sleepCheck(data.sleep, refDate);
  flags.push(...sleep.flags);
  const burn = burnoutFlag(dropNow, dropPrev, [...(rec ? [rec] : []), ...sleep.flags]);
  if (burn) flags.push(burn);
  const hrB = baseline(data.sleep, addDays(refDate, 1), 'restingHr');
  const hrvB = baseline(data.sleep, addDays(refDate, 1), 'hrv');

  // Running
  const balance = runBalance(data.runs, ws);
  flags.push(...balance.flags);
  const iv = nextIntervals(data.runs, refDate);
  const bench = benchmarkStatus(data.runs);
  const weekRuns = data.runs.filter((r) => inWeek(r.date));
  const easyKm = nextEasyKm(data.runs, week ?? 1, !!rec);

  // Nutrition (estimated)
  const weekFood = data.food.filter((f) => inWeek(f.date));
  const days = [...new Set(weekFood.map((f) => f.date))];
  const avgWeight = avg7(weights, refDate) ?? weights[weights.length - 1]?.value ?? null;
  const pTarget = avgWeight ? proteinTarget(avgWeight, settings.proteinGPerKg) : null;
  const dayTot = days.map((d) => dayTotals(weekFood.filter((f) => f.date === d)));
  const avgOf = (k: 'protein' | 'kcal' | 'sodiumMg') => (dayTot.length ? Math.round(dayTot.reduce((a, t) => a + t[k], 0) / dayTot.length) : null);

  const input = {
    week: { start: ws, end: we, programWeek: week, deload: deloadNow, deloadNext, goal: settings.goal },
    lifting: {
      sessions: weekSessions.map((s) => s.name),
      progressionsEarned: progressions,
      trend,
      shareOfLiftsDropping: dropNow === null ? null : Math.round(dropNow * 100) / 100,
      lifts,
    },
    running: {
      runs: weekRuns.map((r) => ({ type: r.type, km: r.distanceKm, time: Math.round(r.durationSec), intervals: r.intervals ?? null })),
      hardRuns: balance.hard,
      hardTimeShare: balance.hardShare === null ? null : Math.round(balance.hardShare * 100) / 100,
      benchmark4k: { lastSec: r1(bench.last), bestSec: r1(bench.best), targetSec: bench.target, count: bench.count },
      thisWeekBenchmark: weekRuns.filter((r) => r.type === 'benchmark').map((r) => Math.round(time4k(r))),
      nextIntervals: iv?.message ?? null,
      nextEasyKm: easyKm,
    },
    body: {
      weight7dAvg: r1(bc.avgNow),
      change2wKg: r1(bc.change2w),
      change4wKg: r1(bc.change4w),
      waistChange4wCm: r1(bc.waistChange4w),
    },
    recovery: {
      avgSleepMin: sleep.avgSleep === null ? null : Math.round(sleep.avgSleep),
      bedtimeSdMin: sleep.bedSd === null ? null : Math.round(sleep.bedSd),
      restingHrBaseline: r1(hrB?.mean),
      hrvBaseline: r1(hrvB?.mean),
    },
    nutrition: {
      daysLogged: days.length,
      avgProteinG: avgOf('protein'),
      proteinTargetG: pTarget,
      avgKcalEstimate: avgOf('kcal'),
      avgSaltG: avgOf('sodiumMg') === null ? null : r1(avgOf('sodiumMg')! / 400),
      saltLimitG: settings.sodiumCeilingMg ? r1(settings.sodiumCeilingMg / 400) : null,
    },
    flags: flags.map((f) => ({ rule: f.rule, level: f.level, title: f.title, detail: f.detail, kcalDelta: f.kcalDelta })),
  };

  return { weekStart: ws, flags, input };
}

export type WeeklyInput = ReturnType<typeof buildWeek>['input'];
