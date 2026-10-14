// Date helpers on local "YYYY-MM-DD" strings. Weeks run Monday → Sunday.

const DAY = 86_400_000;

function toUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function localISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const today = () => localISO();

export function addDays(iso: string, n: number): string {
  return fromUTC(toUTC(iso) + n * DAY);
}

/** a − b in whole days */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(a) - toUTC(b)) / DAY);
}

/** 1 = Monday … 7 = Sunday */
export function weekday(iso: string): number {
  const d = new Date(toUTC(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

export function weekStart(iso: string): string {
  return addDays(iso, 1 - weekday(iso));
}

export function inRange(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

/** 1-based program week counted from the Monday of the start date. */
export function programWeek(startDate: string, iso: string): number {
  return Math.floor(diffDays(weekStart(iso), weekStart(startDate)) / 7) + 1;
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** "mm:ss" or "h:mm:ss" or plain minutes → seconds */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  if (parts.length === 1) return parts[0] * 60;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function pacePerKm(durationSec: number, distanceKm: number): number | null {
  return distanceKm > 0 ? durationSec / distanceKm : null;
}

/** "HH:MM" → minutes after 12:00 (so bedtimes either side of midnight compare correctly) */
export function clockFromNoon(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const mins = h * 60 + m;
  return mins < 12 * 60 ? mins + 12 * 60 : mins - 12 * 60;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d}.${m}.`;
}
