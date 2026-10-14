import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSettings } from '../app/hooks';
import { formatDuration, pacePerKm, parseDuration, programWeek, shortDate, today, weekStart } from '../core/dates';
import type { Run, RunType } from '../core/model';
import { benchmarkStatus, easyTargetKm, nextIntervals, runBalance, time4k } from '../core/rules/running';
import { remove, save, uid } from '../db/repo';
import { db } from '../db/schema';
import { TimeChart } from '../ui/Chart';
import { Button, Card, Empty, ErrorNote, Field, FlagList, NumInput, Page, Segmented, Stat, inputCls, cx } from '../ui/kit';

export default function RunsPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const settings = useSettings();
  const runs = useLiveQuery(() => db.runs.orderBy('date').reverse().toArray(), []) ?? [];
  const initialType = (['easy', 'intervals', 'benchmark', 'other'].includes(params.get('type') ?? '') ? params.get('type') : 'easy') as RunType;

  const bench = benchmarkStatus(runs);
  const balance = runBalance(runs, weekStart(today()));
  const iv = nextIntervals(runs, today());
  const pWeek = settings.programStartDate ? programWeek(settings.programStartDate, today()) : 1;

  return (
    <Page title="Runs" back={() => nav(-1)}>
      <RunForm initialType={initialType} />

      <Card title="This week">
        <div className="mb-3 grid grid-cols-3 gap-3">
          <Stat label="Hard runs" value={`${balance.hard}/2`} tone={balance.hard > 2 ? 'warn' : undefined} />
          <Stat label="Easy runs" value={balance.easy} />
          <Stat label="Hard share" value={balance.hardShare === null ? '–' : `${Math.round(balance.hardShare * 100)} %`} sub="target ~20 %" />
        </div>
        <FlagList flags={balance.flags} />
        <ul className="mt-2 space-y-1 text-sm text-muted">
          <li>Easy runs: build toward {easyTargetKm(pWeek)} km this week (week {pWeek}).</li>
          {iv && <li>Intervals: {iv.message}</li>}
        </ul>
      </Card>

      <Card title="4 km benchmark">
        <div className="mb-3 grid grid-cols-3 gap-3">
          <Stat label="Target" value={`< ${formatDuration(bench.target)}`} />
          <Stat label="Best" value={bench.best ? formatDuration(bench.best) : '–'} />
          <Stat label="Last" value={bench.last ? formatDuration(bench.last) : '–'} tone={bench.last && bench.last < bench.target ? 'good' : undefined} />
        </div>
        <TimeChart
          series={[{ name: '4 km time', kind: 'line', data: bench.history.map((h) => ({ date: h.date, value: h.sec })) }]}
          target={{ value: bench.target, label: formatDuration(bench.target) }}
          format={(v) => formatDuration(v)}
          empty="Log a benchmark run to start the chart."
        />
      </Card>

      <Card title="History">
        {runs.length === 0 ? (
          <Empty>No runs yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {runs.slice(0, 40).map((r) => {
              const pace = pacePerKm(r.durationSec, r.distanceKm);
              return (
                <li key={r.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="text-sm font-medium capitalize">
                      {r.type}
                      {r.intervals && <span className="ml-1 text-muted normal-case">{r.intervals.reps} × {r.intervals.workM ? `${r.intervals.workM} m` : formatDuration(r.intervals.workSec ?? 0)}</span>}
                    </div>
                    <div className="text-xs text-muted tnum">
                      {shortDate(r.date)} · {r.distanceKm} km · {formatDuration(r.durationSec)} · {pace ? `${formatDuration(pace)}/km` : ''}
                      {r.avgHr ? ` · ${r.avgHr} bpm` : ''}
                      {r.type === 'benchmark' && r.distanceKm !== 4 ? ` · 4 km eq. ${formatDuration(time4k(r))}` : ''}
                    </div>
                  </div>
                  <button className="px-2 text-sm text-faint" onClick={() => confirm('Delete this run?') && remove('runs', r.id)}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Page>
  );
}

function RunForm({ initialType }: { initialType: RunType }) {
  const [type, setType] = useState<RunType>(initialType);
  const [date, setDate] = useState(today());
  const [km, setKm] = useState<number | null>(initialType === 'benchmark' ? 4 : null);
  const [time, setTime] = useState('');
  const [hr, setHr] = useState<number | null>(null);
  const [reps, setReps] = useState<number | null>(5);
  const [workKind, setWorkKind] = useState<'m' | 's'>('m');
  const [work, setWork] = useState<number | null>(400);
  const [restSec, setRestSec] = useState<number | null>(90);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const sec = parseDuration(time);
  const pace = sec && km ? pacePerKm(sec, km) : null;

  async function submit() {
    if (!km || !sec) return setError('Enter distance and time (mm:ss).');
    const run: Run = {
      id: uid(), updatedAt: 0, date, type, distanceKm: km, durationSec: sec, avgHr: hr ?? undefined, notes: notes || undefined,
      intervals: type === 'intervals' && reps ? { reps, ...(workKind === 'm' ? { workM: work ?? undefined } : { workSec: work ?? undefined }), restSec: restSec ?? undefined } : undefined,
    };
    await save('runs', run);
    setTime('');
    setNotes('');
    setHr(null);
    setError(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Card title="Log a run">
      <Segmented
        className="mb-3"
        value={type}
        onChange={(t) => {
          setType(t);
          if (t === 'benchmark') setKm(4);
        }}
        options={[
          { value: 'easy', label: 'Easy' },
          { value: 'intervals', label: 'Intervals' },
          { value: 'benchmark', label: '4 km test' },
          { value: 'other', label: 'Other' },
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Distance (km)">
          <NumInput value={km} onChange={setKm} />
        </Field>
        <Field label="Time (mm:ss)">
          <input className={cx(inputCls, 'tnum')} inputMode="numeric" placeholder="25:30" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Avg HR (optional)">
          <NumInput value={hr} onChange={setHr} />
        </Field>
        <Field label="Date">
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {type === 'intervals' && (
        <div className="mb-3 rounded-xl bg-surface-2 p-3">
          <Segmented className="mb-2" value={workKind} onChange={(k) => { setWorkKind(k); setWork(k === 'm' ? 400 : 180); }} options={[{ value: 'm', label: 'Distance reps' }, { value: 's', label: 'Time reps' }]} />
          <div className="grid grid-cols-3 gap-2 text-xs text-muted">
            <label>
              Reps
              <NumInput className="mt-1 py-1.5" value={reps} onChange={setReps} />
            </label>
            <label>
              {workKind === 'm' ? 'Rep (m)' : 'Rep (s)'}
              <NumInput className="mt-1 py-1.5" value={work} onChange={setWork} />
            </label>
            <label>
              Rest (s)
              <NumInput className="mt-1 py-1.5" value={restSec} onChange={setRestSec} />
            </label>
          </div>
        </div>
      )}
      <input className={cx(inputCls, 'mb-3')} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="mb-3 text-sm text-muted tnum">Pace: {pace ? `${formatDuration(pace)} /km` : '–'}</div>
      <ErrorNote error={error} />
      <Button variant="primary" className="w-full" onClick={submit}>
        {saved ? '✓ Saved' : 'Save run'}
      </Button>
    </Card>
  );
}
