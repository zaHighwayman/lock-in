import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { addDays, today } from '../core/dates';
import type { Settings } from '../core/model';
import { db } from '../db/schema';
import { withDefaults } from '../db/seed';
import { getSyncStatus, subscribeSync, type SyncStatus } from '../db/sync';
import { avg7 } from '../core/rules/bodycomp';

export function useSettings(): Settings {
  return withDefaults(useLiveQuery(() => db.settings.get('settings'), []));
}

/** 7-day average weight, falling back to the latest weigh-in, then the profile's 68 kg. */
export function useBodyweight(): number {
  return (
    useLiveQuery(async () => {
      const from = addDays(today(), -30);
      const rows = await db.body.where('date').aboveOrEqual(from).toArray();
      const w = rows.filter((r) => r.weightKg).map((r) => ({ date: r.date, value: r.weightKg! }));
      const avg = avg7(w, today());
      if (avg) return Math.round(avg * 10) / 10;
      const latest = await db.body.orderBy('date').reverse().filter((r) => !!r.weightKg).first();
      return latest?.weightKg ?? 68;
    }, []) ?? 68
  );
}

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState(getSyncStatus());
  useEffect(() => {
    const unsub = subscribeSync(setS);
    return () => {
      unsub();
    };
  }, []);
  return s;
}

/** Re-render every `ms` (for timers). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
