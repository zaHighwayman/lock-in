import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { startSession } from '../app/actions';
import { formatDuration, shortDate, today, weekday, WEEKDAYS } from '../core/dates';
import { db } from '../db/schema';
import { Button, Card, Empty, Page, cx } from '../ui/kit';

export default function TrainPage() {
  const nav = useNavigate();
  const days = useLiveQuery(() => db.programDays.orderBy('weekday').toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.orderBy('date').reverse().limit(30).toArray(), []) ?? [];
  const setCounts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const s of sessions) m.set(s.id, await db.sets.where('sessionId').equals(s.id).count());
    return m;
  }, [sessions]);
  const wd = weekday(today());

  return (
    <Page
      title="Train"
      right={
        <div className="flex gap-1">
          <Link to="/runs" className="rounded-lg border border-line px-3 py-1.5 text-sm">
            Runs
          </Link>
          <Link to="/program" className="rounded-lg border border-line px-3 py-1.5 text-sm">
            Program
          </Link>
        </div>
      }
    >
      <Card title="Start a workout">
        <div className="grid grid-cols-2 gap-2">
          {days.map((d) => (
            <button
              key={d.id}
              onClick={async () => nav(`/workout/${await startSession(d)}`)}
              className={cx('rounded-xl border p-3 text-left', d.weekday === wd ? 'border-accent/60 bg-accent/10' : 'border-line bg-surface-2')}
            >
              <div className="text-xs text-muted">{WEEKDAYS[d.weekday - 1]}</div>
              <div className="font-medium">{d.name}</div>
              <div className="text-xs text-faint">{d.items.length} exercises</div>
            </button>
          ))}
        </div>
        <Button className="mt-2 w-full" variant="ghost" onClick={async () => nav(`/workout/${await startSession(null)}`)}>
          Empty workout
        </Button>
      </Card>

      <Card title="History" action={<Link to="/import" className="text-sm text-muted">Import CSV</Link>}>
        {sessions.length === 0 ? (
          <Empty>No sessions yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link to={`/workout/${s.id}`} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-medium">
                      {s.name} {s.isDeload && <span className="text-xs text-info">deload</span>}
                    </div>
                    <div className="text-xs text-muted">
                      {shortDate(s.date)} · {setCounts?.get(s.id) ?? 0} sets
                      {s.endedAt ? ` · ${formatDuration((s.endedAt - s.startedAt) / 1000)}` : ' · in progress'}
                    </div>
                  </div>
                  <span className="text-muted">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
