import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import type { SleepRecovery } from '../model';
import { baseline, burnoutFlag, lowStreak, recoveryFlag, sleepCheck } from './recovery';

const REF = '2026-10-14';
function nights(days: number, f: (i: number) => Partial<SleepRecovery>): SleepRecovery[] {
  return Array.from({ length: days }, (_, i) => ({
    id: String(i),
    updatedAt: 0,
    date: addDays(REF, i - days + 1),
    source: 'oura' as const,
    restingHr: 52 + (i % 2),
    hrv: 80 + (i % 3) * 2,
    sleepMin: 490,
    bedtime: '22:05',
    ...f(i),
  }));
}

describe('rule 14: baseline', () => {
  it('uses the 14 days before the date', () => {
    const b = baseline(nights(20, () => ({})), REF, 'restingHr')!;
    expect(b.n).toBe(14);
    expect(b.mean).toBeCloseTo(52.5, 0);
  });
  it('needs 10 days', () => {
    expect(baseline(nights(8, () => ({})), REF, 'hrv')).toBeNull();
  });
});

describe('rule 15: recovery low', () => {
  it('flags 3+ consecutive days of high RHR', () => {
    const rows = nights(20, (i) => (i >= 17 ? { restingHr: 60 } : {}));
    expect(lowStreak(rows, REF)).toBe(3);
    expect(recoveryFlag(rows, REF)?.rule).toBe(15);
  });
  it('flags low HRV', () => {
    const rows = nights(20, (i) => (i >= 16 ? { hrv: 60 } : {}));
    expect(lowStreak(rows, REF)).toBeGreaterThanOrEqual(3);
  });
  it('does not flag 2 bad days', () => {
    const rows = nights(20, (i) => (i >= 18 ? { restingHr: 60 } : {}));
    expect(recoveryFlag(rows, REF)).toBeNull();
  });
  it('a missing day breaks the streak', () => {
    const rows = nights(20, (i) => (i >= 16 ? { restingHr: 60 } : {})).filter((_, i) => i !== 18);
    expect(lowStreak(rows, REF)).toBe(1);
  });
});

describe('rule 16: sleep', () => {
  it('passes 8 h+ and steady bedtime', () => {
    expect(sleepCheck(nights(7, () => ({})), REF).flags).toEqual([]);
  });
  it('flags under 8 h average', () => {
    const r = sleepCheck(nights(7, () => ({ sleepMin: 430 })), REF);
    expect(r.flags[0].title).toMatch(/7 h 10 min/);
  });
  it('flags bedtime varying > 1 h, across midnight', () => {
    const beds = ['22:00', '00:30', '22:00', '01:00', '22:10', '23:59', '21:50'];
    const r = sleepCheck(nights(7, (i) => ({ bedtime: beds[i] })), REF);
    expect(r.flags.some((f) => f.title.startsWith('Bedtime'))).toBe(true);
  });
  it('treats 23:30 and 00:30 as one hour apart', () => {
    const beds = ['23:30', '00:30', '23:30', '00:30', '23:30', '00:30', '23:30'];
    const r = sleepCheck(nights(7, (i) => ({ bedtime: beds[i] })), REF);
    expect(r.bedSd!).toBeLessThan(31);
  });
});

describe('rule 17: burnout', () => {
  const rec = [{ rule: 15, area: 'recovery' as const, level: 'warn' as const, title: 'x' }];
  it('needs both weeks dropping and a recovery flag', () => {
    expect(burnoutFlag(0.5, 0.4, rec)?.rule).toBe(17);
    expect(burnoutFlag(0.5, 0.1, rec)).toBeNull();
    expect(burnoutFlag(0.5, 0.4, [])).toBeNull();
    expect(burnoutFlag(null, 0.4, rec)).toBeNull();
  });
});
