// Personal profile: shapes the coach, recipe generation, guardrails and body-composition rules.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBodyweight, useSettings } from '../app/hooks';
import type { Goal, Settings } from '../core/model';
import { maxDeficit } from '../core/rules/guardrails';
import { proteinTarget } from '../core/rules/nutrition';
import { save } from '../db/repo';
import { Button, Card, Field, NumInput, Page, Segmented, cx, inputCls } from '../ui/kit';

const GOALS: { value: Goal; label: string; hint: string }[] = [
  { value: 'recomp', label: 'Recomp', hint: 'Maintenance calories, steered by weight + waist. Lose fat and build muscle slowly.' },
  { value: 'lean-bulk', label: 'Lean bulk', hint: 'Small surplus, about +0.25–0.5 kg per month.' },
  { value: 'cut', label: 'Cut', hint: 'Lose about 0.25–0.75 kg per week while keeping muscle.' },
];

export default function ProfilePage() {
  const nav = useNavigate();
  const settings = useSettings();
  const bw = useBodyweight();
  const [p, setP] = useState<Settings | null>(null);
  const s = p ?? settings;
  // functional update: several quick changes must not overwrite each other
  const set = (c: Partial<Settings>) => setP((prev) => ({ ...(prev ?? settings), ...c }));
  const first = !settings.profileDone;

  async function submit() {
    await save('settings', { ...s, profileDone: true });
    nav('/');
  }

  return (
    <Page title={first ? 'Set up your profile' : 'Profile'} back={first ? undefined : () => nav(-1)}>
      {first && (
        <>
          <p className="-mt-1 mb-3 text-sm text-muted">The coach, recipes and body-composition checks use this. You can change it any time in Settings.</p>
          <Button className="mb-3 w-full" onClick={() => nav('/login')}>
            I already have an account: sign in
          </Button>
        </>
      )}
      <Card title="About you">
        <Field label="Name (optional)">
          <input className={inputCls} value={s.displayName ?? ''} onChange={(e) => set({ displayName: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Birth year">
            <NumInput value={s.birthYear} onChange={(v) => v && set({ birthYear: Math.round(v) })} />
          </Field>
          <Field label="Height (cm)">
            <NumInput value={s.heightCm} onChange={(v) => v && set({ heightCm: v })} />
          </Field>
        </div>
        <Field label="Sex (for the coach's context)">
          <Segmented value={s.sex} onChange={(v) => set({ sex: v })} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Prefer not to say' }]} />
        </Field>
      </Card>

      <Card title="Goal">
        <Segmented className="mb-2" value={s.goal} onChange={(v) => set({ goal: v })} options={GOALS.map((g) => ({ value: g.value, label: g.label }))} />
        <p className="mb-3 text-xs text-faint">
          {GOALS.find((g) => g.value === s.goal)?.hint} The coach never suggests more than a {maxDeficit(s.goal)} kcal/day deficit.
        </p>
        <Field label="What are you training for? (in your own words)">
          <textarea className={cx(inputCls, 'h-20')} value={s.goalText ?? ''} onChange={(e) => set({ goalText: e.target.value })} placeholder="e.g. bigger shoulders and back, run a sub-20 5 km" />
        </Field>
      </Card>

      <Card title="Nutrition">
        <Field label="Protein target (g per kg bodyweight)" hint={`= ${proteinTarget(bw, s.proteinGPerKg)} g/day at ${bw} kg. 1.6–2.0 is typical for lifters.`}>
          <NumInput value={s.proteinGPerKg} onChange={(v) => v && set({ proteinGPerKg: v })} />
        </Field>
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={s.proteinLocked} onChange={(e) => set({ proteinLocked: e.target.checked })} />
          <span>
            Lock this protein target
            <span className="block text-xs text-faint">For a target set by a doctor or dietitian: the coach will never suggest changing it.</span>
          </span>
        </label>
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={s.lowSodium} onChange={(e) => set({ lowSodium: e.target.checked })} />
          <span>
            Low-sodium diet (medical)
            <span className="block text-xs text-faint">No added salt or salt substitutes in recipes, sodium watchlist, sodium limit tracking.</span>
          </span>
        </label>
        {s.lowSodium && (
          <Field label="Sodium ceiling (mg/day)" hint="From your doctor or dietitian.">
            <NumInput value={s.sodiumCeilingMg} onChange={(v) => set({ sodiumCeilingMg: v })} placeholder="e.g. 2000" />
          </Field>
        )}
        <Field label="Diet notes" hint="Allergies, foods you don't eat, other rules. The coach and recipes always respect these.">
          <textarea className={cx(inputCls, 'h-20')} value={s.dietNotes ?? ''} onChange={(e) => set({ dietNotes: e.target.value })} placeholder="e.g. vegetarian, lactose-free, no nuts" />
        </Field>
      </Card>

      <Button variant="primary" size="lg" className="w-full" onClick={submit}>
        {first ? 'Start' : 'Save'}
      </Button>
      {first && <p className="mt-3 px-1 text-xs text-faint">You start with a sample 4-day program. Change it under Train → Program.</p>}
    </Page>
  );
}
