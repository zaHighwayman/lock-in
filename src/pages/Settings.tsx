import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CSV_EXPORTS, exportCsv, exportJson, importJson } from '../app/backup';
import { useBodyweight, useSettings, useSyncStatus } from '../app/hooks';
import { getProvider } from '../ai/provider';
import { WEEKDAYS } from '../core/dates';
import type { RunPlanDay, Settings } from '../core/model';
import { proteinTarget } from '../core/rules/nutrition';
import { getMeta, save, setMeta } from '../db/repo';
import { syncNow, workerFetch } from '../db/sync';
import { Button, Card, ErrorNote, Field, NumInput, Page, cx, inputCls } from '../ui/kit';

export default function SettingsPage() {
  const nav = useNavigate();
  const s = useSettings();
  const bw = useBodyweight();
  const set = (changes: Partial<Settings>) => save('settings', { ...s, ...changes });

  return (
    <Page title="Settings" back={() => nav(-1)}>
      <Card title="Targets">
        <div className="mb-3 rounded-xl bg-surface-2 p-3">
          <div className="flex justify-between">
            <span>Protein</span>
            <span className="tnum">
              {s.proteinGPerKg} g/kg → {proteinTarget(bw, s.proteinGPerKg)} g/day
            </span>
          </div>
          <p className="mt-1 text-xs text-faint">Fixed by your medical plan. The app and coach never change it.</p>
        </div>
        <Field label="Sodium ceiling (mg/day)" hint="The number from your doctor or dietitian. Used for the daily sodium bar and recipe limits.">
          <NumInput value={s.sodiumCeilingMg} onChange={(v) => set({ sodiumCeilingMg: v })} placeholder="e.g. 2000" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Height (cm)">
            <NumInput value={s.heightCm} onChange={(v) => v && set({ heightCm: v })} />
          </Field>
          <Field label="Birth year">
            <NumInput value={s.birthYear} onChange={(v) => v && set({ birthYear: v })} />
          </Field>
        </div>
      </Card>

      <Card title="Program" action={<Link to="/program" className="text-sm text-accent">Edit program ›</Link>}>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Start date">
            <input type="date" className={cx(inputCls, 'px-2')} value={s.programStartDate ?? ''} onChange={(e) => set({ programStartDate: e.target.value || null })} />
          </Field>
          <Field label="Deload every">
            <NumInput value={s.deloadEvery} onChange={(v) => v && set({ deloadEvery: v })} />
          </Field>
          <Field label="Block weeks">
            <NumInput value={s.recompWeeks} onChange={(v) => v && set({ recompWeeks: v })} />
          </Field>
        </div>
        <div className="mb-1 text-sm text-muted">Morning runs</div>
        <ul className="space-y-1.5">
          {WEEKDAYS.map((w, i) => {
            const key = String(i + 1);
            const day: RunPlanDay = s.runSchedule[key] ?? {};
            return (
              <li key={w} className="flex items-center gap-2">
                <span className="w-9 text-sm text-muted">{w}</span>
                <select
                  className={cx(inputCls, 'py-1.5 text-sm')}
                  value={day.run ?? ''}
                  onChange={(e) => set({ runSchedule: { ...s.runSchedule, [key]: { ...day, run: (e.target.value || undefined) as RunPlanDay['run'] } } })}
                >
                  <option value="">No run</option>
                  <option value="easy">Easy</option>
                  <option value="intervals">Intervals</option>
                  <option value="benchmark">4 km benchmark</option>
                  <option value="optional-easy">Optional easy</option>
                </select>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Food">
        <Field label="Taste preferences for AI recipes" hint="Likes, dislikes, allergies, budget, kitchen gear. Ratings and edits are learned on top of this.">
          <textarea className={cx(inputCls, 'h-24')} value={s.foodPreferences} onChange={(e) => set({ foodPreferences: e.target.value })} placeholder="e.g. love spicy, no mushrooms, cheap, one big pot" />
        </Field>
      </Card>

      <AiSettings s={s} set={set} />
      <SyncSettings s={s} set={set} />
      <DataSettings lastExportAt={s.lastExportAt} />
    </Page>
  );
}

function useSecret(key: string) {
  const [v, setV] = useState('');
  useEffect(() => {
    getMeta<string>(key, '').then(setV);
  }, [key]);
  return [v, (x: string) => { setV(x); setMeta(key, x.trim()); }] as const;
}

function AiSettings({ s, set }: { s: Settings; set: (c: Partial<Settings>) => void }) {
  const [gemini, setGemini] = useSecret('key:gemini');
  const [claude, setClaude] = useSecret('key:anthropic');
  const [test, setTest] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card title="AI coach">
      <Field label="Provider">
        <select className={inputCls} value={s.aiProvider} onChange={(e) => set({ aiProvider: e.target.value as Settings['aiProvider'] })}>
          <option value="gemini">Gemini (free tier)</option>
          <option value="anthropic">Claude</option>
          <option value="ollama">Ollama (local, PC only)</option>
          <option value="none">Off (rules only)</option>
        </select>
      </Field>
      {s.aiProvider === 'gemini' && (
        <>
          <Field label="Gemini API key" hint="Create one at aistudio.google.com. Stored only on this device.">
            <input type="password" autoComplete="off" className={inputCls} value={gemini} onChange={(e) => setGemini(e.target.value)} />
          </Field>
          <Field label="Model">
            <input className={inputCls} value={s.geminiModel} onChange={(e) => set({ geminiModel: e.target.value })} />
          </Field>
          <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
            Gemini's free tier may use what you send (including food photos) to improve Google's models. The weekly report only sends aggregated weekly numbers.
          </p>
        </>
      )}
      {s.aiProvider === 'anthropic' && (
        <>
          <Field label="Claude API key" hint="From console.anthropic.com. Stored only on this device.">
            <input type="password" autoComplete="off" className={inputCls} value={claude} onChange={(e) => setClaude(e.target.value)} />
          </Field>
          <Field label="Model">
            <input className={inputCls} value={s.anthropicModel} onChange={(e) => set({ anthropicModel: e.target.value })} />
          </Field>
        </>
      )}
      {s.aiProvider === 'ollama' && (
        <>
          <Field label="Ollama URL" hint="Works from the computer running Ollama. Start it with OLLAMA_ORIGINS set to this site's address.">
            <input className={inputCls} value={s.ollamaUrl} onChange={(e) => set({ ollamaUrl: e.target.value })} />
          </Field>
          <Field label="Model" hint="Food photo scanning needs a vision model (e.g. llava, llama3.2-vision).">
            <input className={inputCls} value={s.ollamaModel} onChange={(e) => set({ ollamaModel: e.target.value })} />
          </Field>
        </>
      )}
      {s.aiProvider !== 'none' && (
        <>
          <Button
            size="sm"
            onClick={async () => {
              setTest(null);
              setErr(null);
              try {
                const ai = await getProvider(s);
                const r = await ai.generate('Reply with exactly: ok', [{ role: 'user', text: 'ping' }]);
                setTest(`${ai.name}: ${r.trim().slice(0, 40)}`);
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Test connection
          </Button>
          {test && <p className="mt-2 text-sm text-good">✓ {test}</p>}
          <ErrorNote error={err} />
        </>
      )}
    </Card>
  );
}

function SyncSettings({ s, set }: { s: Settings; set: (c: Partial<Settings>) => void }) {
  const [token, setToken] = useSecret('key:sync');
  const status = useSyncStatus();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function connect(provider: 'withings' | 'oura') {
    setErr(null);
    try {
      const r = (await workerFetch(`/oauth/${provider}/start`, { method: 'POST', body: JSON.stringify({ returnTo: location.href.split('#')[0] + '#/settings' }) })) as { url: string };
      location.href = r.url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function pullNow() {
    setErr(null);
    setMsg('Syncing Withings and Oura…');
    try {
      const r = (await workerFetch('/integrations/run', { method: 'POST' })) as { withings?: string; oura?: string };
      await syncNow();
      setMsg(`Withings: ${r.withings ?? 'not connected'} · Oura: ${r.oura ?? 'not connected'}`);
    } catch (e) {
      setMsg(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card title="Sync & integrations">
      <p className="mb-3 text-xs text-faint">
        Optional. Deploy the Worker in <code>worker/</code> (see README) to sync phone ↔ PC and pull Withings + Oura daily. Without it, everything still works on this device.
      </p>
      <Field label="Server URL">
        <input className={inputCls} placeholder="https://lock-in-api.<you>.workers.dev" value={s.workerUrl} onChange={(e) => set({ workerUrl: e.target.value.trim() })} />
      </Field>
      <Field label="Sync token" hint="The SYNC_TOKEN secret you set on the Worker. Stored only on this device.">
        <input type="password" autoComplete="off" className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} />
      </Field>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className={cx(status.state === 'error' ? 'text-bad' : 'text-muted')}>
          {status.state === 'off' && 'Sync off'}
          {status.state === 'syncing' && 'Syncing…'}
          {status.state === 'idle' && (status.message ?? `Synced ${status.at ? new Date(status.at).toLocaleTimeString() : ''}`)}
          {status.state === 'error' && `Sync error: ${status.message}`}
        </span>
        <Button size="sm" onClick={() => syncNow()} disabled={!s.workerUrl || !token}>
          Sync now
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => connect('withings')} disabled={!s.workerUrl || !token}>
          Connect Withings
        </Button>
        <Button onClick={() => connect('oura')} disabled={!s.workerUrl || !token}>
          Connect Oura
        </Button>
      </div>
      <Button className="mt-2 w-full" variant="ghost" onClick={pullNow} disabled={!s.workerUrl || !token}>
        Pull Withings + Oura now
      </Button>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      <ErrorNote error={err} />
    </Card>
  );
}

function DataSettings({ lastExportAt }: { lastExportAt?: number }) {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);
  return (
    <Card title="Your data">
      <p className="mb-3 text-xs text-faint">
        Last full backup: {lastExportAt ? new Date(lastExportAt).toLocaleDateString() : 'never'} · Storage {persisted ? 'protected from cleanup' : 'not marked persistent'}
      </p>
      <Button variant="primary" className="mb-2 w-full" onClick={() => exportJson()}>
        Export full backup (JSON)
      </Button>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(Object.keys(CSV_EXPORTS) as (keyof typeof CSV_EXPORTS)[]).map((k) => (
          <Button key={k} size="sm" onClick={() => exportCsv(k)}>
            {CSV_EXPORTS[k]} CSV
          </Button>
        ))}
      </div>
      <label className="mb-2 block">
        <span className="inline-flex w-full cursor-pointer justify-center rounded-xl border border-line bg-surface-2 px-4 py-2.5 font-medium">Restore / merge a backup</span>
        <input
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setErr(null);
            try {
              setMsg(`Merged ${await importJson(f)} records.`);
            } catch (x) {
              setErr(x instanceof Error ? x.message : String(x));
            }
          }}
        />
      </label>
      <Link to="/import" className="block rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-center font-medium">
        Import workouts from Strong / Hevy / CSV
      </Link>
      {msg && <p className="mt-2 text-sm text-good">{msg}</p>}
      <ErrorNote error={err} />
    </Card>
  );
}
