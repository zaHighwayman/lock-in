import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { loadCoachData, programSummary } from '../app/actions';
import { useSettings } from '../app/hooks';
import { getProvider } from '../ai/provider';
import { askCoach, weeklyReport } from '../ai/tasks';
import { buildWeek } from '../core/coach/weekly';
import { addDays, shortDate, today, weekStart } from '../core/dates';
import type { ChatMessage } from '../core/model';
import { remove, save, uid } from '../db/repo';
import { db } from '../db/schema';
import { Button, Card, Empty, ErrorNote, FlagList, Markdown, Page, Segmented, cx, inputCls } from '../ui/kit';

export default function CoachPage() {
  const [tab, setTab] = useState<'report' | 'chat'>('report');
  return (
    <Page title="Coach">
      <Segmented className="mb-3" value={tab} onChange={setTab} options={[{ value: 'report', label: 'Weekly report' }, { value: 'chat', label: 'Ask the coach' }]} />
      {tab === 'report' ? <Reports /> : <Chat />}
    </Page>
  );
}

function Issues({ issues }: { issues?: string[] }) {
  if (!issues?.length) return null;
  return (
    <div className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
      <div className="font-medium">Guardrail check flagged this reply. Ignore the flagged part:</div>
      <ul className="list-disc pl-4">
        {issues.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function Reports() {
  const settings = useSettings();
  const reports = useLiveQuery(() => db.coachReports.orderBy('weekStart').reverse().toArray(), []) ?? [];
  const live = useLiveQuery(async () => buildWeek(await loadCoachData(), today()), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ws = weekStart(today());
  const current = reports.find((r) => r.weekStart === ws);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const week = buildWeek(await loadCoachData(), today());
      let summary = '';
      let issues: string[] = [];
      let provider = 'rules only';
      if (settings.aiProvider !== 'none') {
        const ai = await getProvider(settings);
        const r = await weeklyReport(ai, week.input, await programSummary());
        summary = r.text;
        issues = r.issues;
        provider = ai.name;
      }
      await save('coachReports', { id: current?.id ?? uid(), weekStart: ws, flags: week.flags, input: week.input, summary, provider, guardrailIssues: issues });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="This week so far (rules)">
        <FlagList flags={live?.flags ?? []} empty="No flags from the rules." />
        <ErrorNote error={error} />
        <Button variant="primary" className="mt-3 w-full" disabled={busy} onClick={generate}>
          {busy ? 'Writing…' : current ? 'Rewrite this week’s report' : 'Write this week’s report'}
        </Button>
        <p className="mt-2 text-xs text-faint">Sends only weekly aggregates (no raw daily logs) to {settings.aiProvider === 'none' ? 'nobody: AI is off' : settings.aiProvider}.</p>
      </Card>
      {reports.length === 0 && <Empty>No reports yet. Sunday evening is a good time.</Empty>}
      {reports.map((r) => (
        <Card key={r.id} title={`Week of ${shortDate(r.weekStart)}–${shortDate(addDays(r.weekStart, 6))}`}>
          {r.summary ? <Markdown text={r.summary} /> : <p className="text-sm text-muted">Rules-only report (no AI summary).</p>}
          <Issues issues={r.guardrailIssues} />
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted">Rule outputs ({r.flags.length})</summary>
            <div className="mt-2">
              <FlagList flags={r.flags} empty="None." />
            </div>
          </details>
          <div className="mt-2 text-right text-[11px] text-faint">{r.provider}</div>
        </Card>
      ))}
    </>
  );
}

function Chat() {
  const settings = useSettings();
  const messages = useLiveQuery(() => db.chat.orderBy('createdAt').toArray(), []) ?? [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages.length, busy]);

  async function send(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    setText('');
    const userMsg: ChatMessage = { id: uid(), updatedAt: 0, role: 'user', text: q.trim(), createdAt: Date.now() };
    await save('chat', userMsg);
    try {
      const data = await loadCoachData(70);
      const weeks = [0, 7, 14, 21].map((back) => buildWeek(data, addDays(today(), -back)).input);
      const context = `${JSON.stringify(weeks)}\n\nProgram:\n${await programSummary()}`;
      const ai = await getProvider(settings);
      const history = [...messages, userMsg].map((m) => ({ role: m.role === 'coach' ? ('assistant' as const) : ('user' as const), text: m.text }));
      const r = await askCoach(ai, history, context);
      await save('chat', { id: uid(), role: 'coach', text: r.text, createdAt: Date.now(), guardrailIssues: r.issues });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const starters = ['Why did my bench stall?', 'Am I eating enough protein?', 'Should I push the intervals this week?', 'How is my sleep affecting training?'];

  return (
    <>
      {messages.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {starters.map((s) => (
            <button key={s} className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {messages.map((m) => (
          <div key={m.id} className={cx('max-w-[88%] rounded-2xl px-3 py-2', m.role === 'user' ? 'ml-auto bg-accent text-accent-ink' : 'bg-surface border border-line')}>
            {m.role === 'coach' ? <Markdown text={m.text} /> : <p className="text-sm">{m.text}</p>}
            <Issues issues={m.guardrailIssues} />
          </div>
        ))}
        {busy && <div className="w-24 rounded-2xl border border-line bg-surface px-3 py-2 text-sm text-muted">Thinking…</div>}
        <div ref={endRef} />
      </div>
      <ErrorNote error={error} />
      <div className="sticky bottom-20 mt-3 flex gap-2 bg-bg py-2">
        <input className={inputCls} placeholder="Ask about your training, food, sleep…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && send(text)} />
        <Button variant="primary" disabled={busy || !text.trim()} onClick={() => send(text)}>
          Send
        </Button>
      </div>
      {messages.length > 0 && (
        <button className="mt-1 text-xs text-faint" onClick={() => confirm('Clear the chat?') && remove('chat', messages.map((m) => m.id))}>
          Clear chat
        </button>
      )}
    </>
  );
}
