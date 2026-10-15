import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CSV_EXPORTS, exportCsv, exportJson, importJson } from '../app/backup';
import { useBodyweight, useSettings, useSyncStatus } from '../app/hooks';
import { GROQ_URL, listModels, providerById } from '../ai/provider';
import { WEEKDAYS } from '../core/dates';
import type { AiProviderId, RunPlanDay, Settings } from '../core/model';
import { fmtSalt, proteinTarget } from '../core/rules/nutrition';
import { adminOverview, changePassword, createInvite, deleteAccount, signOut, type AdminOverview } from '../app/auth';
import { currentAccount } from '../db/account';
import { getMeta, save, setMeta } from '../db/repo';
import { syncNow, workerFetch } from '../db/sync';

const account = currentAccount();
import { Button, Card, ErrorNote, Field, LiveText, NumInput, Page, cx, inputCls } from '../ui/kit';

export default function SettingsPage() {
  const nav = useNavigate();
  const s = useSettings();
  const bw = useBodyweight();
  const set = (changes: Partial<Settings>) => save('settings', { ...s, ...changes });

  return (
    <Page title="Settings" back={() => nav(-1)}>
      <AccountCard />
      {account?.isAdmin && <AdminCard />}

      <Card title="Profile" action={<Link to="/profile" className="text-sm text-accent">Edit ›</Link>}>
        <ul className="space-y-1 text-sm">
          <li className="flex justify-between">
            <span className="text-muted">Goal</span>
            <span>{{ recomp: 'Recomp', 'lean-bulk': 'Lean bulk', cut: 'Cut' }[s.goal]}</span>
          </li>
          <li className="flex justify-between">
            <span className="text-muted">Protein</span>
            <span className="tnum">
              {s.proteinGPerKg} g/kg → {proteinTarget(bw, s.proteinGPerKg)} g/day{s.proteinLocked ? ' · locked' : ''}
            </span>
          </li>
          <li className="flex justify-between">
            <span className="text-muted">Salt</span>
            <span className="tnum">{s.lowSodium ? `low-salt${s.sodiumCeilingMg ? ` · ≤ ${fmtSalt(s.sodiumCeilingMg)} g/day` : ' · set a limit'}` : 'normal'}</span>
          </li>
          {s.dietNotes && (
            <li className="flex justify-between gap-3">
              <span className="text-muted">Diet notes</span>
              <span className="truncate">{s.dietNotes}</span>
            </li>
          )}
        </ul>
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
          <LiveText multiline className="h-24" value={s.foodPreferences} onCommit={(v) => set({ foodPreferences: v })} placeholder="e.g. love spicy, no mushrooms, cheap, one big pot" />
        </Field>
      </Card>

      <AiSettings s={s} set={set} />
      <IntegrationsCard />
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

const PROVIDER_OPTIONS: { value: AiProviderId; label: string }[] = [
  { value: 'gemini', label: 'Gemini (free tier)' },
  { value: 'groq', label: 'Groq (free tier, fast)' },
  { value: 'openai', label: 'Other: OpenRouter, Cerebras, Mistral…' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'ollama', label: 'Ollama (local, PC only)' },
];

/** Model name field with an optional "load list" button for OpenAI-compatible APIs. */
function ModelField({ label, hint, value, onCommit, listFrom }: { label: string; hint?: string; value: string; onCommit: (v: string) => void; listFrom?: { url: string; keyName: string } }) {
  const [models, setModels] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Field label={label} hint={hint}>
      <div className="flex gap-2">
        {models ? (
          <select className={inputCls} value={models.includes(value) ? value : ''} onChange={(e) => onCommit(e.target.value)}>
            <option value="">{value ? `${value} (not in list)` : 'Choose…'}</option>
            {models.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        ) : (
          <LiveText value={value} onCommit={(v) => onCommit(v.trim())} placeholder="model id" />
        )}
        {listFrom && (
          <Button
            size="sm"
            onClick={async () => {
              setErr(null);
              try {
                setModels(await listModels(listFrom.url, await getMeta<string>(listFrom.keyName, '')));
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            {models ? '↻' : 'List'}
          </Button>
        )}
      </div>
      <ErrorNote error={err} />
    </Field>
  );
}

function KeyField({ name, label, hint }: { name: string; label: string; hint: string }) {
  const [v, setV] = useSecret(`key:${name}`);
  return (
    <Field label={label} hint={hint}>
      <input type="password" autoComplete="off" className={inputCls} value={v} onChange={(e) => setV(e.target.value)} />
    </Field>
  );
}

function ProviderFields({ id, s, set }: { id: AiProviderId; s: Settings; set: (c: Partial<Settings>) => void }) {
  switch (id) {
    case 'gemini':
      return (
        <>
          <KeyField name="gemini" label="Gemini API key" hint="Create one at aistudio.google.com. Stored only on this device." />
          <ModelField label="Gemini model" hint="If it's often busy, try a lighter model such as gemini-flash-lite-latest." value={s.geminiModel} onCommit={(v) => set({ geminiModel: v })} />
          <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">Gemini's free tier may use what you send (including food photos) to improve Google's models.</p>
        </>
      );
    case 'groq':
      return (
        <>
          <KeyField name="groq" label="Groq API key" hint="Free at console.groq.com → API Keys. Stored only on this device." />
          <ModelField label="Text model" value={s.groqModel} onCommit={(v) => set({ groqModel: v })} listFrom={{ url: GROQ_URL, keyName: 'key:groq' }} />
          <ModelField label="Vision model (food photos)" hint="Needs a model that accepts images (see console.groq.com/docs/vision)." value={s.groqVisionModel} onCommit={(v) => set({ groqVisionModel: v })} listFrom={{ url: GROQ_URL, keyName: 'key:groq' }} />
          <p className="mb-3 text-xs text-faint">The free plan has per-minute and daily limits. Check Groq's terms for how they handle your data.</p>
        </>
      );
    case 'openai':
      return (
        <>
          <Field label="API base URL" hint="OpenRouter: https://openrouter.ai/api/v1 · Cerebras: https://api.cerebras.ai/v1 · Mistral: https://api.mistral.ai/v1">
            <LiveText value={s.openaiBaseUrl} onCommit={(v) => set({ openaiBaseUrl: v.trim() })} />
          </Field>
          <KeyField name="openai" label="API key" hint="Stored only on this device." />
          <ModelField label="Text model" hint="On OpenRouter, free models end in :free." value={s.openaiModel} onCommit={(v) => set({ openaiModel: v })} listFrom={{ url: s.openaiBaseUrl, keyName: 'key:openai' }} />
          <ModelField label="Vision model (food photos, optional)" hint="Leave empty to use the text model; it must then accept images." value={s.openaiVisionModel} onCommit={(v) => set({ openaiVisionModel: v })} listFrom={{ url: s.openaiBaseUrl, keyName: 'key:openai' }} />
        </>
      );
    case 'anthropic':
      return (
        <>
          <KeyField name="anthropic" label="Claude API key" hint="From console.anthropic.com. Stored only on this device." />
          <ModelField label="Claude model" value={s.anthropicModel} onCommit={(v) => set({ anthropicModel: v })} />
        </>
      );
    case 'ollama':
      return (
        <>
          <Field label="Ollama URL" hint="Works from the computer running Ollama. Start it with OLLAMA_ORIGINS set to this site's address.">
            <LiveText value={s.ollamaUrl} onCommit={(v) => set({ ollamaUrl: v.trim() })} />
          </Field>
          <ModelField label="Ollama model" hint="Food photo scanning needs a vision model (e.g. llama3.2-vision)." value={s.ollamaModel} onCommit={(v) => set({ ollamaModel: v })} />
        </>
      );
  }
}

function TestButton({ id, s, label }: { id: AiProviderId; s: Settings; label: string }) {
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mb-3">
      <Button
        size="sm"
        onClick={async () => {
          setOk(null);
          setErr(null);
          try {
            const ai = await providerById(id, s);
            const r = await ai.generate('Reply with exactly: ok', [{ role: 'user', text: 'ping' }]);
            setOk(`${ai.name}: ${r.trim().slice(0, 40)}`);
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        {label}
      </Button>
      {ok && <p className="mt-2 text-sm text-good">✓ {ok}</p>}
      <ErrorNote error={err} />
    </div>
  );
}

function AiSettings({ s, set }: { s: Settings; set: (c: Partial<Settings>) => void }) {
  return (
    <Card title="AI coach">
      <Field label="Provider">
        <select className={inputCls} value={s.aiProvider} onChange={(e) => set({ aiProvider: e.target.value as Settings['aiProvider'] })}>
          {PROVIDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value="none">Off (rules only)</option>
        </select>
      </Field>
      {s.aiProvider !== 'none' && (
        <>
          <ProviderFields id={s.aiProvider} s={s} set={set} />
          <TestButton id={s.aiProvider} s={s} label="Test connection" />
          <div className="mt-2 border-t border-line pt-3">
            <Field label="When it's busy or failing, switch to" hint="The app retries once, then uses this. Set it up with a different provider so one outage doesn't stop the coach.">
              <select className={inputCls} value={s.aiFallback} onChange={(e) => set({ aiFallback: e.target.value as Settings['aiFallback'] })}>
                <option value="none">No fallback</option>
                {PROVIDER_OPTIONS.filter((o) => o.value !== s.aiProvider).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            {s.aiFallback !== 'none' && s.aiFallback !== s.aiProvider && (
              <>
                <ProviderFields id={s.aiFallback} s={s} set={set} />
                <TestButton id={s.aiFallback} s={s} label="Test fallback" />
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function AccountCard() {
  const nav = useNavigate();
  const status = useSyncStatus();
  const [pw, setPw] = useState<'none' | 'change' | 'delete'>('none');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!account) {
    return (
      <Card title="Account">
        <p className="mb-3 text-sm text-muted">Using this device only. Sign in to sync between your devices and connect Withings or Oura.</p>
        <Button variant="primary" className="w-full" onClick={() => nav('/login')}>
          Sign in or create account
        </Button>
      </Card>
    );
  }

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      setPw('none');
      setOldPw('');
      setNewPw('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card title="Account">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="font-medium">
            {account.username} {account.isAdmin && <span className="ml-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">admin</span>}
          </div>
          <div className="text-xs text-faint">{account.server.replace(/^https?:\/\//, '')}</div>
        </div>
        <Button size="sm" onClick={() => syncNow()}>
          Sync now
        </Button>
      </div>
      <p className={cx('mb-3 text-sm', status.state === 'error' || status.state === 'signed-out' ? 'text-bad' : 'text-muted')}>
        {status.state === 'syncing' && 'Syncing…'}
        {status.state === 'idle' && (status.message ?? `Synced ${status.at ? new Date(status.at).toLocaleTimeString() : ''}`)}
        {status.state === 'error' && `Sync error: ${status.message}`}
        {status.state === 'signed-out' && status.message}
        {status.state === 'off' && 'Sync off'}
      </p>
      {status.state === 'signed-out' && (
        <Button variant="primary" className="mb-2 w-full" onClick={() => nav('/login')}>
          Sign in again
        </Button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" onClick={() => signOut(false)}>
          Sign out
        </Button>
        <Button size="sm" onClick={() => setPw(pw === 'change' ? 'none' : 'change')}>
          Change password
        </Button>
      </div>
      <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={() => confirm("Sign out and delete this account's data from this device? It stays on the server.") && signOut(true)}>
        Sign out and remove data from this device
      </Button>
      {pw === 'change' && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3">
          <Field label="Current password">
            <input type="password" autoComplete="current-password" className={inputCls} value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </Field>
          <Field label="New password (8+ characters)">
            <input type="password" autoComplete="new-password" className={inputCls} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </Field>
          <Button variant="primary" className="w-full" disabled={!oldPw || newPw.length < 8} onClick={() => run(() => changePassword(oldPw, newPw), 'Password changed. Other devices were signed out.')}>
            Change password
          </Button>
        </div>
      )}
      <button className="mt-3 text-xs text-faint" onClick={() => setPw(pw === 'delete' ? 'none' : 'delete')}>
        Delete account…
      </button>
      {pw === 'delete' && (
        <div className="mt-2 rounded-xl border border-bad/30 bg-bad/10 p-3">
          <p className="mb-2 text-sm text-bad">Deletes the account and all its data from the server and this device. Export a backup first if you want to keep anything.</p>
          <Field label="Password">
            <input type="password" autoComplete="current-password" className={inputCls} value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </Field>
          <Button variant="danger" className="w-full" disabled={!oldPw} onClick={() => run(() => deleteAccount(oldPw), '')}>
            Delete my account
          </Button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-good">{msg}</p>}
      <ErrorNote error={err} />
    </Card>
  );
}

function AdminCard() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => adminOverview().then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    load();
  }, []);
  const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString() : '–');
  return (
    <Card title="Users (admin)">
      {data && (
        <ul className="mb-3 divide-y divide-line text-sm">
          {data.users.map((u) => (
            <li key={u.username} className="flex justify-between py-1.5">
              <span>
                {u.username}
                {u.isAdmin && <span className="ml-1 text-xs text-accent">admin</span>}
              </span>
              <span className="text-xs text-muted tnum">
                last seen {day(u.lastSeen)} · {u.records} records
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button
        className="w-full"
        onClick={async () => {
          setErr(null);
          try {
            const r = await createInvite();
            setFresh(r.code);
            load();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Create invite code
      </Button>
      {fresh && (
        <div className="mt-3 rounded-xl bg-surface-2 p-3 text-center">
          <div className="text-2xl font-semibold tracking-widest tnum">{fresh}</div>
          <p className="mt-1 text-xs text-muted">Single use, valid 14 days. Send it with the server address: {account?.server}</p>
          <Button size="sm" className="mt-2" onClick={() => navigator.clipboard?.writeText(`Lock-In invite\nApp: ${location.origin}${location.pathname}\nServer: ${account?.server}\nInvite code: ${fresh}`)}>
            Copy invite message
          </Button>
        </div>
      )}
      {data && data.invites.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted">Recent invites</summary>
          <ul className="mt-1 text-xs text-muted tnum">
            {data.invites.map((i) => (
              <li key={i.code} className="flex justify-between py-0.5">
                <span>{i.code}</span>
                <span>{i.usedBy ? `used by ${i.usedBy}` : i.expiresAt < Date.now() ? 'expired' : `open until ${day(i.expiresAt)}`}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ErrorNote error={err} />
    </Card>
  );
}

function IntegrationsCard() {
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
    setMsg('Pulling from Withings and Oura…');
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
    <Card title="Withings & Oura">
      {!account && <p className="mb-3 text-sm text-muted">Needs an account (see Account above).</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => connect('withings')} disabled={!account}>
          Connect Withings
        </Button>
        <Button onClick={() => connect('oura')} disabled={!account}>
          Connect Oura
        </Button>
      </div>
      <Button className="mt-2 w-full" variant="ghost" onClick={pullNow} disabled={!account}>
        Pull now
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
