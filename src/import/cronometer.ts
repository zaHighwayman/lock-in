// Cronometer "Daily Nutrition" CSV export → one day-total food entry per day.
import type { FoodLogEntry } from '../core/model';
import { parseCsv, parseDate } from './csv';

export interface CronometerDay {
  date: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  sodiumMg: number;
}

const n = (s: string | undefined) => {
  const v = Number((s ?? '').replace(',', '.').trim());
  return Number.isFinite(v) ? v : 0;
};

/** Column headers look like "Energy (kcal)", "Protein (g)", "Carbs (g)", "Net Carbs (g)", "Fat (g)", "Sodium (mg)". */
export function parseCronometerDaily(text: string): { days: CronometerDay[]; missing: string[] } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { days: [], missing: ['data rows'] };
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const find = (re: RegExp) => h.findIndex((x) => re.test(x));
  const col = {
    date: find(/^(date|day)\b/),
    kcal: find(/^energy\b.*kcal|^calories\b/),
    protein: find(/^protein\b/),
    carbs: find(/^(carbs|carbohydrates)\b/), // not "net carbs"
    fat: find(/^fat\b/),
    sodium: find(/^sodium\b/),
  };
  const missing = Object.entries(col).filter(([, i]) => i < 0).map(([k]) => k);
  if (col.date < 0 || col.kcal < 0) return { days: [], missing };
  const days: CronometerDay[] = [];
  for (const r of rows.slice(1)) {
    const date = parseDate(r[col.date] ?? '');
    if (!date) continue;
    const day = {
      date,
      kcal: n(r[col.kcal]),
      protein: col.protein >= 0 ? n(r[col.protein]) : 0,
      carbs: col.carbs >= 0 ? n(r[col.carbs]) : 0,
      fat: col.fat >= 0 ? n(r[col.fat]) : 0,
      sodiumMg: col.sodium >= 0 ? n(r[col.sodium]) : 0,
    };
    if (day.kcal > 0 || day.protein > 0) days.push(day);
  }
  return { days, missing };
}

/** Same id as the Apple Health route, so a day is never counted twice. */
export function cronometerEntry(d: CronometerDay): Omit<FoodLogEntry, 'updatedAt'> {
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    id: `cronometer-${d.date}`,
    date: d.date,
    slot: 'snack',
    name: 'Cronometer (day total)',
    nutrients: { kcal: Math.round(d.kcal), protein: r(d.protein), carbs: r(d.carbs), fat: r(d.fat), sodiumMg: Math.round(d.sodiumMg) },
    source: 'cronometer',
  };
}
