// Lock-In server (Cloudflare Workers + D1).
// - /auth/*: invite-only accounts with username + password, bearer sessions
// - /admin/*: the admin (first account) creates invite codes and sees who has an account
// - /sync/push, /sync/pull: last-write-wins record sync, partitioned per user
// - /oauth/:provider/start|callback + daily cron: per-user Withings + Oura pulls
// - /ingest/health: the user's iPhone Shortcut posts Apple Health day totals (activity + Cronometer nutrition)
// Every user only ever reads and writes rows with their own user_id.

export interface Env {
  DB: D1Database;
  /** one-time setup code for the first (admin) account */
  SYNC_TOKEN: string;
  TOKEN_KEY: string;
  ALLOWED_ORIGIN: string;
  /** optional override; defaults to the URL the Worker is reached at */
  PUBLIC_URL?: string;
  WITHINGS_CLIENT_ID?: string;
  WITHINGS_CLIENT_SECRET?: string;
  OURA_CLIENT_ID?: string;
  OURA_CLIENT_SECRET?: string;
}

type Provider = 'withings' | 'oura';

interface User {
  id: string;
  username: string;
  is_admin: number;
}

interface SyncRecord {
  table: string;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: unknown;
}

const ALLOWED_TABLES = new Set([
  'exercises', 'programDays', 'sessions', 'sets', 'runs', 'body', 'sleep', 'foods', 'foodLog',
  'savedMeals', 'recipes', 'recipeFeedback', 'batches', 'mealPlans', 'coachReports', 'chat', 'settings', 'aliases', 'activity',
]);

const DAY = 86_400_000;
const SESSION_DAYS = 180;
const INVITE_DAYS = 14;
const MAX_FAILED = 10;
const LOCK_MINUTES = 15;
const PBKDF2_ITERATIONS = 100_000; // Workers' maximum

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- helpers

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const ok = origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  return ok
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }
    : {};
}

function json(body: unknown, init: ResponseInit = {}, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...extra } });
}

const enc = new TextEncoder();

async function sha256(s: string) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && a.length === b.length;
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

function inviteCode() {
  // readable, no 0/O/1/I
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = Array.from(r, (b) => abc[b % abc.length]).join('');
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

async function hmac(env: Env, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.TOKEN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function aesKey(env: Env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`tokens:${env.TOKEN_KEY}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(env: Env, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(JSON.stringify(value)));
  return `${b64url(iv)}.${b64url(ct)}`;
}

async function decrypt<T>(env: Env, s: string): Promise<T> {
  const [iv, ct] = s.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(env), fromB64url(ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

const helsinkiDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki' }).format(d);
const helsinkiTime = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

// ---------------------------------------------------------------- accounts

async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256);
  return b64url(bits);
}

function validUsername(u: unknown): u is string {
  return typeof u === 'string' && /^[a-z0-9_.-]{3,32}$/.test(u);
}

function validPassword(p: unknown): p is string {
  return typeof p === 'string' && p.length >= 8 && p.length <= 200;
}

async function createSession(env: Env, userId: string) {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, now + SESSION_DAYS * DAY)
    .run();
  return token;
}

const publicUser = (u: User) => ({ id: u.id, username: u.username, isAdmin: !!u.is_admin });

async function register(env: Env, body: { username?: unknown; password?: unknown; invite?: unknown }) {
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (!validUsername(username)) throw new HttpError(400, 'Username: 3–32 characters, a–z, 0–9, _ . -');
  if (!validPassword(body.password)) throw new HttpError(400, 'Password: at least 8 characters');
  const invite = typeof body.invite === 'string' ? body.invite.trim() : '';
  const now = Date.now();

  const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0;
  const first = count === 0;
  if (first) {
    if (!invite || !(await safeEqual(invite, env.SYNC_TOKEN))) throw new HttpError(403, 'The first account needs the setup code (the SYNC_TOKEN secret).');
  } else {
    const inv = await env.DB.prepare('SELECT code, expires_at, used_by FROM invites WHERE code = ?').bind(invite.toUpperCase()).first<{ code: string; expires_at: number; used_by: string | null }>();
    if (!inv || inv.used_by || inv.expires_at < now) throw new HttpError(403, 'Invite code is invalid, used or expired.');
  }
  if (await env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) throw new HttpError(409, 'That username is taken.');

  const id = randomToken(12);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const stmts = [
    env.DB.prepare('INSERT INTO users (id, username, pass_hash, salt, is_admin, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      id, username, await hashPassword(body.password as string, salt), b64url(salt), first ? 1 : 0, now, now,
    ),
  ];
  if (first) {
    // the admin inherits anything synced before accounts existed
    stmts.push(env.DB.prepare("UPDATE records SET user_id = ? WHERE user_id = ''").bind(id));
    stmts.push(env.DB.prepare("UPDATE tokens SET user_id = ? WHERE user_id = ''").bind(id));
  } else {
    stmts.push(env.DB.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').bind(id, now, invite.toUpperCase()));
  }
  await env.DB.batch(stmts);
  return { token: await createSession(env, id), user: publicUser({ id, username, is_admin: first ? 1 : 0 }) };
}

async function login(env: Env, body: { username?: unknown; password?: unknown }) {
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const row = await env.DB.prepare('SELECT id, username, pass_hash, salt, is_admin, failed_count, locked_until FROM users WHERE username = ?')
    .bind(username)
    .first<User & { pass_hash: string; salt: string; failed_count: number; locked_until: number | null }>();
  const now = Date.now();
  if (row?.locked_until && row.locked_until > now) throw new HttpError(429, `Too many wrong passwords. Try again in ${Math.ceil((row.locked_until - now) / 60000)} min.`);
  // always hash, so a missing user takes as long as a wrong password
  const hash = await hashPassword(password, row ? fromB64url(row.salt) : new Uint8Array(16));
  if (!row || !(await safeEqual(hash, row.pass_hash))) {
    if (row) {
      const failed = row.failed_count + 1;
      await env.DB.prepare('UPDATE users SET failed_count = ?, locked_until = ? WHERE id = ?')
        .bind(failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? now + LOCK_MINUTES * 60000 : null, row.id)
        .run();
    }
    throw new HttpError(401, 'Wrong username or password.');
  }
  await env.DB.prepare('UPDATE users SET failed_count = 0, locked_until = NULL, last_seen = ? WHERE id = ?').bind(now, row.id).run();
  return { token: await createSession(env, row.id), user: publicUser(row) };
}

async function authenticate(req: Request, env: Env): Promise<User & { tokenHash: string }> {
  const h = req.headers.get('Authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'Not signed in.');
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    'SELECT u.id, u.username, u.is_admin, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
  )
    .bind(tokenHash)
    .first<User & { expires_at: number }>();
  const now = Date.now();
  if (!row || row.expires_at < now) throw new HttpError(401, 'Session expired. Sign in again.');
  // sliding expiry, refreshed at most daily
  if (row.expires_at - now < (SESSION_DAYS - 1) * DAY) {
    await env.DB.batch([
      env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_DAYS * DAY, tokenHash),
      env.DB.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, row.id),
    ]);
  }
  return { id: row.id, username: row.username, is_admin: row.is_admin, tokenHash };
}

async function checkPassword(env: Env, userId: string, password: unknown) {
  const row = await env.DB.prepare('SELECT pass_hash, salt FROM users WHERE id = ?').bind(userId).first<{ pass_hash: string; salt: string }>();
  return !!row && typeof password === 'string' && (await safeEqual(await hashPassword(password, fromB64url(row.salt)), row.pass_hash));
}

async function changePassword(env: Env, user: User & { tokenHash: string }, body: { oldPassword?: unknown; newPassword?: unknown }) {
  if (!(await checkPassword(env, user.id, body.oldPassword))) throw new HttpError(401, 'Current password is wrong.');
  if (!validPassword(body.newPassword)) throw new HttpError(400, 'New password: at least 8 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?').bind(await hashPassword(body.newPassword, salt), b64url(salt), user.id),
    // sign out every other device
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, user.tokenHash),
  ]);
}

async function deleteAccount(env: Env, user: User, body: { password?: unknown }) {
  if (!(await checkPassword(env, user.id, body.password))) throw new HttpError(401, 'Password is wrong.');
  if (user.is_admin) {
    const others = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id != ?').bind(user.id).first<{ n: number }>())?.n ?? 0;
    if (others > 0) throw new HttpError(400, 'The admin account can only be deleted after all other accounts are gone.');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM records WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM tokens WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM invites WHERE created_by = ? AND used_by IS NULL').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
}

// ---------------------------------------------------------------- admin

function requireAdmin(user: User) {
  if (!user.is_admin) throw new HttpError(403, 'Admin only.');
}

async function adminOverview(env: Env) {
  const users = await env.DB.prepare(
    'SELECT u.username, u.is_admin, u.created_at, u.last_seen, (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id AND r.deleted = 0) AS records FROM users u ORDER BY u.created_at',
  ).all<{ username: string; is_admin: number; created_at: number; last_seen: number | null; records: number }>();
  const invites = await env.DB.prepare(
    'SELECT i.code, i.created_at, i.expires_at, i.used_at, u.username AS used_by FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 20',
  ).all<{ code: string; created_at: number; expires_at: number; used_at: number | null; used_by: string | null }>();
  return {
    users: users.results.map((u) => ({ username: u.username, isAdmin: !!u.is_admin, createdAt: u.created_at, lastSeen: u.last_seen, records: u.records })),
    invites: invites.results.map((i) => ({ code: i.code, createdAt: i.created_at, expiresAt: i.expires_at, usedBy: i.used_by, usedAt: i.used_at })),
  };
}

async function createInvite(env: Env, user: User) {
  const code = inviteCode();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO invites (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(code, user.id, now, now + INVITE_DAYS * DAY).run();
  return { code, expiresAt: now + INVITE_DAYS * DAY };
}

// ---------------------------------------------------------------- sync

async function upsert(env: Env, userId: string, records: SyncRecord[]) {
  let written = 0;
  for (const r of records) {
    if (!ALLOWED_TABLES.has(r.table) || typeof r.id !== 'string' || typeof r.updatedAt !== 'number') continue;
    const existing = await env.DB.prepare('SELECT updated_at FROM records WHERE user_id = ? AND tbl = ? AND id = ?').bind(userId, r.table, r.id).first<{ updated_at: number }>();
    if (existing && existing.updated_at >= r.updatedAt) continue;
    // delete + insert so the row gets a fresh seq and the user's other devices pull it
    await env.DB.batch([
      env.DB.prepare('DELETE FROM records WHERE user_id = ? AND tbl = ? AND id = ?').bind(userId, r.table, r.id),
      env.DB.prepare('INSERT INTO records (user_id, tbl, id, updated_at, deleted, data) VALUES (?, ?, ?, ?, ?, ?)').bind(
        userId, r.table, r.id, r.updatedAt, r.deleted ? 1 : 0, r.deleted ? null : JSON.stringify(r.data),
      ),
    ]);
    written++;
  }
  return written;
}

async function pull(env: Env, userId: string, since: number) {
  const LIMIT = 500;
  const { results } = await env.DB.prepare('SELECT seq, tbl, id, updated_at, deleted, data FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?')
    .bind(userId, since, LIMIT)
    .all<{ seq: number; tbl: string; id: string; updated_at: number; deleted: number; data: string | null }>();
  const records: SyncRecord[] = results.map((r) => ({ table: r.tbl, id: r.id, updatedAt: r.updated_at, deleted: !!r.deleted, data: r.data ? JSON.parse(r.data) : null }));
  return { records, cursor: results.length ? results[results.length - 1].seq : since, more: results.length === LIMIT };
}

// ---------------------------------------------------------------- oauth

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

const OAUTH = {
  withings: { authorize: 'https://account.withings.com/oauth2_user/authorize2', scope: 'user.metrics' },
  oura: { authorize: 'https://cloud.ouraring.com/oauth/authorize', scope: 'daily heartrate personal' },
} as const;

function clientFor(env: Env, p: Provider) {
  const id = p === 'withings' ? env.WITHINGS_CLIENT_ID : env.OURA_CLIENT_ID;
  const secret = p === 'withings' ? env.WITHINGS_CLIENT_SECRET : env.OURA_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(400, `${p} isn't set up on this server yet (client id/secret missing).`);
  return { id, secret };
}

const redirectUri = (env: Env, origin: string, p: Provider) => `${(env.PUBLIC_URL || origin).replace(/\/$/, '')}/oauth/${p}/callback`;

async function startOAuth(env: Env, origin: string, userId: string, p: Provider, returnTo: string) {
  const { id } = clientFor(env, p);
  const payload = b64url(enc.encode(JSON.stringify({ p, u: userId, r: returnTo, t: Date.now() })));
  const state = `${payload}.${await hmac(env, payload)}`;
  const u = new URL(OAUTH[p].authorize);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', id);
  u.searchParams.set('scope', OAUTH[p].scope);
  u.searchParams.set('redirect_uri', redirectUri(env, origin, p));
  u.searchParams.set('state', state);
  return u.toString();
}

async function tokenRequest(env: Env, p: Provider, params: Record<string, string>): Promise<Tokens> {
  const { id, secret } = clientFor(env, p);
  if (p === 'withings') {
    const res = await fetch('https://wbsapi.withings.net/v2/oauth2', {
      method: 'POST',
      body: new URLSearchParams({ action: 'requesttoken', client_id: id, client_secret: secret, ...params }),
    });
    const j = (await res.json()) as { status: number; body?: { access_token: string; refresh_token: string; expires_in: number }; error?: string };
    if (j.status !== 0 || !j.body) throw new Error(`Withings token error ${j.status} ${j.error ?? ''}`);
    return { access_token: j.body.access_token, refresh_token: j.body.refresh_token, expires_at: Date.now() + j.body.expires_in * 1000 };
  }
  const res = await fetch('https://api.ouraring.com/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  if (!res.ok) throw new Error(`Oura token error ${res.status}`);
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + j.expires_in * 1000 };
}

async function saveTokens(env: Env, userId: string, p: Provider, t: Tokens) {
  await env.DB.prepare(
    'INSERT INTO tokens (user_id, provider, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
  )
    .bind(userId, p, await encrypt(env, t), Date.now())
    .run();
}

async function accessToken(env: Env, userId: string, p: Provider): Promise<string | null> {
  const row = await env.DB.prepare('SELECT data FROM tokens WHERE user_id = ? AND provider = ?').bind(userId, p).first<{ data: string }>();
  if (!row) return null;
  let t = await decrypt<Tokens>(env, row.data);
  if (t.expires_at - Date.now() < 5 * 60_000) {
    t = await tokenRequest(env, p, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
    await saveTokens(env, userId, p, t);
  }
  return t.access_token;
}

async function oauthCallback(env: Env, p: Provider, url: URL): Promise<Response> {
  const [payload, sig] = (url.searchParams.get('state') ?? '').split('.');
  if (!payload || !sig || !(await safeEqual(sig, await hmac(env, payload)))) return new Response('Bad state', { status: 400 });
  const st = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { p: Provider; u: string; r: string; t: number };
  if (st.p !== p || Date.now() - st.t > 15 * 60_000) return new Response('Expired, try connecting again', { status: 400 });
  if (!(await env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(st.u).first())) return new Response('Account not found', { status: 400 });
  const code = url.searchParams.get('code');
  if (!code) return new Response(`Not connected: ${url.searchParams.get('error') ?? 'no code'}`, { status: 400 });
  const tokens = await tokenRequest(env, p, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, url.origin, p) });
  await saveTokens(env, st.u, p, tokens);
  await (p === 'withings' ? syncWithings(env, st.u, 30) : syncOura(env, st.u, 30));
  const back = st.r.startsWith(env.ALLOWED_ORIGIN) || /^http:\/\/localhost:\d+/.test(st.r) ? st.r : env.ALLOWED_ORIGIN;
  return Response.redirect(back, 302);
}

// ---------------------------------------------------------------- integrations

async function syncWithings(env: Env, userId: string, days: number): Promise<string> {
  const token = await accessToken(env, userId, 'withings');
  if (!token) return 'not connected';
  const end = Math.floor(Date.now() / 1000);
  const res = await fetch('https://wbsapi.withings.net/measure', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams({ action: 'getmeas', meastypes: '1,6', category: '1', startdate: String(end - days * 86400), enddate: String(end) }),
  });
  const j = (await res.json()) as { status: number; body?: { measuregrps: { date: number; measures: { value: number; type: number; unit: number }[] }[] } };
  if (j.status !== 0 || !j.body) return `error ${j.status}`;
  const byDay = new Map<string, { date: string; weightKg?: number; bodyFatPct?: number; ts: number }>();
  for (const g of j.body.measuregrps) {
    const date = helsinkiDate(new Date(g.date * 1000));
    const cur = byDay.get(date);
    if (cur && cur.ts > g.date) continue;
    const rec = { date, ts: g.date, weightKg: cur?.weightKg, bodyFatPct: cur?.bodyFatPct };
    for (const m of g.measures) {
      const v = m.value * 10 ** m.unit;
      if (m.type === 1) rec.weightKg = Math.round(v * 100) / 100;
      if (m.type === 6) rec.bodyFatPct = Math.round(v * 10) / 10;
    }
    byDay.set(date, rec);
  }
  const now = Date.now();
  const records: SyncRecord[] = [...byDay.values()]
    .filter((r) => r.weightKg !== undefined)
    .map((r) => ({ table: 'body', id: `withings-${r.date}`, updatedAt: now, deleted: false, data: { id: `withings-${r.date}`, updatedAt: now, date: r.date, weightKg: r.weightKg, bodyFatPct: r.bodyFatPct, source: 'withings' } }));
  await upsert(env, userId, records);
  return `${records.length} days`;
}

async function syncOura(env: Env, userId: string, days: number): Promise<string> {
  const token = await accessToken(env, userId, 'oura');
  if (!token) return 'not connected';
  const end = helsinkiDate(new Date(Date.now() + DAY));
  const start = helsinkiDate(new Date(Date.now() - days * DAY));
  const get = async (path: string) => {
    const res = await fetch(`https://api.ouraring.com/v2/usercollection/${path}?start_date=${start}&end_date=${end}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Oura ${path} ${res.status}`);
    return ((await res.json()) as { data: Record<string, unknown>[] }).data;
  };
  const [sleeps, readiness] = await Promise.all([get('sleep'), get('daily_readiness')]);
  const ready = new Map(readiness.map((r) => [r.day as string, r.score as number]));
  const best = new Map<string, Record<string, unknown>>();
  for (const s of sleeps) {
    const day = s.day as string;
    const cur = best.get(day);
    const score = (x: Record<string, unknown>) => (x.type === 'long_sleep' ? 1e9 : 0) + ((x.total_sleep_duration as number) ?? 0);
    if (!cur || score(s) > score(cur)) best.set(day, s);
  }
  const now = Date.now();
  const records: SyncRecord[] = [...best.entries()].map(([day, s]) => {
    const data = {
      id: `sleep-${day}`,
      updatedAt: now,
      date: day,
      sleepMin: s.total_sleep_duration ? Math.round((s.total_sleep_duration as number) / 60) : undefined,
      bedtime: s.bedtime_start ? helsinkiTime(new Date(s.bedtime_start as string)) : undefined,
      wakeTime: s.bedtime_end ? helsinkiTime(new Date(s.bedtime_end as string)) : undefined,
      // Oura's resting HR is the lowest heart rate during the night
      restingHr: (s.lowest_heart_rate as number) ?? undefined,
      hrv: (s.average_hrv as number) ?? undefined,
      readiness: ready.get(day),
      source: 'oura',
    };
    return { table: 'sleep', id: data.id, updatedAt: now, deleted: false, data };
  });
  await upsert(env, userId, records);
  return `${records.length} nights`;
}

async function runIntegrations(env: Env, userId: string, days = 3) {
  const out: Record<string, string> = {};
  for (const [name, fn] of [['withings', syncWithings], ['oura', syncOura]] as const) {
    try {
      out[name] = await fn(env, userId, days);
    } catch (e) {
      out[name] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return out;
}

// ---------------------------------------------------------------- apple health (iPhone Shortcut)

/** New Shortcut key for this user; replaces the previous one. Shown once. */
async function createIngestKey(env: Env, user: User) {
  const key = `lih_${randomToken(24)}`;
  await env.DB.prepare('UPDATE users SET ingest_hash = ? WHERE id = ?').bind(await sha256(key), user.id).run();
  return { key };
}

/** Numbers from Shortcuts can arrive as numbers or locale text ("8 412", "5,2 km"). */
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const cleaned = v.replace(/\s|\u00a0/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
  return cleaned ? Number(cleaned[0]) : undefined;
}

const ACTIVITY_FIELDS = ['steps', 'activeKcal', 'distanceKm', 'exerciseMin', 'flights'] as const;
const NUTRITION_FIELDS = { dietKcal: 'kcal', protein: 'protein', carbs: 'carbs', fat: 'fat', sodiumMg: 'sodiumMg' } as const;

async function ingestHealth(req: Request, env: Env) {
  const h = req.headers.get('Authorization') ?? '';
  const key = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!key) throw new HttpError(401, 'Missing Shortcut key.');
  const user = await env.DB.prepare('SELECT id FROM users WHERE ingest_hash = ?').bind(await sha256(key)).first<{ id: string }>();
  if (!user) throw new HttpError(401, 'Unknown Shortcut key. Create a new one in Lock-In → Settings → Apple Health.');

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    await noteIngest(env, user.id, { ok: false, error: 'Body was not JSON. Set Request Body to JSON in Get Contents of URL.' });
    throw new HttpError(400, 'Body was not JSON. In the Shortcut, set Request Body to JSON.');
  }
  // field names are matched case-insensitively ("Steps" works too)
  const b: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) b[k.trim().toLowerCase()] = v;
  const lower = (f: string) => f.toLowerCase();
  const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date.trim()) ? b.date.trim() : helsinkiDate(new Date());
  const now = Date.now();
  const existing = async (tbl: string, id: string) => {
    const row = await env.DB.prepare('SELECT data FROM records WHERE user_id = ? AND tbl = ? AND id = ? AND deleted = 0').bind(user.id, tbl, id).first<{ data: string }>();
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : {};
  };
  const records: SyncRecord[] = [];
  const saved: string[] = [];

  // activity: merge so a partial send never erases fields sent earlier the same day
  const activity: Record<string, number> = {};
  for (const f of ACTIVITY_FIELDS) {
    const v = num(b[lower(f)]);
    if (v !== undefined && v >= 0) activity[f] = f === 'steps' || f === 'flights' ? Math.round(v) : Math.round(v * 100) / 100;
  }
  if (Object.keys(activity).length) {
    const id = `activity-${date}`;
    records.push({ table: 'activity', id, updatedAt: now, deleted: false, data: { ...(await existing('activity', id)), ...activity, id, date, updatedAt: now, source: 'apple-health' } });
    saved.push(...Object.keys(activity));
  }

  // nutrition written to Apple Health by Cronometer → one "day total" food entry
  const nutrition: Record<string, number> = {};
  for (const [f, k] of Object.entries(NUTRITION_FIELDS)) {
    const v = num(b[lower(f)]);
    if (v !== undefined && v >= 0) nutrition[k] = Math.round(v * 10) / 10;
  }
  if ((nutrition.kcal ?? 0) > 0 || (nutrition.protein ?? 0) > 0) {
    const id = `cronometer-${date}`;
    const prev = (await existing('foodLog', id)).nutrients as Record<string, number> | undefined;
    const nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0, sodiumMg: 0, ...(prev ?? {}), ...nutrition };
    records.push({ table: 'foodLog', id, updatedAt: now, deleted: false, data: { id, updatedAt: now, date, slot: 'snack', name: 'Cronometer (day total)', nutrients, source: 'cronometer' } });
    saved.push('nutrition');
  }

  const fields = Object.keys(raw ?? {});
  if (records.length === 0) {
    const error = fields.length
      ? `Nothing saved: no usable numbers. Received fields: ${fields.join(', ')}. Expected names like steps, activeKcal, distanceKm (as Number fields with your variables).`
      : 'Nothing saved: the JSON body was empty. Add the fields under Request Body → JSON.';
    await noteIngest(env, user.id, { ok: false, date, fields, error });
    throw new HttpError(400, error);
  }
  await upsert(env, user.id, records);
  await noteIngest(env, user.id, { ok: true, date, fields, saved });
  return { ok: true, date, saved };
}

async function noteIngest(env: Env, userId: string, info: Record<string, unknown>) {
  await env.DB.prepare('UPDATE users SET last_ingest_at = ?, last_ingest_info = ? WHERE id = ?').bind(Date.now(), JSON.stringify(info), userId).run();
}

async function ingestStatus(env: Env, user: User) {
  const row = await env.DB.prepare('SELECT last_ingest_at, last_ingest_info, ingest_hash IS NOT NULL AS has_key FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ last_ingest_at: number | null; last_ingest_info: string | null; has_key: number }>();
  return { hasKey: !!row?.has_key, lastAt: row?.last_ingest_at ?? null, last: row?.last_ingest_info ? JSON.parse(row.last_ingest_info) : null };
}

// ---------------------------------------------------------------- router

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Bad JSON');
  }
}

async function route(req: Request, env: Env, url: URL): Promise<unknown> {
  const { pathname } = url;
  const post = req.method === 'POST';

  if (pathname === '/ingest/health' && post) return ingestHealth(req, env);
  if (pathname === '/auth/register' && post) return register(env, await body(req));
  if (pathname === '/auth/login' && post) return login(env, await body(req));
  if (pathname === '/auth/status' && req.method === 'GET') {
    const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0;
    return { needsSetup: n === 0 };
  }

  const user = await authenticate(req, env);
  if (pathname === '/auth/me' && req.method === 'GET') return { user: publicUser(user) };
  if (pathname === '/auth/logout' && post) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.tokenHash).run();
    return { ok: true };
  }
  if (pathname === '/auth/password' && post) {
    await changePassword(env, user, await body(req));
    return { ok: true };
  }
  if (pathname === '/auth/delete' && post) {
    await deleteAccount(env, user, await body(req));
    return { ok: true };
  }

  if (pathname === '/health/key' && post) return createIngestKey(env, user);
  if (pathname === '/health/status' && req.method === 'GET') return ingestStatus(env, user);

  if (pathname === '/admin/overview' && req.method === 'GET') {
    requireAdmin(user);
    return adminOverview(env);
  }
  if (pathname === '/admin/invites' && post) {
    requireAdmin(user);
    return createInvite(env, user);
  }

  if (pathname === '/sync/push' && post) {
    const b = await body<{ records?: SyncRecord[] }>(req);
    if (!Array.isArray(b.records) || b.records.length > 1000) throw new HttpError(400, 'bad request');
    return { written: await upsert(env, user.id, b.records) };
  }
  if (pathname === '/sync/pull' && req.method === 'GET') return pull(env, user.id, Number(url.searchParams.get('since') ?? 0) || 0);

  const start = pathname.match(/^\/oauth\/(withings|oura)\/start$/);
  if (start && post) {
    const { returnTo } = await body<{ returnTo?: string }>(req);
    return { url: await startOAuth(env, url.origin, user.id, start[1] as Provider, returnTo ?? env.ALLOWED_ORIGIN) };
  }
  if (pathname === '/integrations/run' && post) return runIntegrations(env, user.id, 7);

  throw new HttpError(404, 'not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const cb = url.pathname.match(/^\/oauth\/(withings|oura)\/callback$/);
    if (cb && req.method === 'GET') {
      try {
        return await oauthCallback(env, cb[1] as Provider, url);
      } catch (e) {
        return new Response(`Connection failed: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
      }
    }

    try {
      return json(await route(req, env, url), {}, h);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status }, h);
      return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }, h);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const { results } = await env.DB.prepare("SELECT DISTINCT user_id FROM tokens WHERE user_id != ''").all<{ user_id: string }>();
    ctx.waitUntil(Promise.all(results.map((r) => runIntegrations(env, r.user_id, 3))));
  },
} satisfies ExportedHandler<Env>;
