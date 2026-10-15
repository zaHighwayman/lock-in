// App-level operations that touch several tables. UI calls these; rules stay pure in core/.
import { buildWeek, exerciseHistories, type CoachData } from '../core/coach/weekly';
import { addDays, today, weekStart } from '../core/dates';
import type {
  Exercise, FoodLogEntry, MealPrepBatch, MealSlot, Nutrients, ProgramDay, ProgramItem, Recipe, SetLog, Settings, WorkoutSession,
} from '../core/model';
import { isDeloadWeek, prefill, suggestNext, type ExerciseSession, type Target } from '../core/rules/lifting';
import { perPortion, roundN } from '../core/rules/nutrition';
import { save, saveMany, patch, remove, uid } from '../db/repo';
import { withDefaults } from '../db/seed';
import { db } from '../db/schema';

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('settings');
  if (!s) throw new Error('Settings missing');
  return withDefaults(s);
}

export function targetFor(item: Pick<ProgramItem, 'sets' | 'repMin' | 'repMax'>, ex: Exercise): Target {
  return { sets: item.sets, repMin: item.repMin, repMax: item.repMax, increment: ex.increment || 0 };
}

/** History of one exercise, excluding a given session (the one being logged). */
export async function historyFor(exerciseId: string, excludeSessionId?: string): Promise<ExerciseSession[]> {
  const sets = (await db.sets.where('exerciseId').equals(exerciseId).toArray()).filter((s) => s.sessionId !== excludeSessionId);
  const sessionIds = [...new Set(sets.map((s) => s.sessionId))];
  const sessions = (await db.sessions.bulkGet(sessionIds)).filter((s): s is WorkoutSession => !!s);
  return exerciseHistories(sessions, sets).get(exerciseId) ?? [];
}

export function sessionTitle(day?: ProgramDay) {
  return day?.name ?? 'Workout';
}

/** Start (or resume) today's session for a program day, pre-filled from the progression rules. */
export async function startSession(day: ProgramDay | null, date = today()): Promise<string> {
  const open = (await db.sessions.where('date').equals(date).toArray()).find((s) => !s.endedAt && (s.programDayId ?? null) === (day?.id ?? null));
  if (open) return open.id;

  const settings = await getSettings();
  if (!settings.programStartDate) await save('settings', { ...settings, programStartDate: weekStart(date) });
  const startDate = settings.programStartDate ?? weekStart(date);
  const deload = isDeloadWeek(startDate, date, settings.deloadEvery);

  const session: WorkoutSession = { id: uid(), updatedAt: 0, date, programDayId: day?.id, name: sessionTitle(day ?? undefined), startedAt: Date.now(), isDeload: deload };
  await save('sessions', session);

  const rows: SetLog[] = [];
  const items = day?.items ?? [];
  for (let order = 0; order < items.length; order++) {
    const item = items[order];
    const ex = await db.exercises.get(item.exerciseId);
    if (!ex) continue;
    rows.push(...(await plannedRows(session, ex, item, order, deload)));
  }
  await saveMany('sets', rows);
  return session.id;
}

async function plannedRows(session: WorkoutSession, ex: Exercise, item: Pick<ProgramItem, 'sets' | 'repMin' | 'repMax'>, order: number, deload: boolean): Promise<SetLog[]> {
  const hist = await historyFor(ex.id, session.id);
  const plan = prefill(hist, targetFor(item, ex), deload);
  return plan.sets.map((p, i) => ({
    id: uid(), updatedAt: 0, sessionId: session.id, exerciseId: ex.id, date: session.date, order, setNo: i + 1,
    weight: p.weight, reps: p.reps, done: false, plannedWeight: p.weight, plannedReps: p.reps,
  }));
}

export async function suggestionFor(ex: Exercise, item: Pick<ProgramItem, 'sets' | 'repMin' | 'repMax'>, sessionId: string, deload: boolean) {
  const hist = await historyFor(ex.id, sessionId);
  return { suggestion: prefill(hist, targetFor(item, ex), deload).suggestion, last: hist[hist.length - 1] ?? null, raw: suggestNext(hist, targetFor(item, ex)) };
}

/** Swap an exercise in a session for another (alternative or any exercise), re-planning its sets. */
export async function swapExercise(session: WorkoutSession, order: number, fromId: string, toId: string, item: Pick<ProgramItem, 'sets' | 'repMin' | 'repMax'>) {
  const old = (await db.sets.where('sessionId').equals(session.id).toArray()).filter((s) => s.order === order && s.exerciseId === fromId);
  const ex = await db.exercises.get(toId);
  if (!ex) return;
  await remove('sets', old.filter((s) => !s.done).map((s) => s.id));
  const rows = await plannedRows(session, ex, { sets: Math.max(1, old.filter((s) => !s.done).length || item.sets), repMin: ex.repMin, repMax: ex.repMax }, order, !!session.isDeload);
  await saveMany('sets', rows);
}

export async function addExerciseToSession(session: WorkoutSession, exerciseId: string) {
  const ex = await db.exercises.get(exerciseId);
  if (!ex) return;
  const existing = await db.sets.where('sessionId').equals(session.id).toArray();
  const order = existing.length ? Math.max(...existing.map((s) => s.order)) + 1 : 0;
  await saveMany('sets', await plannedRows(session, ex, { sets: 3, repMin: ex.repMin, repMax: ex.repMax }, order, !!session.isDeload));
}

export async function addSet(session: WorkoutSession, exerciseId: string, order: number) {
  const rows = (await db.sets.where('sessionId').equals(session.id).toArray()).filter((s) => s.order === order && s.exerciseId === exerciseId);
  const last = rows.sort((a, b) => a.setNo - b.setNo)[rows.length - 1];
  await save('sets', {
    id: uid(), sessionId: session.id, exerciseId, date: session.date, order, setNo: (last?.setNo ?? 0) + 1,
    weight: last?.weight ?? 0, reps: last?.reps ?? 8, done: false, plannedWeight: last?.plannedWeight, plannedReps: last?.plannedReps,
  });
}

export async function finishSession(session: WorkoutSession, notes?: string) {
  const undone = (await db.sets.where('sessionId').equals(session.id).toArray()).filter((s) => !s.done);
  await remove('sets', undone.map((s) => s.id));
  await patch('sessions', session.id, { endedAt: Date.now(), notes });
}

export async function deleteSession(id: string) {
  const sets = await db.sets.where('sessionId').equals(id).toArray();
  await remove('sets', sets.map((s) => s.id));
  await remove('sessions', id);
}

// ---------- food ----------

export async function logFood(entry: Omit<FoodLogEntry, 'id' | 'updatedAt'>) {
  return save('foodLog', { ...entry, id: uid(), nutrients: roundN(entry.nutrients) });
}

export function defaultSlot(): MealSlot {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 14) return 'lunch';
  if (h < 17) return 'snack';
  if (h < 20) return 'dinner';
  return 'evening';
}

export async function cookBatch(recipe: Recipe, portions: number, frozen: number, date = today()) {
  return save('batches', {
    id: uid(), recipeId: recipe.id, recipeName: recipe.name, cookedOn: date, portionsMade: portions,
    portionsFrozen: frozen, portionsEaten: 0, perPortion: perPortion(recipe), storage: recipe.freezerFriendly && frozen > 0 ? 'freezer' : 'fridge',
  });
}

/** Eat one portion from a batch and log it. */
export async function eatFromBatch(batch: MealPrepBatch, date = today(), slot: MealSlot = 'dinner') {
  await patch('batches', batch.id, { portionsEaten: Math.min(batch.portionsMade, batch.portionsEaten + 1) });
  await logFood({ date, slot, name: batch.recipeName, nutrients: batch.perPortion, ref: { kind: 'batch', id: batch.id } });
}

export async function logRecipePortion(recipe: Recipe, date = today(), slot: MealSlot = 'dinner', portions = 1) {
  const n = perPortion(recipe);
  const scaled: Nutrients = { kcal: n.kcal * portions, protein: n.protein * portions, carbs: n.carbs * portions, fat: n.fat * portions, sodiumMg: n.sodiumMg * portions };
  await logFood({ date, slot, name: portions === 1 ? recipe.name : `${recipe.name} × ${portions}`, nutrients: scaled, ref: { kind: 'recipe', id: recipe.id } });
}

// ---------- coach data ----------

export async function loadCoachData(sinceDays = 70): Promise<CoachData> {
  const from = addDays(today(), -sinceDays);
  const [settings, exercises, sessions, sets, runs, body, sleep, food, activity] = await Promise.all([
    getSettings(),
    db.exercises.toArray(),
    db.sessions.where('date').aboveOrEqual(from).toArray(),
    db.sets.where('date').aboveOrEqual(from).toArray(),
    db.runs.where('date').aboveOrEqual(from).toArray(),
    db.body.where('date').aboveOrEqual(from).toArray(),
    db.sleep.where('date').aboveOrEqual(from).toArray(),
    db.foodLog.where('date').aboveOrEqual(from).toArray(),
    db.activity.where('date').aboveOrEqual(from).toArray(),
  ]);
  return { settings, exercises, sessions, sets, runs, body, sleep, food, activity };
}

export async function weekFlags(refDate = today()) {
  return buildWeek(await loadCoachData(), refDate);
}

export async function programSummary(): Promise<string> {
  const [days, exs] = await Promise.all([db.programDays.toArray(), db.exercises.toArray()]);
  const name = new Map(exs.map((e) => [e.id, e.name]));
  return days
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => `${d.name}: ${d.items.map((i) => `${name.get(i.exerciseId)} ${i.sets}×${i.repMax === null ? 'AMRAP' : `${i.repMin}–${i.repMax}`}${i.optional ? ' (optional)' : ''}`).join(', ')}`)
    .join('\n');
}
