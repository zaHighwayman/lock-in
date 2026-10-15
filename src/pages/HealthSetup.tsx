// Guide for the iPhone Shortcut that sends Apple Health day totals to the server.
// (A web app can't read HealthKit; the Shortcut reads it on the phone and posts the numbers.)
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentAccount } from '../db/account';
import { setMeta } from '../db/repo';
import { db } from '../db/schema';
import { workerFetch } from '../db/sync';
import { Button, Card, ErrorNote, Page } from '../ui/kit';

const FIELDS: { health: string; field: string; unit: string; cronometer?: boolean }[] = [
  { health: 'Steps', field: 'steps', unit: 'count' },
  { health: 'Active Energy', field: 'activeKcal', unit: 'kcal' },
  { health: 'Walking + Running Distance', field: 'distanceKm', unit: 'km' },
  { health: 'Exercise Minutes', field: 'exerciseMin', unit: 'min' },
  { health: 'Flights Climbed', field: 'flights', unit: 'count' },
  { health: 'Dietary Energy', field: 'dietKcal', unit: 'kcal', cronometer: true },
  { health: 'Protein', field: 'protein', unit: 'g', cronometer: true },
  { health: 'Carbohydrates', field: 'carbs', unit: 'g', cronometer: true },
  { health: 'Total Fat', field: 'fat', unit: 'g', cronometer: true },
  { health: 'Sodium', field: 'sodiumMg', unit: 'mg', cronometer: true },
];

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        await navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? '✓ Copied' : label}
    </Button>
  );
}

function CopyRow({ value }: { value: string }) {
  return (
    <div className="my-1 flex items-center gap-2 rounded-lg bg-surface-2 p-2">
      <code className="flex-1 break-all text-xs">{value}</code>
      <Copy text={value} />
    </div>
  );
}

function CopyChip({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`rounded-full border px-2.5 py-1 font-mono text-xs ${done ? 'border-good/50 text-good' : 'border-line bg-surface-2'}`}
      onClick={async () => {
        await navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? '✓ ' : ''}
      {value}
    </button>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-ink">{n}</span>
        <h2 className="font-semibold">{title}</h2>
      </div>
      <div className="space-y-2 text-sm">{children}</div>
    </Card>
  );
}

export default function HealthSetupPage() {
  const nav = useNavigate();
  const account = currentAccount();
  // kept on this device only (never synced), so it survives switching to the Shortcuts app and back
  const key = (useLiveQuery(() => db.meta.get('health:key'), [])?.value as string | undefined) ?? null;
  const [error, setError] = useState<string | null>(null);
  const last = useLiveQuery(() => db.activity.orderBy('updatedAt').reverse().filter((a) => a.source === 'apple-health').first(), []);
  const endpoint = account ? `${account.server}/ingest/health` : '';

  if (!account) {
    return (
      <Page title="Apple Health" back={() => nav(-1)}>
        <Card>
          <p className="mb-3 text-sm text-muted">Apple Health data goes through your Lock-In server, so this needs an account.</p>
          <Button variant="primary" className="w-full" onClick={() => nav('/login')}>
            Sign in or create account
          </Button>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Apple Health" back={() => nav(-1)}>
      <p className="-mt-1 mb-3 text-sm text-muted">
        Web apps can't read Apple Health, so an iPhone Shortcut reads today's totals and sends them here. Set it up once (≈10 min); an automation then runs it every day.
      </p>

      <Card title="Status">
        <p className="text-sm">
          {last ? (
            <>
              Last received: <b>{new Date(last.updatedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</b> ({last.steps?.toLocaleString('fi-FI') ?? '–'} steps on {last.date})
            </>
          ) : (
            'Nothing received yet.'
          )}
        </p>
      </Card>

      <Step n={1} title="Create your Shortcut key">
        <p className="text-muted">A separate key just for the Shortcut (not your password). Making a new one stops the old one working.</p>
        {key && (
          <div className="rounded-xl bg-surface-2 p-3">
            <code className="block break-all text-xs">{key}</code>
            <div className="mt-2 flex items-center gap-2">
              <Copy text={key} />
              <span className="text-xs text-faint">Saved on this device. Steps below have copy buttons that include it.</span>
            </div>
          </div>
        )}
        <Button
          variant={key ? 'ghost' : 'primary'}
          onClick={async () => {
            if (key && !confirm('Make a new key? The Shortcut stops working until you paste the new one into it.')) return;
            setError(null);
            try {
              const r = (await workerFetch('/health/key', { method: 'POST' })) as { key: string };
              await setMeta('health:key', r.key);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          {key ? 'Make a new key' : 'Create key'}
        </Button>
        <ErrorNote error={error} />
      </Step>

      <Step n={2} title="Read the numbers (in the Shortcuts app)">
        <p>
          Open <b>Shortcuts</b> → <b>+</b> → name it <b>Lock-In Health</b>. For <b>each</b> row below, add these three actions:
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <b>Find Health Samples</b>, set the type (left column). Tap <i>Add Filter</i> → <b>Start Date</b> <b>is today</b>.
          </li>
          <li>
            <b>Calculate Statistics</b> → <b>Sum</b> of the Health Samples.
          </li>
          <li>
            <b>Set Variable</b>, named exactly as the middle column.
          </li>
        </ol>
        <table className="mt-1 w-full text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-normal">Health type</th>
              <th className="py-1 text-left font-normal">Variable</th>
              <th className="py-1 text-left font-normal">Unit</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((f) => (
              <tr key={f.field} className="border-t border-line">
                <td className="py-1">
                  {f.health}
                  {f.cronometer && <span className="text-faint"> *</span>}
                </td>
                <td className="py-1 font-mono">{f.field}</td>
                <td className="py-1 text-muted">{f.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-faint">
          * Nutrition rows only matter if Cronometer writes to Apple Health (Cronometer → More → Connect Apps &amp; Devices → Apple Health). Skip any row you don't want. If Health shows kJ or miles, switch those types to kcal/km in the Health app.
        </p>
      </Step>

      <Step n={3} title="Get today's date">
        <p className="text-muted">The server needs to know which day the numbers belong to.</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            At the bottom, search for <b>Format Date</b> and tap it to add it.
          </li>
          <li>
            In that action, tap the blue <b>Date</b> → choose <b>Current Date</b>.
          </li>
          <li>
            Tap the small arrow (<b>›</b>) on the action to show more options. Set <b>Date Format</b> to <b>Custom</b>, then type this into <b>Format String</b>:
            <CopyRow value="yyyy-MM-dd" />
          </li>
          <li>
            Add <b>Set Variable</b>. Tap <i>Variable Name</i> and type:
            <CopyRow value="day" />
            Its input should already say <i>Formatted Date</i>.
          </li>
        </ol>
      </Step>

      <Step n={4} title="Send everything to Lock-In">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Search for <b>Get Contents of URL</b> and add it.
          </li>
          <li>
            Tap the blue <b>URL</b> and paste:
            <CopyRow value={endpoint} />
          </li>
          <li>
            Tap the arrow (<b>›</b>) on the action to open its options.
          </li>
          <li>
            <b>Method</b>: tap <i>GET</i> and change it to <b>POST</b>.
          </li>
          <li>
            <b>Headers</b>: tap <i>Add new header</i>.
            <div className="mt-1 space-y-1">
              <div className="text-xs text-muted">Key</div>
              <CopyRow value="Authorization" />
              <div className="text-xs text-muted">Text (the value)</div>
              {key ? (
                <CopyRow value={`Bearer ${key}`} />
              ) : (
                <p className="rounded-lg bg-warn/10 px-2 py-1.5 text-xs text-warn">
                  Create your key in step 1 first. A copy button with the full value (<code>Bearer</code> + space + key) appears here.
                </p>
              )}
            </div>
          </li>
          <li>
            <b>Request Body</b>: choose <b>JSON</b>.
          </li>
          <li>
            Tap <i>Add new field</i> → <b>Text</b>. Key:
            <CopyRow value="date" />
            For the value, long-press (or tap) the text field → <b>Select Variable</b> → tap the <b>day</b> variable.
          </li>
          <li>
            Now one <b>Number</b> field for each variable you made in step 2. Tap <i>Add new field</i> → <b>Number</b>, type the key, and pick the variable with the <b>same name</b> as the value:
            <div className="mt-1 flex flex-wrap gap-1.5">
              {FIELDS.map((f) => (
                <CopyChip key={f.field} value={f.field} />
              ))}
            </div>
            <span className="mt-1 block text-xs text-faint">Only add the ones you made in step 2. Tap a name to copy it.</span>
          </li>
        </ol>
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          When it's done, the action reads like: <i>Get contents of …/ingest/health</i>, Method POST, 1 header, and a JSON body with <code>date</code>, <code>steps</code>, <code>activeKcal</code>…
        </p>
      </Step>

      <Step n={5} title="Run it every day">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            In Shortcuts, open the <b>Automation</b> tab → <b>+</b> (or <i>New Automation</i>) → <b>Time of Day</b>.
          </li>
          <li>
            Set <b>23:45</b>, <b>Daily</b>, and choose <b>Run Immediately</b> (not "Run After Confirmation"). Tap <i>Next</i>.
          </li>
          <li>
            Pick <b>Lock-In Health</b>.
          </li>
          <li>Optional: repeat for 12:00 and 18:00 so steps update during the day.</li>
        </ol>
      </Step>

      <Step n={6} title="Test it">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Open the <b>Lock-In Health</b> shortcut and tap ▶︎ to run it.
          </li>
          <li>iOS asks to read Health data and to connect to your server: <b>Allow</b> both.</li>
          <li>
            It should finish with a reply containing <code>"ok":true</code>. Come back here: the <b>Status</b> at the top updates within a minute.
          </li>
        </ol>
        <p className="text-xs text-faint">
          Error "Unknown Shortcut key" → the header value is wrong or you made a new key since. Error "Missing Shortcut key" → the header key isn't exactly <code>Authorization</code>.
        </p>
      </Step>
    </Page>
  );
}
