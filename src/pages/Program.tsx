// Program editor: days, exercises in each day, sets/rep ranges, alternatives, and the exercise library.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WEEKDAYS } from '../core/dates';
import type { Exercise, LoadType, MuscleGroup, ProgramDay, ProgramItem } from '../core/model';
import { remove, save, uid } from '../db/repo';
import { db } from '../db/schema';
import { Button, Card, Field, NumInput, Page, Segmented, Sheet, cx, inputCls } from '../ui/kit';

const GROUPS: MuscleGroup[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core'];
const LOADS: LoadType[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'];

export default function ProgramPage() {
  const nav = useNavigate();
  const [tab, setTab] = useState<'days' | 'exercises'>('days');
  const days = useLiveQuery(() => db.programDays.orderBy('weekday').toArray(), []) ?? [];
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []) ?? [];
  const [editEx, setEditEx] = useState<Exercise | null>(null);

  return (
    <Page title="Program" back={() => nav(-1)}>
      <Segmented className="mb-3" value={tab} onChange={setTab} options={[{ value: 'days', label: 'Days' }, { value: 'exercises', label: 'Exercises' }]} />
      {tab === 'days' && (
        <>
          {days.map((d) => (
            <DayEditor key={d.id} day={d} exercises={exercises} />
          ))}
          <Button
            className="w-full"
            onClick={() => save('programDays', { id: uid(), name: 'New day', weekday: 3, items: [] })}
          >
            + Add day
          </Button>
        </>
      )}
      {tab === 'exercises' && (
        <Card>
          <Button
            className="mb-2 w-full"
            onClick={() => setEditEx({ id: uid(), updatedAt: 0, name: '', muscleGroup: 'chest', kind: 'isolation', loadType: 'dumbbell', repMin: 8, repMax: 12, increment: 2, restSec: 90 })}
          >
            + New exercise
          </Button>
          <ul className="divide-y divide-line">
            {exercises.map((e) => (
              <li key={e.id}>
                <button className={cx('flex w-full items-center justify-between py-2.5 text-left', e.archived && 'opacity-50')} onClick={() => setEditEx(e)}>
                  <div>
                    <div>{e.name}</div>
                    <div className="text-xs text-muted">
                      {e.muscleGroup} · {e.loadType} · {e.repMax === null ? 'AMRAP' : `${e.repMin}–${e.repMax}`} · +{e.increment} kg · rest {e.restSec}s
                    </div>
                  </div>
                  <span className="text-muted">›</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editEx && <ExerciseSheet exercise={editEx} onClose={() => setEditEx(null)} />}
    </Page>
  );
}

function DayEditor({ day, exercises }: { day: ProgramDay; exercises: Exercise[] }) {
  const [open, setOpen] = useState(false);
  const exName = (id: string) => exercises.find((e) => e.id === id)?.name ?? '?';
  const update = (changes: Partial<ProgramDay>) => save('programDays', { ...day, ...changes });
  const setItem = (i: number, changes: Partial<ProgramItem>) => update({ items: day.items.map((it, j) => (j === i ? { ...it, ...changes } : it)) });
  const move = (i: number, dir: -1 | 1) => {
    const items = [...day.items];
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    update({ items });
  };

  return (
    <Card>
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <div>
          <div className="text-xs text-muted">{WEEKDAYS[day.weekday - 1]}</div>
          <div className="font-semibold">{day.name}</div>
          {!open && <div className="mt-0.5 text-xs text-faint">{day.items.map((i) => exName(i.exerciseId)).join(' · ')}</div>}
        </div>
        <span className="text-muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-3">
          <div className="mb-3 flex gap-2">
            <input className={inputCls} value={day.name} onChange={(e) => update({ name: e.target.value })} />
            <select className={cx(inputCls, 'w-24')} value={day.weekday} onChange={(e) => update({ weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((w, i) => (
                <option key={w} value={i + 1}>
                  {w}
                </option>
              ))}
            </select>
          </div>
          <ul className="space-y-2">
            {day.items.map((it, i) => (
              <li key={i} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="mb-2 flex gap-2">
                  <select className={cx(inputCls, 'py-2')} value={it.exerciseId} onChange={(e) => setItem(i, { exerciseId: e.target.value })}>
                    {exercises.filter((e) => !e.archived || e.id === it.exerciseId).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                  <button className="px-2 text-muted" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button className="px-2 text-muted" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted">
                  <label>
                    Sets
                    <NumInput className="mt-1 py-1.5" value={it.sets} onChange={(v) => v && setItem(i, { sets: Math.max(1, Math.round(v)) })} />
                  </label>
                  <label>
                    Reps min
                    <NumInput className="mt-1 py-1.5" value={it.repMin} onChange={(v) => v && setItem(i, { repMin: Math.round(v) })} />
                  </label>
                  <label>
                    Reps max
                    <NumInput className="mt-1 py-1.5" placeholder="AMRAP" value={it.repMax} onChange={(v) => setItem(i, { repMax: v === null ? null : Math.round(v) })} />
                  </label>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <label className="flex items-center gap-2 text-muted">
                    <input type="checkbox" checked={!!it.optional} onChange={(e) => setItem(i, { optional: e.target.checked })} /> Optional
                  </label>
                  <select
                    className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-muted"
                    value=""
                    onChange={(e) => e.target.value && setItem(i, { alternatives: [...new Set([...(it.alternatives ?? []), e.target.value])] })}
                  >
                    <option value="">+ alternative</option>
                    {exercises.filter((e) => e.id !== it.exerciseId).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                  <button className="text-bad" onClick={() => update({ items: day.items.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                </div>
                {(it.alternatives?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {it.alternatives!.map((a) => (
                      <button key={a} className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted" onClick={() => setItem(i, { alternatives: it.alternatives!.filter((x) => x !== a) })}>
                        or {exName(a)} ✕
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                const ex = exercises.find((e) => !e.archived);
                if (ex) update({ items: [...day.items, { exerciseId: ex.id, sets: 3, repMin: ex.repMin, repMax: ex.repMax }] });
              }}
            >
              + Exercise
            </Button>
            <Button variant="danger" onClick={() => confirm(`Delete ${day.name}?`) && remove('programDays', day.id)}>
              Delete day
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ExerciseSheet({ exercise, onClose }: { exercise: Exercise; onClose: () => void }) {
  const [e, setE] = useState(exercise);
  return (
    <Sheet open onClose={onClose} title={exercise.name || 'New exercise'}>
      <Field label="Name">
        <input className={inputCls} value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Muscle group">
          <select className={inputCls} value={e.muscleGroup} onChange={(x) => setE({ ...e, muscleGroup: x.target.value as MuscleGroup })}>
            {GROUPS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Field>
        <Field label="Equipment">
          <select className={inputCls} value={e.loadType} onChange={(x) => setE({ ...e, loadType: x.target.value as LoadType })}>
            {LOADS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Field>
        <Field label="Default reps min">
          <NumInput value={e.repMin} onChange={(v) => setE({ ...e, repMin: v ?? 1 })} />
        </Field>
        <Field label="Reps max (blank = AMRAP)">
          <NumInput value={e.repMax} onChange={(v) => setE({ ...e, repMax: v })} />
        </Field>
        <Field label="Weight increment (kg)">
          <NumInput value={e.increment} onChange={(v) => setE({ ...e, increment: v ?? 0 })} />
        </Field>
        <Field label="Rest (seconds)">
          <NumInput value={e.restSec} onChange={(v) => setE({ ...e, restSec: v ?? 90 })} />
        </Field>
      </div>
      <Segmented className="mb-3" value={e.kind} onChange={(k) => setE({ ...e, kind: k })} options={[{ value: 'compound', label: 'Compound' }, { value: 'isolation', label: 'Isolation' }]} />
      <label className="mb-4 flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={!!e.archived} onChange={(x) => setE({ ...e, archived: x.target.checked })} /> Archived (hidden from pickers, history kept)
      </label>
      <Button
        variant="primary"
        className="w-full"
        disabled={!e.name.trim()}
        onClick={async () => {
          await save('exercises', { ...e, name: e.name.trim() });
          onClose();
        }}
      >
        Save
      </Button>
    </Sheet>
  );
}
