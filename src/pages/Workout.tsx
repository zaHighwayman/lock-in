// The logger. Every planned set is pre-filled; one tap on ✓ logs it as planned and starts the rest timer.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addExerciseToSession, addSet, deleteSession, finishSession, historyFor, suggestionFor, swapExercise } from '../app/actions';
import { useNow } from '../app/hooks';
import { formatDuration, shortDate } from '../core/dates';
import type { Exercise, ProgramItem, SetLog, WorkoutSession } from '../core/model';
import { detectStall } from '../core/rules/lifting';
import { patch, remove } from '../db/repo';
import { db } from '../db/schema';
import { Button, Page, Sheet, Stepper, cx, inputCls } from '../ui/kit';

const REST_KEY = 'lockin-rest';

function useRest() {
  const [rest, setRestState] = useState<{ endAt: number; total: number } | null>(() => {
    try {
      const r = JSON.parse(sessionStorage.getItem(REST_KEY) ?? 'null');
      return r && r.endAt > Date.now() ? r : null;
    } catch {
      return null;
    }
  });
  const setRest = (r: { endAt: number; total: number } | null) => {
    setRestState(r);
    try {
      if (r) sessionStorage.setItem(REST_KEY, JSON.stringify(r));
      else sessionStorage.removeItem(REST_KEY);
    } catch {
      /* storage unavailable: timer still works in memory */
    }
  };
  return [rest, setRest] as const;
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch {
    /* no audio */
  }
}

export default function WorkoutPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const session = useLiveQuery(() => db.sessions.get(id), [id]);
  const sets = useLiveQuery(() => db.sets.where('sessionId').equals(id).toArray(), [id]) ?? [];
  const exercises = useLiveQuery(() => db.exercises.toArray(), []) ?? [];
  const day = useLiveQuery(async () => (session?.programDayId ? db.programDays.get(session.programDayId) : undefined), [session?.programDayId]);
  const [rest, setRest] = useRest();
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const now = useNow(1000);

  const exById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);
  const groups = useMemo(() => {
    const m = new Map<string, { order: number; exerciseId: string; sets: SetLog[] }>();
    for (const s of sets) {
      const k = `${s.order}:${s.exerciseId}`;
      if (!m.has(k)) m.set(k, { order: s.order, exerciseId: s.exerciseId, sets: [] });
      m.get(k)!.sets.push(s);
    }
    return [...m.values()].sort((a, b) => a.order - b.order).map((g) => ({ ...g, sets: g.sets.sort((a, b) => a.setNo - b.setNo) }));
  }, [sets]);

  const fired = useRef(false);
  useEffect(() => {
    if (!rest) return;
    if (now >= rest.endAt && !fired.current) {
      fired.current = true;
      beep();
      setTimeout(() => setRest(null), 1500);
    }
    if (now < rest.endAt) fired.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, rest]);

  if (session === undefined) return <Page title="Loading…">{null}</Page>;
  if (session === null) return <Page title="Not found" back={() => nav('/train')}>{null}</Page>;

  const done = sets.filter((s) => s.done).length;
  const elapsed = ((session.endedAt ?? now) - session.startedAt) / 1000;

  return (
    <Page
      title={session.name}
      back={() => nav(-1)}
      right={
        session.endedAt ? (
          <span className="text-sm text-good">Finished</span>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setFinishing(true)}>
            Finish
          </Button>
        )
      }
    >
      <div className="-mt-2 mb-3 flex gap-3 text-sm text-muted tnum">
        <span>{shortDate(session.date)}</span>
        <span>{formatDuration(elapsed)}</span>
        <span>
          {done}/{sets.length} sets
        </span>
        {session.isDeload && <span className="rounded-full bg-info/15 px-2 text-info">Deload</span>}
      </div>

      {groups.map((g) => {
        const ex = exById.get(g.exerciseId);
        if (!ex) return null;
        const item = day?.items[g.order];
        const planItem: Pick<ProgramItem, 'sets' | 'repMin' | 'repMax'> & Partial<ProgramItem> =
          item && (item.exerciseId === ex.id || item.alternatives?.includes(ex.id)) ? item : { sets: g.sets.length, repMin: ex.repMin, repMax: ex.repMax };
        return (
          <ExerciseCard
            key={`${g.order}:${g.exerciseId}`}
            session={session}
            ex={ex}
            item={planItem}
            order={g.order}
            sets={g.sets}
            exercises={exercises}
            onRest={(sec) => setRest({ endAt: Date.now() + sec * 1000, total: sec })}
          />
        );
      })}

      <Button className="mb-3 w-full" variant="ghost" onClick={() => setAdding(true)}>
        + Add exercise
      </Button>
      {session.endedAt && (
        <Button
          variant="danger"
          className="w-full"
          onClick={async () => {
            if (confirm('Delete this session and all its sets?')) {
              await deleteSession(session.id);
              nav('/train');
            }
          }}
        >
          Delete session
        </Button>
      )}

      {rest && <RestBar rest={rest} now={now} onAdd={(s) => setRest({ endAt: rest.endAt + s * 1000, total: rest.total + s })} onSkip={() => setRest(null)} />}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add exercise">
        <ExercisePicker
          exercises={exercises}
          onPick={async (e) => {
            await addExerciseToSession(session, e.id);
            setAdding(false);
          }}
        />
      </Sheet>

      <FinishSheet
        open={finishing}
        onClose={() => setFinishing(false)}
        undone={sets.length - done}
        onFinish={async (notes) => {
          await finishSession(session, notes);
          setRest(null);
          nav('/');
        }}
      />
    </Page>
  );
}

function RestBar({ rest, now, onAdd, onSkip }: { rest: { endAt: number; total: number }; now: number; onAdd: (s: number) => void; onSkip: () => void }) {
  const left = Math.min(rest.total, Math.max(0, Math.ceil((rest.endAt - now) / 1000)));
  const pct = Math.min(100, (1 - left / rest.total) * 100);
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface safe-bottom">
      <div className="h-1 bg-surface-2">
        <div className="h-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
      </div>
      <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
        <div className={cx('flex-1 text-2xl font-semibold tnum', left === 0 && 'text-accent')}>{left === 0 ? 'Go' : formatDuration(left)}</div>
        <Button size="sm" onClick={() => onAdd(30)}>
          +30 s
        </Button>
        <Button size="sm" variant="ghost" onClick={onSkip}>
          Skip
        </Button>
      </div>
    </div>
  );
}

function ExerciseCard({
  session, ex, item, order, sets, exercises, onRest,
}: {
  session: WorkoutSession;
  ex: Exercise;
  item: Pick<ProgramItem, 'sets' | 'repMin' | 'repMax'> & Partial<ProgramItem>;
  order: number;
  sets: SetLog[];
  exercises: Exercise[];
  onRest: (sec: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const info = useLiveQuery(async () => {
    const s = await suggestionFor(ex, item, session.id, !!session.isDeload);
    const hist = await historyFor(ex.id, session.id);
    return { ...s, stalled: detectStall(hist) };
  }, [ex.id, session.id, item.sets, item.repMin, item.repMax]);

  const range = item.repMax === null ? 'AMRAP' : `${item.repMin}–${item.repMax}`;
  const step = ex.increment || (ex.loadType === 'bodyweight' ? 2.5 : 1);
  const alternatives = (item.alternatives ?? []).map((id) => exercises.find((e) => e.id === id)).filter((e): e is Exercise => !!e);

  return (
    <section className="mb-3 rounded-2xl border border-line bg-surface">
      <div className="flex items-start justify-between gap-2 px-4 pt-3">
        <div className="min-w-0">
          <h2 className="font-semibold">
            {ex.name} {item.optional && <span className="text-xs font-normal text-faint">optional</span>}
          </h2>
          <div className="text-xs text-muted">
            {item.sets} × {range}
            {info?.last && <> · last {info.last.sets.map((s) => `${s.weight || 'BW'}×${s.reps}`).join(', ')}</>}
          </div>
        </div>
        <button className="shrink-0 text-sm text-muted" onClick={() => setSwapping(true)}>
          Swap
        </button>
      </div>
      {info && (
        <div className={cx('mx-4 mt-2 rounded-lg px-2.5 py-1.5 text-sm', info.suggestion.kind === 'increase' || info.suggestion.kind === 'add-load' ? 'bg-accent/12 text-accent' : 'bg-surface-2 text-ink')}>
          {info.suggestion.message}
        </div>
      )}
      {info?.stalled && !session.isDeload && (
        <div className="mx-4 mt-2 rounded-lg bg-warn/10 px-2.5 py-1.5 text-xs text-warn">Stalled 3 sessions: check sleep & food → hold → swap variation.</div>
      )}
      <ul className="mt-2">
        {sets.map((s) => (
          <li key={s.id} className="border-t border-line">
            <div className="flex items-center gap-3 px-4 py-2">
              <span className="w-5 text-sm text-faint tnum">{s.setNo}</span>
              <button className="flex-1 text-left tnum" onClick={() => setEditing(editing === s.id ? null : s.id)}>
                <span className={cx('text-lg font-semibold', !s.done && 'text-ink/80')}>{s.weight > 0 ? `${+s.weight.toFixed(2)} kg` : ex.loadType === 'bodyweight' ? 'BW' : '0 kg'}</span>
                <span className="mx-1.5 text-muted">×</span>
                <span className="text-lg font-semibold">{s.reps}</span>
                {s.rir !== undefined && <span className="ml-2 text-xs text-muted">RIR {s.rir}</span>}
                {s.done && s.plannedReps !== undefined && (s.reps !== s.plannedReps || s.weight !== s.plannedWeight) && (
                  <span className="ml-2 text-xs text-faint">plan {s.plannedWeight}×{s.plannedReps}</span>
                )}
              </button>
              <button
                aria-label={s.done ? 'Undo set' : 'Log set as shown'}
                onClick={async () => {
                  await patch('sets', s.id, { done: !s.done });
                  if (!s.done) {
                    onRest(ex.restSec || 90);
                    setEditing(null);
                  }
                }}
                className={cx('h-12 w-14 rounded-xl text-xl font-bold transition active:scale-95', s.done ? 'bg-good text-black' : 'border border-line bg-surface-2 text-muted')}
              >
                ✓
              </button>
            </div>
            {editing === s.id && (
              <div className="space-y-3 bg-surface-2/50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Weight</span>
                  <Stepper
                    value={s.weight}
                    step={step}
                    unit="kg"
                    onChange={(v) => {
                      // the new weight carries over to the remaining unticked sets
                      patch('sets', s.id, { weight: v });
                      for (const x of sets) if (x.setNo > s.setNo && !x.done) patch('sets', x.id, { weight: v });
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Reps</span>
                  <Stepper value={s.reps} step={1} decimals={0} onChange={(v) => patch('sets', s.id, { reps: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Reps in reserve</span>
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map((r) => (
                      <button
                        key={r}
                        onClick={() => patch('sets', s.id, { rir: s.rir === r ? undefined : r })}
                        className={cx('h-9 w-9 rounded-lg border text-sm', s.rir === r ? 'border-accent bg-accent/15 text-accent' : 'border-line')}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <button className="text-bad" onClick={() => remove('sets', s.id)}>
                    Delete set
                  </button>
                  <span className="text-faint">Weight changes carry to later sets</span>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <button className="w-full border-t border-line py-2.5 text-sm text-muted" onClick={() => addSet(session, ex.id, order)}>
        + Set
      </button>

      <Sheet open={swapping} onClose={() => setSwapping(false)} title={`Swap ${ex.name}`}>
        <ExercisePicker
          exercises={exercises.filter((e) => e.id !== ex.id)}
          suggested={alternatives}
          preferGroup={ex.muscleGroup}
          onPick={async (to) => {
            await swapExercise(session, order, ex.id, to.id, item);
            setSwapping(false);
          }}
        />
      </Sheet>
    </section>
  );
}

function ExercisePicker({ exercises, onPick, suggested = [], preferGroup }: { exercises: Exercise[]; onPick: (e: Exercise) => void; suggested?: Exercise[]; preferGroup?: string }) {
  const [q, setQ] = useState('');
  const list = exercises
    .filter((e) => !e.archived && e.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.muscleGroup === preferGroup) - Number(a.muscleGroup === preferGroup) || a.name.localeCompare(b.name));
  return (
    <div>
      <input className={cx(inputCls, 'mb-3')} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      {suggested.length > 0 && !q && (
        <>
          <h3 className="mb-1 text-xs uppercase text-muted">Program alternatives</h3>
          <ul className="mb-3 divide-y divide-line">
            {suggested.map((e) => (
              <li key={e.id}>
                <button className="w-full py-2.5 text-left" onClick={() => onPick(e)}>
                  {e.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <ul className="divide-y divide-line">
        {list.map((e) => (
          <li key={e.id}>
            <button className="flex w-full justify-between py-2.5 text-left" onClick={() => onPick(e)}>
              <span>{e.name}</span>
              <span className="text-xs text-muted">{e.muscleGroup}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FinishSheet({ open, onClose, undone, onFinish }: { open: boolean; onClose: () => void; undone: number; onFinish: (notes: string) => void }) {
  const [notes, setNotes] = useState('');
  return (
    <Sheet open={open} onClose={onClose} title="Finish workout">
      {undone > 0 && <p className="mb-3 text-sm text-warn">{undone} planned set{undone > 1 ? 's' : ''} not ticked will be dropped.</p>}
      <textarea className={cx(inputCls, 'mb-3 h-24')} placeholder="Notes (optional): how it felt, pain, gym busy…" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Button variant="primary" className="w-full" onClick={() => onFinish(notes)}>
        Finish
      </Button>
    </Sheet>
  );
}
