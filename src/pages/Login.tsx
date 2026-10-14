import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasLocalData, register, serverStatus, signIn } from '../app/auth';
import { lastServer } from '../db/account';
import { Button, Card, ErrorNote, Field, Page, Segmented, inputCls } from '../ui/kit';

export default function LoginPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [server, setServer] = useState(lastServer());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [localData, setLocalData] = useState(false);
  const [moveData, setMoveData] = useState(false);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hasLocalData().then(setLocalData);
  }, []);

  // moving this device's data is the natural choice when creating an account, not when signing in
  useEffect(() => setMoveData(mode === 'create' && localData), [mode, localData]);

  useEffect(() => {
    setNeedsSetup(null);
    if (!/^https?:\/\/\S+$/.test(server.trim())) return;
    const t = setTimeout(() => {
      serverStatus(server.trim())
        .then((s) => {
          setNeedsSetup(s.needsSetup);
          if (s.needsSetup) setMode('create');
        })
        .catch(() => setNeedsSetup(null));
    }, 400);
    return () => clearTimeout(t);
  }, [server]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const s = server.trim();
      if (mode === 'signin') await signIn(s, username.trim(), password, moveData);
      else await register(s, username.trim(), password, invite.trim(), moveData);
      // the app reloads into the account
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Page title="Account" back={() => nav(-1)}>
      <Card>
        <Field label="Server address" hint="Your Lock-In server (the Cloudflare Worker URL). Ask whoever invited you.">
          <input className={inputCls} inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://lock-in-api.….workers.dev" value={server} onChange={(e) => setServer(e.target.value)} />
        </Field>
        {needsSetup && (
          <p className="mb-3 rounded-lg bg-info/10 px-3 py-2 text-sm text-info">
            This server has no accounts yet. Create the first one: it becomes the admin. Use your <b>SYNC_TOKEN</b> secret as the setup code.
          </p>
        )}
        <Segmented
          className="mb-3"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'signin', label: 'Sign in' },
            { value: 'create', label: 'Create account' },
          ]}
        />
        <Field label="Username" hint={mode === 'create' ? '3–32 characters: a–z, 0–9, _ . -' : undefined}>
          <input className={inputCls} autoCapitalize="off" autoCorrect="off" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} />
        </Field>
        <Field label="Password" hint={mode === 'create' ? 'At least 8 characters.' : undefined}>
          <input type="password" className={inputCls} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {mode === 'create' && (
          <Field label={needsSetup ? 'Setup code' : 'Invite code'} hint={needsSetup ? 'The SYNC_TOKEN you set on the server.' : 'You get this from the admin.'}>
            <input className={inputCls} autoCapitalize="characters" autoCorrect="off" value={invite} onChange={(e) => setInvite(e.target.value)} />
          </Field>
        )}
        {localData && (
          <label className="mb-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={moveData} onChange={(e) => setMoveData(e.target.checked)} />
            <span>
              Move the data on this device into this account
              <span className="block text-xs text-faint">
                {mode === 'create' ? 'Recommended for your own first account.' : 'Only if this data is yours. It will overwrite older versions in the account.'}
              </span>
            </span>
          </label>
        )}
        <ErrorNote error={error} />
        <Button variant="primary" className="w-full" disabled={busy || !server.trim() || !username.trim() || password.length < 1 || (mode === 'create' && !invite.trim())} onClick={submit}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </Card>
      <p className="px-1 text-xs text-faint">
        Other users can't see your data, in the app or on a shared device. The person who runs the server can technically access its database. Without an account, the app keeps working on this device only.
      </p>
    </Page>
  );
}
