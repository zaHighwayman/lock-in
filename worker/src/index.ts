// Lock-In sync + integrations Worker (Cloudflare Workers + D1).
// - /sync/push, /sync/pull: last-write-wins record sync for the PWA
// - /oauth/:provider/start|callback: Withings + Oura OAuth2 (client secrets live here, never in the app)
// - /integrations/run + daily cron: pull weights, sleep and recovery into the record store
// Every route except the OAuth callback requires `Authorization: Bearer <SYNC_TOKEN>`.

export interface Env {
  DB: D1Database;
  SYNC_TOKEN: string;
  TOKEN_KEY: string;
  ALLOWED_ORIGIN: string;
  PUBLIC_URL: string;
  WITHINGS_CLIENT_ID?: string;
  WITHINGS_CLIENT_SECRET?: string;
  OURA_CLIENT_ID?: string;
  OURA_CLIENT_SECRET?: string;
}

type Provider = 'withings' | 'oura';

interface SyncRecord {
  table: string;
  id: string;
  updatedAt: number;
  deleted: boolean;
  data: unknown;
}

const ALLOWED_TABLES = new Set([
  'exercises', 'programDays', 'sessions', 'sets', 'runs', 'body', 'sleep', 'foods', 'foodLog',
  'savedMeals', 'recipes', 'recipeFeedback', 'batches', 'mealPlans', 'coachReports', 'chat', 'settings', 'aliases',
]);

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

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && a.length === b.length;
}

async function authorized(req: Request, env: Env): Promise<boolean> {
  const h = req.headers.get('Authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return !!env.SYNC_TOKEN && !!token && safeEqual(token, env.SYNC_TOKEN);
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(env: Env, data: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

async function aesKey(env: Env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`tokens:${env.TOKEN_KEY}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(env: Env, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(JSON.stringify(value)));
  return `${b64url(iv)}.${b64url(ct)}`;
}

async function decrypt<T>(env: Env, s: string): Promise<T> {
  const [iv, ct] = s.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(env), fromB64url(ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/** Unix seconds or ISO string → local "YYYY-MM-DD" / "HH:MM" in Helsinki. */
const helsinkiDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki' }).format(d);
const helsinkiTime = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

// ---------------------------------------------------------------- sync

async function upsert(env: Env, records: SyncRecord[]) {
  let written = 0;
  for (const r of records) {
    if (!ALLOWED_TABLES.has(r.table) || typeof r.id !== 'string' || typeof r.updatedAt !== 'number') continue;
    const existing = await env.DB.prepare('SELECT updated_at FROM records WHERE tbl = ? AND id = ?').bind(r.table, r.id).first<{ updated_at: number }>();
    if (existing && existing.updated_at >= r.updatedAt) continue;
    // delete + insert so the row gets a fresh seq and other devices pull it
    await env.DB.batch([
      env.DB.prepare('DELETE FROM records WHERE tbl = ? AND id = ?').bind(r.table, r.id),
      env.DB.prepare('INSERT INTO records (tbl, id, updated_at, deleted, data) VALUES (?, ?, ?, ?, ?)').bind(
        r.table, r.id, r.updatedAt, r.deleted ? 1 : 0, r.deleted ? null : JSON.stringify(r.data),
      ),
    ]);
    written++;
  }
  return written;
}

async function pull(env: Env, since: number) {
  const LIMIT = 500;
  const { results } = await env.DB.prepare('SELECT seq, tbl, id, updated_at, deleted, data FROM records WHERE seq > ? ORDER BY seq LIMIT ?')
    .bind(since, LIMIT)
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
  withings: {
    authorize: 'https://account.withings.com/oauth2_user/authorize2',
    scope: 'user.metrics',
  },
  oura: {
    authorize: 'https://cloud.ouraring.com/oauth/authorize',
    scope: 'daily heartrate personal',
  },
} as const;

function clientFor(env: Env, p: Provider) {
  const id = p === 'withings' ? env.WITHINGS_CLIENT_ID : env.OURA_CLIENT_ID;
  const secret = p === 'withings' ? env.WITHINGS_CLIENT_SECRET : env.OURA_CLIENT_SECRET;
  if (!id || !secret) throw new Error(`${p} client id/secret not set on the Worker`);
  return { id, secret };
}

const redirectUri = (env: Env, p: Provider) => `${env.PUBLIC_URL.replace(/\/$/, '')}/oauth/${p}/callback`;

async function startOAuth(env: Env, p: Provider, returnTo: string) {
  const { id } = clientFor(env, p);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ p, r: returnTo, t: Date.now() })));
  const state = `${payload}.${await hmac(env, payload)}`;
  const u = new URL(OAUTH[p].authorize);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', id);
  u.searchParams.set('scope', OAUTH[p].scope);
  u.searchParams.set('redirect_uri', redirectUri(env, p));
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

async function saveTokens(env: Env, p: Provider, t: Tokens) {
  await env.DB.prepare('INSERT INTO tokens (provider, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(p, await encrypt(env, t), Date.now())
    .run();
}

/** Valid access token, refreshing if it expires within 5 minutes. null = not connected. */
async function accessToken(env: Env, p: Provider): Promise<string | null> {
  const row = await env.DB.prepare('SELECT data FROM tokens WHERE provider = ?').bind(p).first<{ data: string }>();
  if (!row) return null;
  let t = await decrypt<Tokens>(env, row.data);
  if (t.expires_at - Date.now() < 5 * 60_000) {
    t = await tokenRequest(env, p, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
    await saveTokens(env, p, t);
  }
  return t.access_token;
}

async function oauthCallback(env: Env, p: Provider, url: URL): Promise<Response> {
  const [payload, sig] = (url.searchParams.get('state') ?? '').split('.');
  if (!payload || !sig || !(await safeEqual(sig, await hmac(env, payload)))) return new Response('Bad state', { status: 400 });
  const st = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { p: Provider; r: string; t: number };
  if (st.p !== p || Date.now() - st.t > 15 * 60_000) return new Response('Expired state, try connecting again', { status: 400 });
  const code = url.searchParams.get('code');
  if (!code) return new Response(`Not connected: ${url.searchParams.get('error') ?? 'no code'}`, { status: 400 });
  const tokens = await tokenRequest(env, p, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, p) });
  await saveTokens(env, p, tokens);
  await (p === 'withings' ? syncWithings(env, 30) : syncOura(env, 30));
  const back = st.r.startsWith(env.ALLOWED_ORIGIN) || /^http:\/\/localhost:\d+/.test(st.r) ? st.r : env.ALLOWED_ORIGIN;
  return Response.redirect(back, 302);
}

// ---------------------------------------------------------------- integrations

async function syncWithings(env: Env, days: number): Promise<string> {
  const token = await accessToken(env, 'withings');
  if (!token) return 'not connected';
  const end = Math.floor(Date.now() / 1000);
  const res = await fetch('https://wbsapi.withings.net/measure', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams({ action: 'getmeas', meastypes: '1,6', category: '1', startdate: String(end - days * 86400), enddate: String(end) }),
  });
  const j = (await res.json()) as { status: number; body?: { measuregrps: { date: number; measures: { value: number; type: number; unit: number }[] }[] } };
  if (j.status !== 0 || !j.body) return `error ${j.status}`;
  // one record per day: the latest weigh-in that day
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
  await upsert(env, records);
  return `${records.length} days`;
}

async function syncOura(env: Env, days: number): Promise<string> {
  const token = await accessToken(env, 'oura');
  if (!token) return 'not connected';
  const end = helsinkiDate(new Date(Date.now() + 86400_000));
  const start = helsinkiDate(new Date(Date.now() - days * 86400_000));
  const get = async (path: string) => {
    const res = await fetch(`https://api.ouraring.com/v2/usercollection/${path}?start_date=${start}&end_date=${end}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Oura ${path} ${res.status}`);
    return ((await res.json()) as { data: Record<string, unknown>[] }).data;
  };
  const [sleeps, readiness] = await Promise.all([get('sleep'), get('daily_readiness')]);
  const ready = new Map(readiness.map((r) => [r.day as string, r.score as number]));
  // main sleep per day: prefer type long_sleep, else the longest
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
  await upsert(env, records);
  return `${records.length} nights`;
}

async function runIntegrations(env: Env, days = 3) {
  const out: Record<string, string> = {};
  for (const [name, fn] of [['withings', syncWithings], ['oura', syncOura]] as const) {
    try {
      out[name] = await fn(env, days);
    } catch (e) {
      out[name] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return out;
}

// ---------------------------------------------------------------- router

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

    if (!(await authorized(req, env))) return json({ error: 'unauthorized' }, { status: 401 }, h);

    try {
      if (url.pathname === '/sync/push' && req.method === 'POST') {
        const body = (await req.json()) as { records?: SyncRecord[] };
        if (!Array.isArray(body.records) || body.records.length > 1000) return json({ error: 'bad request' }, { status: 400 }, h);
        return json({ written: await upsert(env, body.records) }, {}, h);
      }
      if (url.pathname === '/sync/pull' && req.method === 'GET') {
        return json(await pull(env, Number(url.searchParams.get('since') ?? 0) || 0), {}, h);
      }
      const start = url.pathname.match(/^\/oauth\/(withings|oura)\/start$/);
      if (start && req.method === 'POST') {
        const { returnTo } = (await req.json()) as { returnTo?: string };
        return json({ url: await startOAuth(env, start[1] as Provider, returnTo ?? env.ALLOWED_ORIGIN) }, {}, h);
      }
      if (url.pathname === '/integrations/run' && req.method === 'POST') {
        return json(await runIntegrations(env, 7), {}, h);
      }
      return json({ error: 'not found' }, { status: 404 }, h);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }, h);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runIntegrations(env, 3));
  },
} satisfies ExportedHandler<Env>;
