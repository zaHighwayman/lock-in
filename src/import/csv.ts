// CSV import for Strong, Hevy, or any CSV with date/exercise/weight/reps columns.

export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export interface ImportedSet {
  date: string;
  workout: string;
  exercise: string;
  setNo: number;
  weight: number;
  reps: number;
  rir?: number;
}

export type CsvFormat = 'strong' | 'hevy' | 'generic';

export interface GenericMapping {
  date: number;
  exercise: number;
  weight: number;
  reps: number;
  workout?: number;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Accepts "2024-01-15 17:30:00", "15 Jan 2024, 17:30", "15.1.2024", "1/15/2024". */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

const num = (s: string | undefined) => {
  const n = Number((s ?? '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : 0;
};

export function detectFormat(header: string[]): CsvFormat {
  const h = header.map((x) => x.trim().toLowerCase());
  if (h.includes('exercise name') && h.includes('set order')) return 'strong';
  if (h.includes('exercise_title') && h.includes('set_index')) return 'hevy';
  return 'generic';
}

export function guessMapping(header: string[]): Partial<GenericMapping> {
  const h = header.map((x) => x.trim().toLowerCase());
  const find = (...names: string[]) => {
    const i = h.findIndex((x) => names.some((n) => x === n || x.includes(n)));
    return i >= 0 ? i : undefined;
  };
  return {
    date: find('date', 'päivä', 'start_time'),
    exercise: find('exercise', 'liike'),
    weight: find('weight', 'kg', 'paino'),
    reps: find('reps', 'toistot'),
    workout: find('workout', 'title', 'treeni'),
  };
}

export function toSets(rows: string[][], format: CsvFormat, mapping?: GenericMapping): { sets: ImportedSet[]; skipped: number } {
  const [header, ...data] = rows;
  const h = header.map((x) => x.trim().toLowerCase());
  const col = (name: string) => h.indexOf(name);
  const sets: ImportedSet[] = [];
  let skipped = 0;

  for (const r of data) {
    let s: ImportedSet | null = null;
    if (format === 'strong') {
      const date = parseDate(r[col('date')] ?? '');
      const reps = num(r[col('reps')]);
      let weight = num(r[col('weight')]);
      const unit = col('weight unit') >= 0 ? r[col('weight unit')]?.trim().toLowerCase() : 'kg';
      if (unit === 'lbs') weight = weight * 0.45359237;
      const setOrder = r[col('set order')] ?? '';
      if (date && reps > 0 && /^\d+$/.test(setOrder.trim())) {
        const rpe = num(r[col('rpe')]);
        s = { date, workout: r[col('workout name')] ?? 'Workout', exercise: r[col('exercise name')] ?? '', setNo: Number(setOrder), weight, reps, rir: rpe ? Math.max(0, 10 - rpe) : undefined };
      }
    } else if (format === 'hevy') {
      const date = parseDate(r[col('start_time')] ?? '');
      const reps = num(r[col('reps')]);
      const kg = col('weight_kg') >= 0 ? num(r[col('weight_kg')]) : num(r[col('weight_lbs')]) * 0.45359237;
      const type = (r[col('set_type')] ?? '').toLowerCase();
      if (date && reps > 0 && type !== 'warmup') {
        const rpe = num(r[col('rpe')]);
        s = { date, workout: r[col('title')] ?? 'Workout', exercise: r[col('exercise_title')] ?? '', setNo: num(r[col('set_index')]) + 1, weight: kg, reps, rir: rpe ? Math.max(0, 10 - rpe) : undefined };
      }
    } else if (mapping) {
      const date = parseDate(r[mapping.date] ?? '');
      const reps = num(r[mapping.reps]);
      if (date && reps > 0) s = { date, workout: mapping.workout !== undefined ? r[mapping.workout] || 'Workout' : 'Workout', exercise: r[mapping.exercise] ?? '', setNo: 0, weight: num(r[mapping.weight]), reps };
    }
    if (s && s.exercise.trim()) sets.push({ ...s, weight: Math.round(s.weight * 100) / 100, exercise: s.exercise.trim() });
    else skipped++;
  }

  // number generic sets per date+exercise
  if (format === 'generic') {
    const counter = new Map<string, number>();
    for (const s of sets) {
      const k = `${s.date}|${s.workout}|${s.exercise}`;
      const n = (counter.get(k) ?? 0) + 1;
      counter.set(k, n);
      s.setNo = n;
    }
  }
  return { sets, skipped };
}
