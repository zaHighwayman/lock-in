// Guide for the iPhone Shortcut that sends Apple Health day totals to the server.
// (A web app can't read HealthKit; the Shortcut reads it on the phone and posts the numbers.)
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentAccount } from '../db/account';
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
  const [key, setKey] = useState<string | null>(null);
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
        <p className="text-muted">A separate key just for the Shortcut. Creating a new one stops the old one working.</p>
        {key ? (
          <div className="rounded-xl bg-surface-2 p-3">
            <code className="block break-all text-xs">{key}</code>
            <div className="mt-2 flex items-center gap-2">
              <Copy text={key} />
              <span className="text-xs text-warn">Shown once. Paste it into the Shortcut now.</span>
            </div>
          </div>
        ) : (
          <Button
            variant="primary"
            onClick={async () => {
              setError(null);
              try {
                setKey(((await workerFetch('/health/key', { method: 'POST' })) as { key: string }).key);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            {last ? 'Create a new key' : 'Create key'}
          </Button>
        )}
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

      <Step n={3} title="Send them to Lock-In">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Add <b>Format Date</b>: Current Date, Date Format <b>Custom</b>, format <code>yyyy-MM-dd</code>. Then <b>Set Variable</b> named <code>day</code>.
          </li>
          <li>
            Add <b>Get Contents of URL</b>:
            <div className="my-1 flex items-center gap-2 rounded-lg bg-surface-2 p-2">
              <code className="flex-1 break-all text-xs">{endpoint}</code>
              <Copy text={endpoint} />
            </div>
            Tap <i>Show More</i>: Method <b>POST</b>.<br />
            Headers: add <code>Authorization</code> with the value <code>Bearer </code> followed by your key (one space after Bearer).
            <br />
            Request Body: <b>JSON</b>. Add a <b>Text</b> field <code>date</code> = the <code>day</code> variable, then a <b>Number</b> field for each variable from step 2 with the same name (<code>steps</code> = steps, …).
          </li>
        </ol>
      </Step>

      <Step n={4} title="Run it every day">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Shortcuts → <b>Automation</b> → <b>+</b> → <b>Time of Day</b> → <b>23:45</b>, Daily.
          </li>
          <li>
            Choose <b>Run Immediately</b> (not "Run After Confirmation"), then pick <b>Lock-In Health</b>.
          </li>
          <li>Optional: add the same automation at 12:00 and 18:00 so steps update during the day.</li>
        </ol>
      </Step>

      <Step n={5} title="Test it">
        <p>
          Run <b>Lock-In Health</b> once by hand. iOS asks to allow Health access and to connect to your server: allow both. The reply should say <code>"ok": true</code>, and the status at the top of this page updates after the next sync.
        </p>
      </Step>
    </Page>
  );
}
