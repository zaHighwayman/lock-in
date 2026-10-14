// Add food: scan (label + portion photos → AI estimate), library, meal-prep portion, quick meal, or manual.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { defaultSlot, eatFromBatch, logFood, logRecipePortion } from '../app/actions';
import { useSettings } from '../app/hooks';
import { fileToImagePart, getProvider, type ImagePart } from '../ai/provider';
import { estimateFood, type FoodEstimate } from '../ai/tasks';
import type { Food, MealSlot, Nutrients } from '../core/model';
import { forGrams, perPortion, roundN, watchlistHits } from '../core/rules/nutrition';
import { save, uid } from '../db/repo';
import { db } from '../db/schema';
import { Button, ErrorNote, Field, inputCls, NumInput, Segmented, Sheet, cx } from '../ui/kit';

export const SLOTS: { value: MealSlot; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'snack', label: 'Snack' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'evening', label: 'Evening' },
];

type Mode = 'scan' | 'library' | 'prep' | 'manual';

export function NutrientLine({ n, className }: { n: Nutrients; className?: string }) {
  return (
    <span className={cx('tnum text-xs text-muted', className)}>
      {Math.round(n.kcal)} kcal · P {Math.round(n.protein)} · C {Math.round(n.carbs)} · F {Math.round(n.fat)} · Na {Math.round(n.sodiumMg)} mg
    </span>
  );
}

export default function AddFoodSheet({ open, onClose, date }: { open: boolean; onClose: () => void; date: string }) {
  const [mode, setMode] = useState<Mode>('scan');
  const [slot, setSlot] = useState<MealSlot>(defaultSlot());
  const done = () => {
    onClose();
    setMode('scan');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add food">
      <select className={cx(inputCls, 'mb-3')} value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)}>
        {SLOTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <Segmented
        className="mb-4"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'scan', label: 'Scan' },
          { value: 'library', label: 'Library' },
          { value: 'prep', label: 'Meal prep' },
          { value: 'manual', label: 'Manual' },
        ]}
      />
      {mode === 'scan' && <ScanFood date={date} slot={slot} onDone={done} />}
      {mode === 'library' && <LibraryPick date={date} slot={slot} onDone={done} />}
      {mode === 'prep' && <PrepPick date={date} slot={slot} onDone={done} />}
      {mode === 'manual' && <ManualFood date={date} slot={slot} onDone={done} />}
    </Sheet>
  );
}

function PhotoInput({ label, image, onImage }: { label: string; image: ImagePart | null; onImage: (i: ImagePart | null) => void }) {
  return (
    <label className="flex aspect-[4/3] flex-1 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed border-line bg-surface-2 text-center text-sm text-muted">
      {image ? <img src={`data:${image.mimeType};base64,${image.base64}`} className="h-full w-full object-cover" alt={label} /> : <>
        <span className="text-2xl">＋</span>
        <span className="px-2">{label}</span>
      </>}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          onImage(f ? await fileToImagePart(f) : null);
        }}
      />
    </label>
  );
}

function ScanFood({ date, slot, onDone }: { date: string; slot: MealSlot; onDone: () => void }) {
  const settings = useSettings();
  const [label, setLabel] = useState<ImagePart | null>(null);
  const [portion, setPortion] = useState<ImagePart | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [est, setEst] = useState<FoodEstimate | null>(null);
  const [grams, setGrams] = useState<number | null>(null);
  const [saveToLibrary, setSaveToLibrary] = useState(true);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const ai = await getProvider(settings);
      const r = await estimateFood(ai, { label: label ?? undefined, portion: portion ?? undefined, text: text || undefined });
      setEst(r);
      setGrams(Math.round(r.grams));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!est || !grams) return;
    let foodId: string | undefined;
    if (saveToLibrary && label) {
      const food: Food = { id: uid(), updatedAt: 0, name: est.name, per100: roundN(est.per100), source: 'label', sodiumWatch: est.per100.sodiumMg > 400 || watchlistHits(est.name).length > 0 };
      await save('foods', food);
      foodId = food.id;
    }
    await logFood({ date, slot, name: est.name, grams, nutrients: forGrams(est.per100, grams), estimated: true, ref: foodId ? { kind: 'food', id: foodId } : undefined });
    onDone();
  }

  if (est) {
    const n = forGrams(est.per100, grams ?? 0);
    return (
      <div>
        <Field label="Food">
          <input className={inputCls} value={est.name} onChange={(e) => setEst({ ...est, name: e.target.value })} />
        </Field>
        <Field label="Your portion (g)" hint={`AI estimate: ${Math.round(est.grams)} g · ${est.confidence} confidence. ${est.notes}`}>
          <NumInput value={grams} onChange={setGrams} />
        </Field>
        <div className="mb-2 grid grid-cols-5 gap-2 text-center text-xs">
          {(['kcal', 'protein', 'carbs', 'fat', 'sodiumMg'] as const).map((k) => (
            <label key={k} className="block">
              <span className="text-muted">{k === 'sodiumMg' ? 'Na mg' : k === 'kcal' ? 'kcal' : k[0].toUpperCase() + k.slice(1, 4)}</span>
              <NumInput className="mt-1 px-1 py-1.5 text-center text-sm" value={est.per100[k]} onChange={(v) => setEst({ ...est, per100: { ...est.per100, [k]: v ?? 0 } })} />
            </label>
          ))}
        </div>
        <p className="mb-3 text-xs text-faint">Values per 100 g. Check them against the label.</p>
        <div className="mb-3 rounded-xl bg-surface-2 p-3">
          <div className="text-sm font-medium">This portion</div>
          <NutrientLine n={n} />
          {est.per100.sodiumMg > 400 && <div className="mt-1 text-xs text-warn">High sodium: {Math.round(est.per100.sodiumMg)} mg per 100 g.</div>}
        </div>
        {label && (
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={saveToLibrary} onChange={(e) => setSaveToLibrary(e.target.checked)} /> Save to library for next time
          </label>
        )}
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" onClick={add} disabled={!grams}>
            Log it
          </Button>
          <Button onClick={() => setEst(null)}>Back</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <PhotoInput label="Nutrition label" image={label} onImage={setLabel} />
        <PhotoInput label="Your portion" image={portion} onImage={setPortion} />
      </div>
      <Field label="Note (optional)" hint="e.g. “about half the box” or “200 g”. A stated amount is used exactly.">
        <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="What and how much" />
      </Field>
      <ErrorNote error={error} />
      <Button variant="primary" className="w-full" disabled={busy || (!label && !portion && !text)} onClick={run}>
        {busy ? 'Estimating…' : 'Estimate'}
      </Button>
      <p className="mt-2 text-xs text-faint">Photos go to your AI provider ({settings.aiProvider}) and aren't stored here.</p>
    </div>
  );
}

function LibraryPick({ date, slot, onDone }: { date: string; slot: MealSlot; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Food | null>(null);
  const [grams, setGrams] = useState<number | null>(100);
  const foods = useLiveQuery(() => db.foods.orderBy('name').toArray(), []) ?? [];
  const list = foods.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  if (pick) {
    return (
      <div>
        <div className="mb-2 font-medium">{pick.name}</div>
        <Field label="Amount (g)">
          <NumInput value={grams} onChange={setGrams} />
        </Field>
        {pick.servingG && (
          <Button size="sm" className="mb-3" onClick={() => setGrams(pick.servingG!)}>
            1 serving ({pick.servingG} g)
          </Button>
        )}
        <div className="mb-3">
          <NutrientLine n={forGrams(pick.per100, grams ?? 0)} />
        </div>
        <div className="flex gap-2">
          <Button
            variant="primary"
            className="flex-1"
            disabled={!grams}
            onClick={async () => {
              await logFood({ date, slot, name: pick.name, grams: grams!, nutrients: forGrams(pick.per100, grams!), ref: { kind: 'food', id: pick.id } });
              onDone();
            }}
          >
            Log it
          </Button>
          <Button onClick={() => setPick(null)}>Back</Button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <input className={cx(inputCls, 'mb-3')} placeholder="Search foods" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="divide-y divide-line">
        {list.map((f) => (
          <li key={f.id}>
            <button className="w-full py-2.5 text-left" onClick={() => setPick(f)}>
              <div className="text-sm">{f.name}</div>
              <NutrientLine n={f.per100} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PrepPick({ date, slot, onDone }: { date: string; slot: MealSlot; onDone: () => void }) {
  const batches = useLiveQuery(() => db.batches.orderBy('cookedOn').toArray(), []) ?? [];
  const recipes = useLiveQuery(() => db.recipes.orderBy('name').toArray(), []) ?? [];
  const left = batches.filter((b) => b.portionsEaten < b.portionsMade);
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-muted">From the freezer / fridge (oldest first)</h3>
      {left.length === 0 && <p className="mb-3 text-sm text-faint">No batches. Log a cook in Food → Prep.</p>}
      <ul className="mb-4 divide-y divide-line">
        {left.map((b) => (
          <li key={b.id}>
            <button className="flex w-full items-center justify-between py-2.5 text-left" onClick={async () => { await eatFromBatch(b, date, slot); onDone(); }}>
              <div>
                <div className="text-sm">{b.recipeName}</div>
                <NutrientLine n={b.perPortion} />
              </div>
              <span className="text-xs text-muted tnum">{b.portionsMade - b.portionsEaten} left</span>
            </button>
          </li>
        ))}
      </ul>
      <h3 className="mb-2 text-sm font-semibold text-muted">One portion of a recipe</h3>
      <ul className="divide-y divide-line">
        {recipes.filter((r) => !r.archived).map((r) => (
          <li key={r.id}>
            <button className="w-full py-2.5 text-left" onClick={async () => { await logRecipePortion(r, date, slot); onDone(); }}>
              <div className="text-sm">{r.name}</div>
              <NutrientLine n={perPortion(r)} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ManualFood({ date, slot, onDone }: { date: string; slot: MealSlot; onDone: () => void }) {
  const [name, setName] = useState('');
  const [n, setN] = useState<Nutrients>({ kcal: 0, protein: 0, carbs: 0, fat: 0, sodiumMg: 0 });
  return (
    <div>
      <Field label="Name">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="mb-3 grid grid-cols-5 gap-2 text-center text-xs">
        {(['kcal', 'protein', 'carbs', 'fat', 'sodiumMg'] as const).map((k) => (
          <label key={k}>
            <span className="text-muted">{k === 'sodiumMg' ? 'Na mg' : k === 'kcal' ? 'kcal' : k[0].toUpperCase() + k.slice(1, 4)}</span>
            <NumInput className="mt-1 px-1 py-1.5 text-center text-sm" value={n[k]} onChange={(v) => setN({ ...n, [k]: v ?? 0 })} />
          </label>
        ))}
      </div>
      <Button
        variant="primary"
        className="w-full"
        disabled={!name}
        onClick={async () => {
          await logFood({ date, slot, name, nutrients: n, estimated: true });
          onDone();
        }}
      >
        Log it
      </Button>
    </div>
  );
}

export function QuickMeals({ date }: { date: string }) {
  const meals = useLiveQuery(() => db.savedMeals.orderBy('order').toArray(), []) ?? [];
  const logged = useLiveQuery(() => db.foodLog.where('date').equals(date).toArray(), [date]) ?? [];
  return (
    <div className="flex flex-wrap gap-2">
      {meals.map((m) => {
        const has = logged.some((l) => l.ref?.kind === 'meal' && l.ref.id === m.id);
        return (
          <button
            key={m.id}
            onClick={() => logFood({ date, slot: m.slot, name: m.name, nutrients: m.nutrients, ref: { kind: 'meal', id: m.id } })}
            className={cx('rounded-full border px-3 py-1.5 text-sm', has ? 'border-good/40 bg-good/10 text-good' : 'border-line bg-surface-2')}
          >
            {has ? '✓ ' : '+ '}
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

