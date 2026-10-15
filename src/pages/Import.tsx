// CSV import: detect Strong/Hevy (or map columns), match exercise names, preview, then write.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SetLog, WorkoutSession } from '../core/model';
import { save, saveMany, uid } from '../db/repo';
import { db } from '../db/schema';
import { detectFormat, guessMapping, parseCsv, toSets, type CsvFormat, type GenericMapping, type ImportedSet } from '../import/csv';
import { cronometerEntry, parseCronometerDaily } from '../import/cronometer';
import { Button, Card, ErrorNote, Field, Page, cx, inputCls } from '../ui/kit';

const NEW = '__new__';
const SKIP = '__skip__';

function normalise(name: string) {
  return name.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-zäöå0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function ImportPage() {
  const nav = useNavigate();
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []) ?? [];
  const aliases = useLiveQuery(() => db.aliases.toArray(), []) ?? [];
  const [rows, setRows] = useState<string[][] | null>(null);
  const [format, setFormat] = useState<CsvFormat>('generic');
  const [mapping, setMapping] = useState<Partial<GenericMapping>>({});
  const [match, setMatch] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const ready = format !== 'generic' || (mapping.date !== undefined && mapping.exercise !== undefined && mapping.weight !== undefined && mapping.reps !== undefined);
  const parsed = rows && ready ? toSets(rows, format, mapping as GenericMapping) : null;
  const names = parsed ? [...new Set(parsed.sets.map((s) => s.exercise))] : [];

  function autoMatch(list: string[]) {
    const m: Record<string, string> = {};
    for (const n of list) {
      const alias = aliases.find((a) => a.id === n.toLowerCase());
      const byName = exercises.find((e) => normalise(e.name) === normalise(n)) ?? exercises.find((e) => normalise(n).includes(normalise(e.name)));
      m[n] = alias?.exerciseId ?? byName?.id ?? NEW;
    }
    setMatch(m);
  }

  async function load(file: File) {
    setError(null);
    setDone(null);
    const r = parseCsv(await file.text());
    if (r.length < 2) return setError('The file has no data rows.');
    const f = detectFormat(r[0]);
    setRows(r);
    setFormat(f);
    const g = guessMapping(r[0]);
    setMapping(g);
    const p = f !== 'generic' || (g.date !== undefined && g.exercise !== undefined && g.weight !== undefined && g.reps !== undefined) ? toSets(r, f, g as GenericMapping) : null;
    if (p) autoMatch([...new Set(p.sets.map((s) => s.exercise))]);
  }

  async function write() {
    if (!parsed) return;
    // create exercises for unmatched names
    const idFor: Record<string, string> = {};
    for (const n of names) {
      const target = match[n] ?? NEW;
      if (target === SKIP) continue;
      if (target === NEW) {
        const id = uid();
        await save('exercises', { id, name: n.replace(/\s*\(.*?\)\s*/g, ' ').trim(), muscleGroup: 'chest', kind: 'isolation', loadType: 'dumbbell', repMin: 8, repMax: 12, increment: 2, restSec: 90 });
        idFor[n] = id;
      } else idFor[n] = target;
      await save('aliases', { id: n.toLowerCase(), exerciseId: idFor[n] });
    }
    // group into sessions by date + workout name
    const groups = new Map<string, ImportedSet[]>();
    for (const s of parsed.sets) {
      if (!idFor[s.exercise]) continue;
      const k = `${s.date}|${s.workout}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s);
    }
    const existing = await db.sessions.toArray();
    let sessions = 0;
    let sets = 0;
    for (const [k, list] of groups) {
      const [date, workout] = k.split('|');
      if (existing.some((e) => e.date === date && e.name === workout)) continue; // already imported
      const session: WorkoutSession = { id: uid(), updatedAt: 0, date, name: workout, startedAt: Date.parse(`${date}T15:00:00`), endedAt: Date.parse(`${date}T16:00:00`), notes: 'Imported' };
      await save('sessions', session);
      const order = new Map<string, number>();
      const rowsOut: SetLog[] = list.map((s) => {
        if (!order.has(s.exercise)) order.set(s.exercise, order.size);
        return { id: uid(), updatedAt: 0, sessionId: session.id, exerciseId: idFor[s.exercise], date, order: order.get(s.exercise)!, setNo: s.setNo, weight: s.weight, reps: s.reps, rir: s.rir, done: true };
      });
      await saveMany('sets', rowsOut);
      sessions++;
      sets += rowsOut.length;
    }
    setDone(`Imported ${sessions} sessions and ${sets} sets.`);
    setRows(null);
  }

  return (
    <Page title="Import" back={() => nav(-1)}>
      <Card>
        <p className="mb-3 text-sm text-muted">Strong and Hevy exports are detected automatically. Any other CSV works if it has date, exercise, weight and reps columns (a notebook typed into a spreadsheet is fine).</p>
        <label>
          <span className="inline-flex w-full cursor-pointer justify-center rounded-xl bg-accent px-4 py-3 font-medium text-accent-ink">Choose CSV file</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        <ErrorNote error={error} />
        {done && <p className="mt-3 text-sm text-good">{done}</p>}
      </Card>

      {rows && (
        <Card title={`Detected: ${format === 'generic' ? 'custom CSV' : format}`}>
          {format === 'generic' && (
            <div className="grid grid-cols-2 gap-2">
              {(['date', 'exercise', 'weight', 'reps', 'workout'] as const).map((k) => (
                <Field key={k} label={k === 'workout' ? 'workout name (optional)' : k}>
                  <select
                    className={inputCls}
                    value={mapping[k] ?? ''}
                    onChange={(e) => {
                      const next = { ...mapping, [k]: e.target.value === '' ? undefined : Number(e.target.value) };
                      setMapping(next);
                      if (next.date !== undefined && next.exercise !== undefined && next.weight !== undefined && next.reps !== undefined) {
                        autoMatch([...new Set(toSets(rows, 'generic', next as GenericMapping).sets.map((s) => s.exercise))]);
                      }
                    }}
                  >
                    <option value="">–</option>
                    {rows[0].map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          )}
          {parsed && (
            <>
              <p className="mb-3 text-sm text-muted">
                {parsed.sets.length} sets on {new Set(parsed.sets.map((s) => s.date)).size} days · {parsed.skipped} rows skipped (warm-ups, rest timers, empty)
              </p>
              <div className="mb-1 text-sm font-medium">Match exercises</div>
              <ul className="mb-3 space-y-2">
                {names.map((n) => (
                  <li key={n} className="flex items-center gap-2">
                    <span className="w-1/2 truncate text-sm">{n}</span>
                    <select className={cx(inputCls, 'w-1/2 py-1.5 text-sm')} value={match[n] ?? NEW} onChange={(e) => setMatch({ ...match, [n]: e.target.value })}>
                      <option value={NEW}>+ Create new</option>
                      <option value={SKIP}>Skip</option>
                      {exercises.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <Button variant="primary" className="w-full" onClick={write} disabled={parsed.sets.length === 0}>
                Import
              </Button>
            </>
          )}
        </Card>
      )}
      <CronometerImport />
    </Page>
  );
}

function CronometerImport() {
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Cronometer history">
      <p className="mb-3 text-sm text-muted">
        On cronometer.com: Settings → Account → <b>Export Data</b> → <b>Daily Nutrition</b>. Each day becomes one "Cronometer (day total)" entry, the same one the Apple Health Shortcut updates, so days are never counted twice.
      </p>
      <label>
        <span className="inline-flex w-full cursor-pointer justify-center rounded-xl border border-line bg-surface-2 px-4 py-2.5 font-medium">Choose Daily Nutrition CSV</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setError(null);
            setMsg(null);
            const { days, missing } = parseCronometerDaily(await f.text());
            if (days.length === 0) return setError(`No days found${missing.length ? ` (missing columns: ${missing.join(', ')})` : ''}. Is this the Daily Nutrition export?`);
            await saveMany('foodLog', days.map(cronometerEntry));
            setMsg(`Imported ${days.length} days (${days[0].date} – ${days[days.length - 1].date}).${missing.length ? ` Not in file: ${missing.join(', ')}.` : ''}`);
          }}
        />
      </label>
      {msg && <p className="mt-2 text-sm text-good">{msg}</p>}
      <ErrorNote error={error} />
    </Card>
  );
}
