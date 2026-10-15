import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { startSession, weekFlags } from '../app/actions';
import { useBodyweight, useSettings, useSyncStatus } from '../app/hooks';
import { addDays, diffDays, formatDuration, programWeek, today, weekday, WEEKDAYS } from '../core/dates';
import { isDeloadWeek } from '../core/rules/lifting';
import { dayFlags, dayTotals, fmtSalt, proteinTarget } from '../core/rules/nutrition';
import { benchmarkStatus, nextEasyKm, nextIntervals } from '../core/rules/running';
import { save, uid } from '../db/repo';
import { db } from '../db/schema';
import AddFoodSheet, { QuickMeals } from '../features/AddFoodSheet';
import { Bar, Button, Card, FlagList, NumInput, Page } from '../ui/kit';

export default function TodayPage() {
  const nav = useNavigate();
  const settings = useSettings();
  const bw = useBodyweight();
  const sync = useSyncStatus();
  const d = today();
  const wd = weekday(d);
  const [addFood, setAddFood] = useState(false);

  const day = useLiveQuery(() => db.programDays.where('weekday').equals(wd).first(), [wd]);
  const sessionsToday = useLiveQuery(() => db.sessions.where('date').equals(d).toArray(), [d]) ?? [];
  const runsToday = useLiveQuery(() => db.runs.where('date').equals(d).toArray(), [d]) ?? [];
  const allRuns = useLiveQuery(() => db.runs.toArray(), []) ?? [];
  const food = useLiveQuery(() => db.foodLog.where('date').equals(d).toArray(), [d]) ?? [];
  const bodyToday = useLiveQuery(() => db.body.where('date').equals(d).toArray(), [d]) ?? [];
  const lastWaist = useLiveQuery(() => db.body.orderBy('date').reverse().filter((b) => b.waistCm !== undefined).first(), []);
  const week = useLiveQuery(() => weekFlags(d), [d, sessionsToday.length, runsToday.length, bodyToday.length]);
  const report = useLiveQuery(() => db.coachReports.where('weekStart').equals(addDays(d, 1 - wd)).first(), [d]);

  const pWeek = settings.programStartDate ? programWeek(settings.programStartDate, d) : null;
  const deload = isDeloadWeek(settings.programStartDate, d, settings.deloadEvery);
  const plan = settings.runSchedule[String(wd)] ?? {};
  const totals = dayTotals(food);
  const pTarget = proteinTarget(bw, settings.proteinGPerKg);
  const recoveryLow = !!week?.flags.some((f) => f.rule === 15);

  const session = sessionsToday.find((s) => s.programDayId === day?.id) ?? sessionsToday[0];

  let runText = '';
  if (plan.run === 'easy') runText = deload ? 'Easy run (deload week)' : `Easy run · ${nextEasyKm(allRuns, pWeek ?? 1, recoveryLow)} km`;
  else if (plan.run === 'intervals') runText = deload || recoveryLow ? 'Make it an easy run today' : nextIntervals(allRuns, d)?.message ?? 'Intervals · start with 5 × 400 m';
  else if (plan.run === 'benchmark') runText = deload ? 'Easy run instead of the benchmark (deload)' : `4 km benchmark · target under ${formatDuration(benchmarkStatus(allRuns).target)}`;
  else if (plan.run === 'optional-easy') runText = 'Optional easy 30–45 min';

  const flags = [...(week?.flags ?? []), ...dayFlags(totals, pTarget, settings.sodiumCeilingMg).filter((f) => f.level === 'warn')];
  const photoDue = !settings.lastPhotoAt || diffDays(d, settings.lastPhotoAt) >= 28;
  const backupDue = sync.state === 'off' && (!settings.lastExportAt || Date.now() - settings.lastExportAt > 7 * 864e5);

  return (
    <Page
      title={`${WEEKDAYS[wd - 1]} ${Number(d.slice(8))}.${Number(d.slice(5, 7))}.`}
      right={
        <Link to="/settings" className="rounded-lg px-2 py-1 text-muted" aria-label="Settings">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
          </svg>
        </Link>
      }
    >
      <div className="-mt-2 mb-3 flex gap-2 text-sm text-muted">
        {pWeek !== null && <span>Week {pWeek} of {settings.recompWeeks}</span>}
        {deload && <span className="rounded-full bg-info/15 px-2 text-info">Deload week</span>}
      </div>

      <Card title="Plan">
        <div className="space-y-3">
          {runText && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-muted">Morning</div>
                <div className="font-medium">{runText}</div>
              </div>
              {runsToday.length ? (
                <span className="text-sm text-good">✓ Logged</span>
              ) : (
                <Button size="sm" onClick={() => nav(`/runs?type=${plan.run === 'optional-easy' ? 'easy' : plan.run}`)}>
                  Log run
                </Button>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-muted">Gym</div>
              <div className="font-medium">{day ? day.name : 'Rest day'}</div>
              {plan.note && !day && <div className="text-xs text-faint">{plan.note}</div>}
            </div>
            {day &&
              (session?.endedAt ? (
                <Link to={`/workout/${session.id}`} className="text-sm text-good">
                  ✓ Done
                </Link>
              ) : (
                <Button variant="primary" onClick={async () => nav(`/workout/${await startSession(day)}`)}>
                  {session ? 'Resume' : 'Start'}
                </Button>
              ))}
            {!day && (
              <Button size="sm" variant="ghost" onClick={() => nav('/train')}>
                Other workout
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Food"
        action={
          <Button size="sm" variant="primary" onClick={() => setAddFood(true)}>
            + Add
          </Button>
        }
      >
        <div className="mb-1 flex justify-between text-sm">
          <span>Protein</span>
          <span className="tnum text-muted">
            {Math.round(totals.protein)} / {pTarget} g
          </span>
        </div>
        <Bar value={totals.protein} max={pTarget} tone={totals.protein >= pTarget ? 'good' : 'accent'} />
        {settings.sodiumCeilingMg && (
          <>
            <div className="mb-1 mt-3 flex justify-between text-sm">
              <span>Salt</span>
              <span className="tnum text-muted">
                {fmtSalt(totals.sodiumMg)} / {fmtSalt(settings.sodiumCeilingMg)} g
              </span>
            </div>
            <Bar value={totals.sodiumMg} max={settings.sodiumCeilingMg} tone={totals.sodiumMg > settings.sodiumCeilingMg ? 'bad' : totals.sodiumMg > settings.sodiumCeilingMg * 0.85 ? 'warn' : 'good'} />
          </>
        )}
        <div className="mb-3 mt-2 text-xs text-muted tnum">
          ~{totals.kcal} kcal · C {Math.round(totals.carbs)} · F {Math.round(totals.fat)}
        </div>
        <QuickMeals date={d} />
      </Card>

      {!bodyToday.some((b) => b.weightKg) && <WeighIn date={d} />}
      {(!lastWaist || diffDays(d, lastWaist.date) >= 7) && <WaistPrompt date={d} />}

      <Card title="Coach">
        <FlagList flags={flags} empty="No flags. Keep going." />
        {wd === 7 && !report && (
          <Button className="mt-3 w-full" onClick={() => nav('/coach')}>
            Write this week's report
          </Button>
        )}
      </Card>

      {photoDue && (
        <Card title="Progress photo">
          <p className="mb-2 text-sm text-muted">4 weeks since the last one. Same spot, same light, morning.</p>
          <Button size="sm" onClick={() => nav('/progress?tab=body')}>
            Take photos
          </Button>
        </Card>
      )}
      {backupDue && (
        <Card title="Backup">
          <p className="mb-2 text-sm text-muted">Your data lives only on this device. Export a backup weekly (or set up sync).</p>
          <Button size="sm" onClick={() => nav('/settings')}>
            Go to export
          </Button>
        </Card>
      )}

      <AddFoodSheet open={addFood} onClose={() => setAddFood(false)} date={d} />
    </Page>
  );
}

function WeighIn({ date }: { date: string }) {
  const [kg, setKg] = useState<number | null>(null);
  return (
    <Card title="Morning weigh-in">
      <div className="flex gap-2">
        <NumInput value={kg} onChange={setKg} placeholder="kg" />
        <Button variant="primary" disabled={!kg || kg < 30 || kg > 200} onClick={() => save('body', { id: `w-${date}`, date, weightKg: kg!, source: 'manual' })}>
          Save
        </Button>
      </div>
      <p className="mt-1 text-xs text-faint">Withings syncs this automatically once connected.</p>
    </Card>
  );
}

function WaistPrompt({ date }: { date: string }) {
  const [cm, setCm] = useState<number | null>(null);
  return (
    <Card title="Weekly waist">
      <div className="flex gap-2">
        <NumInput value={cm} onChange={setCm} placeholder="cm at the navel, relaxed" />
        <Button variant="primary" disabled={!cm || cm < 40 || cm > 150} onClick={() => save('body', { id: uid(), date, waistCm: cm!, source: 'manual' })}>
          Save
        </Button>
      </div>
    </Card>
  );
}
