// Export / restore. Everything you log can leave the app as JSON or CSV.
import { today } from '../core/dates';
import { db, SYNCED_TABLES, type SyncedTable } from '../db/schema';
import { save } from '../db/repo';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tbl = (name: SyncedTable) => (db as any)[name] as import('dexie').Table<any, string>;

async function deliver(name: string, blob: Blob) {
  const file = new File([blob], name, { type: blob.type });
  // iOS home-screen apps handle the share sheet better than downloads.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportJson() {
  const data: Record<string, unknown[]> = {};
  for (const t of SYNCED_TABLES) data[t] = await tbl(t).toArray();
  const blob = new Blob([JSON.stringify({ app: 'lock-in', version: 1, exportedAt: new Date().toISOString(), data })], { type: 'application/json' });
  await deliver(`lock-in-backup-${today()}.json`, blob);
  const s = await db.settings.get('settings');
  if (s) await save('settings', { ...s, lastExportAt: Date.now() });
}

/** Merge a backup in: newer updatedAt wins, nothing is deleted. */
export async function importJson(file: File): Promise<number> {
  const parsed = JSON.parse(await file.text());
  if (parsed?.app !== 'lock-in' || typeof parsed.data !== 'object') throw new Error('Not a Lock-In backup file.');
  let n = 0;
  for (const t of SYNCED_TABLES) {
    const rows = parsed.data[t];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      if (!r || typeof r.id !== 'string') continue;
      const local = await tbl(t).get(r.id);
      if (!local || (local.updatedAt ?? 0) <= (r.updatedAt ?? 0)) {
        await tbl(t).put({ ...r, updatedAt: r.updatedAt ?? Date.now() });
        n++;
      }
    }
  }
  return n;
}

function csv(rows: (string | number | undefined | null)[][]): string {
  return rows
    .map((r) => r.map((v) => {
      const s = v === undefined || v === null ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');
}

export const CSV_EXPORTS = {
  sets: 'Workout sets',
  runs: 'Runs',
  body: 'Body metrics',
  sleep: 'Sleep & recovery',
  food: 'Food log',
  activity: 'Activity',
} as const;

export async function exportCsv(kind: keyof typeof CSV_EXPORTS) {
  let rows: (string | number | undefined | null)[][] = [];
  if (kind === 'sets') {
    const [sets, sessions, exs] = await Promise.all([db.sets.toArray(), db.sessions.toArray(), db.exercises.toArray()]);
    const sName = new Map(sessions.map((s) => [s.id, s.name]));
    const eName = new Map(exs.map((e) => [e.id, e.name]));
    rows = [['date', 'workout', 'exercise', 'set', 'weight_kg', 'reps', 'rir'], ...sets.filter((s) => s.done).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.setNo - b.setNo).map((s) => [s.date, sName.get(s.sessionId), eName.get(s.exerciseId), s.setNo, s.weight, s.reps, s.rir])];
  } else if (kind === 'runs') {
    rows = [['date', 'type', 'distance_km', 'duration_sec', 'avg_hr', 'interval_reps', 'interval_m', 'interval_sec', 'notes'], ...(await db.runs.orderBy('date').toArray()).map((r) => [r.date, r.type, r.distanceKm, r.durationSec, r.avgHr, r.intervals?.reps, r.intervals?.workM, r.intervals?.workSec, r.notes])];
  } else if (kind === 'body') {
    rows = [['date', 'weight_kg', 'waist_cm', 'body_fat_pct', 'source'], ...(await db.body.orderBy('date').toArray()).map((b) => [b.date, b.weightKg, b.waistCm, b.bodyFatPct, b.source])];
  } else if (kind === 'sleep') {
    rows = [['date', 'sleep_min', 'bedtime', 'wake', 'resting_hr', 'hrv', 'readiness', 'source'], ...(await db.sleep.orderBy('date').toArray()).map((s) => [s.date, s.sleepMin, s.bedtime, s.wakeTime, s.restingHr, s.hrv, s.readiness, s.source])];
  } else if (kind === 'activity') {
    rows = [['date', 'steps', 'active_kcal', 'distance_km', 'exercise_min', 'flights', 'source'], ...(await db.activity.orderBy('date').toArray()).map((a) => [a.date, a.steps, a.activeKcal, a.distanceKm, a.exerciseMin, a.flights, a.source])];
  } else {
    rows = [['date', 'meal', 'name', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'salt_g'], ...(await db.foodLog.orderBy('date').toArray()).map((f) => [f.date, f.slot, f.name, f.grams, f.nutrients.kcal, f.nutrients.protein, f.nutrients.carbs, f.nutrients.fat, Math.round(f.nutrients.sodiumMg / 4) / 100])];
  }
  await deliver(`lock-in-${kind}-${today()}.csv`, new Blob([csv(rows)], { type: 'text/csv' }));
}
