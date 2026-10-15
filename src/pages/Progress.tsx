import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSettings } from '../app/hooks';
import { exerciseHistories } from '../core/coach/weekly';
import { addDays, shortDate, today } from '../core/dates';
import { avg7Series, evaluateBodyComp } from '../core/rules/bodycomp';
import { detectStall, liftTrend, sessionScore } from '../core/rules/lifting';
import { baseline, recoveryFlag, sleepCheck } from '../core/rules/recovery';
import { remove, save, uid } from '../db/repo';
import type { ActivityDay } from '../core/model';
import { db } from '../db/schema';
import { TimeChart } from '../ui/Chart';
import { Bar, Button, Card, Empty, Field, FlagList, NumInput, Page, Segmented, Stat, cx, inputCls } from '../ui/kit';

type Tab = 'body' | 'lifts' | 'recovery' | 'activity';
type Range = 30 | 90 | 365;

export default function ProgressPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'activity';
  const [range, setRange] = useState<Range>(90);
  return (
    <Page title="Progress">
      <Segmented className="mb-2" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} options={[{ value: 'activity', label: 'Activity' }, { value: 'body', label: 'Body' }, { value: 'lifts', label: 'Lifts' }, { value: 'recovery', label: 'Sleep' }]} />
      <Segmented
        className="mb-3"
        value={String(range) as '30' | '90' | '365'}
        onChange={(v) => setRange(Number(v) as Range)}
        options={[{ value: '30', label: '30 d' }, { value: '90', label: '90 d' }, { value: '365', label: '1 y' }]}
      />
      {tab === 'body' && <Body range={range} />}
      {tab === 'lifts' && <Lifts range={range} />}
      {tab === 'recovery' && <Recovery range={range} />}
      {tab === 'activity' && <Activity range={range} />}
    </Page>
  );
}

function Body({ range }: { range: Range }) {
  const from = addDays(today(), -range);
  const rows = useLiveQuery(() => db.body.where('date').aboveOrEqual(addDays(from, -35)).toArray(), [from]) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const sets = useLiveQuery(() => db.sets.toArray(), []) ?? [];
  const [kg, setKg] = useState<number | null>(null);
  const [waist, setWaist] = useState<number | null>(null);
  const [date, setDate] = useState(today());

  const weights = rows.filter((r) => r.weightKg !== undefined).map((r) => ({ date: r.date, value: r.weightKg! }));
  const waists = rows.filter((r) => r.waistCm !== undefined).map((r) => ({ date: r.date, value: r.waistCm! }));
  const fat = rows.filter((r) => r.bodyFatPct !== undefined).map((r) => ({ date: r.date, value: r.bodyFatPct! }));
  const avg = avg7Series(weights).filter((p) => p.date >= from);
  const trend = liftTrend([...exerciseHistories(sessions, sets).values()], today());
  const bc = evaluateBodyComp({ weights, waists, liftTrend: trend, refDate: today() });

  return (
    <>
      <Card title="Weight">
        <div className="mb-3 grid grid-cols-3 gap-3">
          <Stat label="7-day avg" value={bc.avgNow ? `${bc.avgNow.toFixed(1)} kg` : '–'} />
          <Stat label="2 weeks" value={bc.change2w === null ? '–' : `${bc.change2w > 0 ? '+' : ''}${bc.change2w.toFixed(1)}`} />
          <Stat label="4 weeks" value={bc.change4w === null ? '–' : `${bc.change4w > 0 ? '+' : ''}${bc.change4w.toFixed(1)}`} />
        </div>
        <TimeChart
          series={[
            { name: 'Daily', kind: 'dots', tone: 'muted', data: weights.filter((w) => w.date >= from) },
            { name: '7-day avg', kind: 'line', data: avg },
          ]}
          format={(v) => v.toFixed(1)}
        />
      </Card>
      <Card title="Waist">
        <TimeChart series={[{ name: 'Waist cm', kind: 'line', data: waists.filter((w) => w.date >= from) }]} format={(v) => v.toFixed(1)} empty="Log your waist weekly." />
      </Card>
      <Card title="Weekly check">
        <FlagList flags={bc.flags} empty="Nothing to change." />
      </Card>
      <Card title="Log">
        <Field label="Date">
          <input type="date" className={inputCls} value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Weight (kg)">
            <NumInput value={kg} onChange={setKg} />
          </Field>
          <Field label="Waist (cm)">
            <NumInput value={waist} onChange={setWaist} />
          </Field>
        </div>
        <Button
          variant="primary"
          className="w-full"
          disabled={!kg && !waist}
          onClick={async () => {
            if (kg) await save('body', { id: `w-${date}`, date, weightKg: kg, source: 'manual' });
            if (waist) await save('body', { id: uid(), date, waistCm: waist, source: 'manual' });
            setKg(null);
            setWaist(null);
          }}
        >
          Save
        </Button>
      </Card>
      {fat.length > 0 && (
        <Card title="Body fat % (Withings)">
          <p className="mb-2 text-xs text-warn">Unreliable day to day. Only look at the long-term trend.</p>
          <TimeChart series={[{ name: 'Body fat %', kind: 'line', data: avg7Series(fat).filter((p) => p.date >= from) }]} format={(v) => v.toFixed(1)} />
        </Card>
      )}
      <Photos />
    </>
  );
}

function Photos() {
  const photos = useLiveQuery(() => db.photos.orderBy('date').reverse().toArray(), []) ?? [];
  const settings = useSettings();
  const urls = useMemo(() => photos.map((p) => ({ id: p.id, date: p.date, url: URL.createObjectURL(p.blob) })), [photos]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u.url)), [urls]);
  return (
    <Card title="Progress photos">
      <p className="mb-2 text-xs text-faint">Stored only on this device. Never synced or sent anywhere. Every 4 weeks: front, side, back.</p>
      <label className="mb-3 block">
        <span className="inline-flex cursor-pointer items-center rounded-xl border border-line bg-surface-2 px-4 py-2.5 font-medium">+ Add photos</span>
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            for (const f of files) await db.photos.put({ id: uid(), date: today(), blob: f });
            if (files.length) await save('settings', { ...settings, lastPhotoAt: today() });
          }}
        />
      </label>
      {urls.length === 0 ? (
        <Empty>No photos yet.</Empty>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((u) => (
            <figure key={u.id} className="relative">
              <img src={u.url} className="aspect-[3/4] w-full rounded-lg object-cover" alt={`Progress ${u.date}`} />
              <figcaption className="mt-0.5 flex justify-between text-[11px] text-muted">
                {shortDate(u.date)}
                <button onClick={() => confirm('Delete photo?') && db.photos.delete(u.id)}>✕</button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </Card>
  );
}

function Lifts({ range }: { range: Range }) {
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const sets = useLiveQuery(() => db.sets.toArray(), []) ?? [];
  const hist = useMemo(() => exerciseHistories(sessions, sets), [sessions, sets]);
  const trained = exercises.filter((e) => hist.has(e.id));
  const [pick, setPick] = useState<string>('');
  const id = pick || trained[0]?.id || '';
  const h = hist.get(id) ?? [];
  const from = addDays(today(), -range);
  const ex = exercises.find((e) => e.id === id);
  const stalled = trained.filter((e) => detectStall(hist.get(e.id) ?? []));

  if (trained.length === 0) return <Empty>Log a workout to see lift progress.</Empty>;
  const bodyweight = ex?.loadType === 'bodyweight' && h.every((s) => s.sets.every((x) => x.weight === 0));
  return (
    <>
      <Card>
        <select className={cx(inputCls, 'mb-3')} value={id} onChange={(e) => setPick(e.target.value)}>
          {trained.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <TimeChart
          series={[{ name: bodyweight ? 'Best set reps' : 'Est. 1RM', kind: 'line', data: h.filter((s) => s.date >= from && !s.isDeload).map((s) => ({ date: s.date, value: sessionScore(s) })) }]}
          format={(v) => (bodyweight ? String(Math.round(v)) : v.toFixed(1))}
        />
        <p className="mt-1 text-xs text-faint">{bodyweight ? 'Most reps in one set.' : 'Estimated 1-rep max from your best set (Epley). Useful for the trend, not as a max to test.'}</p>
      </Card>
      <Card title="Sessions">
        <ul className="divide-y divide-line text-sm">
          {[...h].reverse().slice(0, 15).map((s, i) => (
            <li key={i} className="flex justify-between py-2">
              <span className="text-muted">
                {shortDate(s.date)} {s.isDeload && <span className="text-info">deload</span>}
              </span>
              <span className="tnum">{s.sets.map((x) => `${x.weight || 'BW'}×${x.reps}`).join('  ')}</span>
            </li>
          ))}
        </ul>
      </Card>
      {stalled.length > 0 && (
        <Card title="Stalled">
          <FlagList flags={stalled.map((e) => ({ rule: 2, area: 'lifting', level: 'warn', title: e.name, detail: 'No progress in 3 sessions: check sleep & food → hold → swap variation.' }))} />
        </Card>
      )}
    </>
  );
}

function Recovery({ range }: { range: Range }) {
  const from = addDays(today(), -range);
  const rows = useLiveQuery(() => db.sleep.where('date').aboveOrEqual(addDays(from, -15)).toArray(), [from]) ?? [];
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const shown = sorted.filter((r) => r.date >= from);
  const hrB = baseline(sorted, addDays(today(), 1), 'restingHr');
  const hrvB = baseline(sorted, addDays(today(), 1), 'hrv');
  const sleep = sleepCheck(sorted, today());
  const rec = recoveryFlag(sorted, today());
  const flags = [...(rec ? [rec] : []), ...sleep.flags];

  return (
    <>
      <Card title="This week">
        <div className="mb-3 grid grid-cols-3 gap-3">
          <Stat label="Avg sleep" value={sleep.avgSleep ? `${Math.floor(sleep.avgSleep / 60)} h ${Math.round(sleep.avgSleep % 60)}` : '–'} tone={sleep.avgSleep && sleep.avgSleep < 480 ? 'warn' : undefined} />
          <Stat label="RHR base" value={hrB ? Math.round(hrB.mean) : '–'} sub="14 d" />
          <Stat label="HRV base" value={hrvB ? Math.round(hrvB.mean) : '–'} sub="14 d" />
        </div>
        <FlagList flags={flags} empty={rows.length ? 'Recovery looks fine.' : 'Connect Oura in Settings or log manually below.'} />
      </Card>
      <Card title="Sleep (h)">
        <TimeChart series={[{ name: 'Sleep h', kind: 'bars', data: shown.filter((r) => r.sleepMin).map((r) => ({ date: r.date, value: r.sleepMin! / 60 })) }]} target={{ value: 8, label: '8 h' }} zero format={(v) => v.toFixed(1)} />
      </Card>
      <Card title="Resting HR (bpm)">
        <TimeChart
          series={[{ name: 'RHR', kind: 'line', data: shown.filter((r) => r.restingHr).map((r) => ({ date: r.date, value: r.restingHr! })) }]}
          band={hrB ? { lo: hrB.mean - Math.max(hrB.sd, 2), hi: hrB.mean + Math.max(hrB.sd, 2), label: 'Your normal range' } : undefined}
          format={(v) => String(Math.round(v))}
        />
      </Card>
      <Card title="HRV (ms)">
        <TimeChart
          series={[{ name: 'HRV', kind: 'line', data: shown.filter((r) => r.hrv).map((r) => ({ date: r.date, value: r.hrv! })) }]}
          band={hrvB ? { lo: hrvB.mean - hrvB.sd, hi: hrvB.mean + hrvB.sd, label: 'Your normal range' } : undefined}
          format={(v) => String(Math.round(v))}
        />
      </Card>
      <ManualSleep />
      {shown.some((r) => r.readiness) && <p className="px-1 text-xs text-faint">Oura readiness is stored but not used for decisions.</p>}
    </>
  );
}

function ManualSleep() {
  const [date, setDate] = useState(today());
  const [bed, setBed] = useState('22:00');
  const [wake, setWake] = useState('06:30');
  const [rhr, setRhr] = useState<number | null>(null);
  const [hrv, setHrv] = useState<number | null>(null);
  const existing = useLiveQuery(() => db.sleep.get(`sleep-${date}`), [date]);

  const mins = (() => {
    const [bh, bm] = bed.split(':').map(Number);
    const [wh, wm] = wake.split(':').map(Number);
    let m = wh * 60 + wm - (bh * 60 + bm);
    if (m <= 0) m += 24 * 60;
    return m;
  })();

  return (
    <Card title="Log sleep manually">
      <Field label="Morning of">
        <input type="date" className={inputCls} value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Lights out">
          <input type="time" className={inputCls} value={bed} onChange={(e) => setBed(e.target.value)} />
        </Field>
        <Field label="Woke up">
          <input type="time" className={inputCls} value={wake} onChange={(e) => setWake(e.target.value)} />
        </Field>
        <Field label="Resting HR">
          <NumInput value={rhr} onChange={setRhr} />
        </Field>
        <Field label="HRV">
          <NumInput value={hrv} onChange={setHrv} />
        </Field>
      </div>
      <p className="mb-3 text-sm text-muted">
        {Math.floor(mins / 60)} h {mins % 60} min in bed
      </p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() =>
            save('sleep', { ...(existing ?? {}), id: `sleep-${date}`, date, sleepMin: mins, bedtime: bed, wakeTime: wake, restingHr: rhr ?? existing?.restingHr, hrv: hrv ?? existing?.hrv, source: existing?.source ?? 'manual' })
          }
        >
          Save
        </Button>
        {existing && (
          <Button variant="danger" onClick={() => remove('sleep', existing.id)}>
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}

function Activity({ range }: { range: Range }) {
  const settings = useSettings();
  const from = addDays(today(), -range);
  const rows = useLiveQuery(() => db.activity.where('date').aboveOrEqual(addDays(from, -7)).toArray(), [from]) ?? [];
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const t = byDate.get(today());
  const last7 = Array.from({ length: 7 }, (_, i) => byDate.get(addDays(today(), -i))).filter((r): r is ActivityDay => !!r);
  const avg = (k: 'steps' | 'activeKcal' | 'exerciseMin') => {
    const v = last7.map((r) => r[k]).filter((x): x is number => typeof x === 'number');
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const goal = settings.stepGoal;
  const shown = rows.filter((r) => r.date >= from).sort((a, b) => a.date.localeCompare(b.date));
  const lastSync = rows.filter((r) => r.source === 'apple-health').sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const fmt = (v: number | undefined | null, unit = '') => (v === undefined || v === null ? '–' : `${Math.round(v).toLocaleString('fi-FI')}${unit}`);

  return (
    <>
      <Card title="Today">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-4xl font-semibold tnum">{fmt(t?.steps)}</span>
          <span className="text-sm text-muted tnum">/ {goal.toLocaleString('fi-FI')} steps</span>
        </div>
        <Bar value={t?.steps ?? 0} max={goal} tone={(t?.steps ?? 0) >= goal ? 'good' : 'accent'} />
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Stat label="Active" value={fmt(t?.activeKcal)} sub="kcal" />
          <Stat label="Distance" value={t?.distanceKm !== undefined ? t.distanceKm.toFixed(1) : '–'} sub="km" />
          <Stat label="Exercise" value={fmt(t?.exerciseMin)} sub="min" />
          <Stat label="Floors" value={fmt(t?.flights)} />
        </div>
        <p className="mt-3 text-xs text-faint">
          {lastSync ? `From Apple Health, last update ${new Date(lastSync.updatedAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.` : 'No Apple Health data yet.'}{' '}
          <Link to="/health-setup" className="text-accent">
            {lastSync ? 'Shortcut setup' : 'Connect Apple Health'}
          </Link>
        </p>
      </Card>

      <Card title="Last 7 days">
        <div className="mb-3 grid grid-cols-3 gap-3">
          <Stat label="Avg steps" value={fmt(avg('steps'))} tone={avg('steps') !== null && avg('steps')! >= goal ? 'good' : undefined} />
          <Stat label="Avg active" value={fmt(avg('activeKcal'))} sub="kcal/day" />
          <Stat label="Exercise" value={fmt(last7.reduce((a, r) => a + (r.exerciseMin ?? 0), 0))} sub="min total" />
        </div>
      </Card>

      <Card title="Steps">
        <TimeChart
          series={[{ name: 'Steps', kind: 'bars', data: shown.filter((r) => r.steps !== undefined).map((r) => ({ date: r.date, value: r.steps! })) }]}
          target={{ value: goal, label: `goal ${goal.toLocaleString('fi-FI')}` }}
          zero
          format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v)))}
          empty="Steps appear here once the Shortcut runs."
        />
      </Card>
      <Card title="Active energy (kcal)">
        <TimeChart series={[{ name: 'Active kcal', kind: 'bars', data: shown.filter((r) => r.activeKcal !== undefined).map((r) => ({ date: r.date, value: r.activeKcal! })) }]} zero format={(v) => String(Math.round(v))} />
      </Card>

      <StepGoal />
      <ManualActivity />
    </>
  );
}

function StepGoal() {
  const settings = useSettings();
  return (
    <Card title="Step goal">
      <NumInput value={settings.stepGoal} onChange={(v) => v && v > 0 && save('settings', { ...settings, stepGoal: Math.round(v) })} />
    </Card>
  );
}

function ManualActivity() {
  const [date, setDate] = useState(today());
  const [steps, setSteps] = useState<number | null>(null);
  const [kcal, setKcal] = useState<number | null>(null);
  const existing = useLiveQuery(() => db.activity.get(`activity-${date}`), [date]);
  return (
    <Card title="Enter by hand">
      <p className="mb-2 text-xs text-faint">For days the Shortcut missed. The next Shortcut run for that day overwrites these.</p>
      <Field label="Date">
        <input type="date" className={inputCls} value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Steps">
          <NumInput value={steps} onChange={setSteps} placeholder={existing?.steps?.toString()} />
        </Field>
        <Field label="Active kcal">
          <NumInput value={kcal} onChange={setKcal} placeholder={existing?.activeKcal?.toString()} />
        </Field>
      </div>
      <Button
        variant="primary"
        className="w-full"
        disabled={steps === null && kcal === null}
        onClick={async () => {
          await save('activity', { ...(existing ?? { source: 'manual' as const }), id: `activity-${date}`, date, steps: steps ?? existing?.steps, activeKcal: kcal ?? existing?.activeKcal });
          setSteps(null);
          setKcal(null);
        }}
      >
        Save
      </Button>
    </Card>
  );
}
