import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cookBatch, eatFromBatch, logFood } from '../app/actions';
import { useBodyweight, useSettings } from '../app/hooks';
import { getProvider } from '../ai/provider';
import { generateRecipe, type RecipeResult } from '../ai/tasks';
import { tasteProfile } from '../core/coach/taste';
import { addDays, diffDays, shortDate, today, weekday, WEEKDAYS } from '../core/dates';
import type { Food, FoodLogEntry, MealPlan, MealPrepBatch, Nutrients, Recipe, SavedMeal } from '../core/model';
import { dayFlags, dayTotals, forGrams, perPortion, proteinTarget, watchlistHits } from '../core/rules/nutrition';
import { patch, remove, save, uid } from '../db/repo';
import { db } from '../db/schema';
import AddFoodSheet, { NutrientLine, QuickMeals, SLOTS } from '../features/AddFoodSheet';
import { Bar, Button, Card, Empty, ErrorNote, Field, FlagList, NumInput, Page, Segmented, Sheet, Stat, cx, inputCls } from '../ui/kit';

type Tab = 'day' | 'recipes' | 'prep' | 'library';

export default function FoodPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'day';
  return (
    <Page title="Food">
      <Segmented
        className="mb-3"
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        options={[
          { value: 'day', label: 'Log' },
          { value: 'recipes', label: 'Recipes' },
          { value: 'prep', label: 'Prep' },
          { value: 'library', label: 'Library' },
        ]}
      />
      {tab === 'day' && <DayLog />}
      {tab === 'recipes' && <Recipes />}
      {tab === 'prep' && <Prep />}
      {tab === 'library' && <Library />}
    </Page>
  );
}

// ---------------- Day log ----------------

function DayLog() {
  const settings = useSettings();
  const bw = useBodyweight();
  const [date, setDate] = useState(today());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FoodLogEntry | null>(null);
  const entries = useLiveQuery(() => db.foodLog.where('date').equals(date).toArray(), [date]) ?? [];
  const totals = dayTotals(entries);
  const pTarget = proteinTarget(bw, settings.proteinGPerKg);

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <button className="rounded-lg px-3 py-1.5 text-xl text-muted" onClick={() => setDate(addDays(date, -1))}>
          ‹
        </button>
        <div className="text-center">
          <div className="font-medium">{date === today() ? 'Today' : `${WEEKDAYS[weekday(date) - 1]} ${shortDate(date)}`}</div>
        </div>
        <button className="rounded-lg px-3 py-1.5 text-xl text-muted disabled:opacity-30" disabled={date >= today()} onClick={() => setDate(addDays(date, 1))}>
          ›
        </button>
      </div>

      <Card>
        <div className="mb-3 grid grid-cols-4 gap-2">
          <Stat label="kcal" value={totals.kcal} sub="estimate" />
          <Stat label="Protein" value={`${Math.round(totals.protein)} g`} sub={`target ${pTarget}`} tone={totals.protein >= pTarget ? 'good' : undefined} />
          <Stat label="Carbs" value={`${Math.round(totals.carbs)} g`} />
          <Stat label="Fat" value={`${Math.round(totals.fat)} g`} />
        </div>
        <Bar value={totals.protein} max={pTarget} tone={totals.protein >= pTarget ? 'good' : 'accent'} />
        <div className="mt-3 flex justify-between text-sm">
          <span className="text-muted">Sodium</span>
          <span className={cx('tnum', settings.sodiumCeilingMg && totals.sodiumMg > settings.sodiumCeilingMg ? 'text-bad' : 'text-ink')}>
            {totals.sodiumMg} mg{settings.sodiumCeilingMg ? ` / ${settings.sodiumCeilingMg}` : ''}
          </span>
        </div>
        {settings.lowSodium && !settings.sodiumCeilingMg && <p className="mt-1 text-xs text-faint">Set your sodium ceiling in your profile to track it against your limit.</p>}
        <div className="mt-3">
          <FlagList flags={dayFlags(totals, pTarget, settings.sodiumCeilingMg)} />
        </div>
      </Card>

      <Card title="Quick add">
        <QuickMeals date={date} />
      </Card>

      {SLOTS.map((slot) => {
        const list = entries.filter((e) => e.slot === slot.value);
        if (list.length === 0) return null;
        return (
          <Card key={slot.value} title={slot.label}>
            <ul className="divide-y divide-line">
              {list.map((e) => (
                <li key={e.id}>
                  <button className="w-full py-2 text-left" onClick={() => setEditing(e)}>
                    <div className="flex justify-between gap-2 text-sm">
                      <span>
                        {e.name}
                        {e.grams ? <span className="text-muted"> · {e.grams} g</span> : null}
                        {e.estimated && <span className="ml-1 text-xs text-faint">est.</span>}
                      </span>
                      <span className="tnum text-muted">{Math.round(e.nutrients.protein)} g P</span>
                    </div>
                    <NutrientLine n={e.nutrients} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      <Button variant="primary" size="lg" className="w-full" onClick={() => setAdding(true)}>
        + Add food
      </Button>
      <AddFoodSheet open={adding} onClose={() => setAdding(false)} date={date} />
      {editing && <EntrySheet entry={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EntrySheet({ entry, onClose }: { entry: FoodLogEntry; onClose: () => void }) {
  const [grams, setGrams] = useState<number | null>(entry.grams ?? null);
  const [n, setN] = useState<Nutrients>(entry.nutrients);
  const [slot, setSlot] = useState(entry.slot);
  const factor = entry.grams && grams ? grams / entry.grams : 1;
  const shown: Nutrients = entry.grams ? { kcal: n.kcal * factor, protein: n.protein * factor, carbs: n.carbs * factor, fat: n.fat * factor, sodiumMg: n.sodiumMg * factor } : n;
  return (
    <Sheet open onClose={onClose} title={entry.name}>
      <Field label="Meal">
        <select className={inputCls} value={slot} onChange={(e) => setSlot(e.target.value as FoodLogEntry['slot'])}>
          {SLOTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      {entry.grams ? (
        <Field label="Amount (g)">
          <NumInput value={grams} onChange={setGrams} />
        </Field>
      ) : (
        <div className="mb-3 grid grid-cols-5 gap-2 text-center text-xs">
          {(['kcal', 'protein', 'carbs', 'fat', 'sodiumMg'] as const).map((k) => (
            <label key={k}>
              <span className="text-muted">{k === 'sodiumMg' ? 'Na mg' : k === 'kcal' ? 'kcal' : k[0].toUpperCase() + k.slice(1, 4)}</span>
              <NumInput className="mt-1 px-1 py-1.5 text-center text-sm" value={n[k]} onChange={(v) => setN({ ...n, [k]: v ?? 0 })} />
            </label>
          ))}
        </div>
      )}
      <div className="mb-4">
        <NutrientLine n={shown} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={async () => {
            await save('foodLog', { ...entry, slot, grams: grams ?? entry.grams, nutrients: shown });
            onClose();
          }}
        >
          Save
        </Button>
        <Button
          onClick={async () => {
            const count = await db.savedMeals.count();
            await save('savedMeals', { id: uid(), name: entry.name, slot, nutrients: shown, order: count });
            onClose();
          }}
        >
          Make quick meal
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            await remove('foodLog', entry.id);
            onClose();
          }}
        >
          Delete
        </Button>
      </div>
    </Sheet>
  );
}

// ---------------- Recipes ----------------

function Recipes() {
  const nav = useNavigate();
  const [filter, setFilter] = useState<'all' | 'liked' | 'new'>('all');
  const [gen, setGen] = useState(false);
  const recipes = useLiveQuery(() => db.recipes.orderBy('name').toArray(), []) ?? [];
  const list = recipes
    .filter((r) => !r.archived)
    .filter((r) => (filter === 'liked' ? r.rating === 1 : filter === 'new' ? !r.rating : r.rating !== -1))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.updatedAt - a.updatedAt);

  return (
    <>
      <Button variant="primary" size="lg" className="mb-3 w-full" onClick={() => setGen(true)}>
        ✦ Create a recipe with AI
      </Button>
      <Segmented
        className="mb-3"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'liked', label: 'Liked' },
          { value: 'new', label: 'Not rated' },
        ]}
      />
      {list.length === 0 && <Empty>Nothing here yet.</Empty>}
      {list.map((r) => {
        const p = perPortion(r);
        const flagged = r.ingredients.some((i) => watchlistHits(i.name).length > 0);
        return (
          <button key={r.id} onClick={() => nav(`/food/recipe/${r.id}`)} className="mb-2 block w-full rounded-2xl border border-line bg-surface p-3 text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium">{r.name}</div>
              <div className="shrink-0 text-sm">{r.rating === 1 ? '👍' : r.rating === -1 ? '👎' : ''}</div>
            </div>
            <NutrientLine n={p} />
            <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">{r.servings} portions</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-muted">{r.freezerFriendly ? 'freezer' : `fridge ${r.fridgeDays ?? 3} d`}</span>
              {r.source === 'ai' && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">AI</span>}
              {flagged && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-warn">sodium watch</span>}
            </div>
          </button>
        );
      })}
      {gen && <GenerateSheet onClose={() => setGen(false)} />}
    </>
  );
}

export function GenerateSheet({ onClose, base }: { onClose: () => void; base?: Recipe }) {
  const nav = useNavigate();
  const settings = useSettings();
  const bw = useBodyweight();
  const [want, setWant] = useState('');
  const [servings, setServings] = useState<number | null>(base?.servings ?? 6);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecipeResult | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // ~35 % of daily protein in the dinner portion
  const proteinPer = Math.round(proteinTarget(bw, settings.proteinGPerKg) * 0.35);
  const sodiumPer = settings.lowSodium && settings.sodiumCeilingMg ? Math.round(settings.sodiumCeilingMg * 0.3) : null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const [recipes, feedback, pantry] = await Promise.all([db.recipes.toArray(), db.recipeFeedback.toArray(), db.foods.toArray()]);
      const ai = await getProvider(settings);
      const r = await generateRecipe(ai, {
        want,
        servings: servings ?? 6,
        proteinPerPortionG: proteinPer,
        sodiumPerPortionMaxMg: sodiumPer,
        tasteProfile: tasteProfile(recipes, feedback, settings.foodPreferences),
        pantry,
        profile: settings,
        base,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!result) return;
    const id = uid();
    await save('recipes', { ...result.recipe, id });
    if (base) {
      await save('recipeFeedback', { id: uid(), recipeId: base.id, recipeName: base.name, date: today(), kind: 'comment', comment: `Asked AI to adapt it: "${want}"` });
    }
    onClose();
    nav(`/food/recipe/${id}`);
  }

  async function reject() {
    if (!result) return;
    // Rejected drafts are stored archived + disliked so the taste profile learns from them.
    const id = uid();
    await save('recipes', { ...result.recipe, id, rating: -1, archived: true });
    await save('recipeFeedback', { id: uid(), recipeId: id, recipeName: result.recipe.name, date: today(), kind: 'dislike', comment: rejectReason || undefined });
    setResult(null);
    setRejectReason('');
  }

  return (
    <Sheet open onClose={onClose} title={base ? `Adapt: ${base.name}` : 'New recipe'}>
      {!result ? (
        <>
          <Field label={base ? 'What should change?' : 'What do you feel like?'} hint={base ? 'e.g. “swap chicken for turkey”, “make it spicier”, “no coconut”' : 'e.g. “mexican beef bowl”, “something with salmon”, “cheap and fast”, or leave empty for a surprise'}>
            <textarea className={cx(inputCls, 'h-20')} value={want} onChange={(e) => setWant(e.target.value)} />
          </Field>
          <Field label="Portions">
            <NumInput value={servings} onChange={setServings} />
          </Field>
          <p className="mb-3 text-xs text-faint">
            Targets ~{proteinPer} g protein per portion{settings.lowSodium ? (sodiumPer ? `, under ${sodiumPer} mg sodium, no added salt` : ', low sodium, no added salt') : ''}{settings.dietNotes ? `, respecting: ${settings.dietNotes}` : ''}. Learns from your likes, dislikes and edits.
          </p>
          <ErrorNote error={error} />
          <Button variant="primary" className="w-full" disabled={busy} onClick={run}>
            {busy ? 'Cooking something up…' : 'Generate'}
          </Button>
        </>
      ) : (
        <RecipePreview result={result}>
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" onClick={keep}>
              Keep it
            </Button>
            <Button onClick={run} disabled={busy}>
              {busy ? '…' : 'Another'}
            </Button>
          </div>
          <div className="mt-3 flex gap-2">
            <input className={inputCls} placeholder="Why not? (teaches the next one)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            <Button variant="danger" onClick={reject}>
              👎
            </Button>
          </div>
        </RecipePreview>
      )}
    </Sheet>
  );
}

function RecipePreview({ result, children }: { result: RecipeResult; children: ReactNode }) {
  const r = result.recipe;
  const p = perPortion(r);
  const watch = r.ingredients.flatMap((i) => watchlistHits(i.name).map(() => i.name));
  return (
    <div>
      <h3 className="text-lg font-semibold">{r.name}</h3>
      <NutrientLine n={p} className="block" />
      <div className="mb-3 text-xs text-muted">per portion · {r.servings} portions · {r.freezerFriendly ? 'freezes well' : `fridge ${r.fridgeDays ?? 3} days`}</div>
      {result.removed.length > 0 && <p className="mb-2 rounded-lg bg-warn/10 px-2 py-1.5 text-xs text-warn">Removed: {result.removed.join(', ')}.</p>}
      {result.issues.length > 0 && <p className="mb-2 rounded-lg bg-warn/10 px-2 py-1.5 text-xs text-warn">{result.issues.join(' ')}</p>}
      {watch.length > 0 && <p className="mb-2 rounded-lg bg-warn/10 px-2 py-1.5 text-xs text-warn">Sodium watchlist: {[...new Set(watch)].join(', ')}</p>}
      <ul className="mb-3 text-sm">
        {r.ingredients.map((i, k) => (
          <li key={k} className="flex justify-between border-b border-line py-1">
            <span>{i.name}</span>
            <span className="tnum text-muted">{i.grams} g</span>
          </li>
        ))}
      </ul>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
        {r.steps.map((s, k) => (
          <li key={k}>{s}</li>
        ))}
      </ol>
      {children}
    </div>
  );
}

// ---------------- Prep ----------------

function nextCookDays(): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < 2 && i < 8; i++) {
    const d = addDays(today(), i);
    if (weekday(d) === 3 || weekday(d) === 7) out.push(d);
  }
  return out;
}

function Prep() {
  const cookDays = nextCookDays();
  const batches = useLiveQuery(() => db.batches.orderBy('cookedOn').toArray(), []) ?? [];
  const left = batches.filter((b) => b.portionsEaten < b.portionsMade);
  return (
    <>
      {cookDays.map((d) => (
        <PlanCard key={d} date={d} />
      ))}
      <Card title="Freezer & fridge">
        {left.length === 0 ? (
          <Empty>Nothing stored. Mark a plan as cooked to add portions.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {left.map((b) => (
              <BatchRow key={b.id} b={b} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function BatchRow({ b }: { b: MealPrepBatch }) {
  const leftN = b.portionsMade - b.portionsEaten;
  const age = diffDays(today(), b.cookedOn);
  const old = b.storage === 'fridge' ? age > 3 : age > 90;
  return (
    <li className="flex items-center justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{b.recipeName}</div>
        <div className={cx('text-xs', old ? 'text-warn' : 'text-muted')}>
          {b.storage} · cooked {shortDate(b.cookedOn)} ({age} d){old ? ' · use or toss' : ''} · {leftN} left
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button size="sm" onClick={() => eatFromBatch(b)}>
          Eat 1
        </Button>
        <Button size="sm" variant="ghost" onClick={() => patch('batches', b.id, { portionsEaten: b.portionsEaten + 1 })} aria-label="Remove one without logging">
          −1
        </Button>
      </div>
    </li>
  );
}

function PlanCard({ date }: { date: string }) {
  const plan = useLiveQuery(() => db.mealPlans.get(date), [date]);
  const recipes = useLiveQuery(() => db.recipes.orderBy('name').toArray(), []) ?? [];
  const [showList, setShowList] = useState(false);
  const p: MealPlan = plan ?? { id: date, date, updatedAt: 0, items: [], checked: [] };
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const update = (changes: Partial<MealPlan>) => save('mealPlans', { ...p, ...changes });

  const shopping = new Map<string, { grams: number; watch: boolean }>();
  for (const it of p.items) {
    const r = byId.get(it.recipeId);
    if (!r) continue;
    const scale = it.portions / r.servings;
    for (const ing of r.ingredients) {
      const key = ing.name;
      const cur = shopping.get(key) ?? { grams: 0, watch: watchlistHits(ing.name).length > 0 };
      cur.grams += ing.grams * scale;
      shopping.set(key, cur);
    }
  }
  const list = [...shopping.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const checked = new Set(p.checked ?? []);

  return (
    <Card title={`Cook ${WEEKDAYS[weekday(date) - 1]} ${shortDate(date)}`}>
      {p.items.map((it, i) => {
        const r = byId.get(it.recipeId);
        return (
          <div key={i} className="mb-2 flex items-center gap-1.5">
            <select className={cx(inputCls, 'min-w-0 flex-1 py-2 text-sm')} value={it.recipeId} onChange={(e) => update({ items: p.items.map((x, j) => (j === i ? { ...x, recipeId: e.target.value } : x)) })}>
              {recipes.filter((x) => !x.archived).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <div className="w-14 shrink-0">
              <NumInput className="px-2 py-2 text-center" value={it.portions} onChange={(v) => v && update({ items: p.items.map((x, j) => (j === i ? { ...x, portions: v } : x)) })} />
            </div>
            <button className="px-1 text-faint" onClick={() => update({ items: p.items.filter((_, j) => j !== i) })}>
              ✕
            </button>
            {r && (
              <Button
                size="sm"
                onClick={async () => {
                  const keep = r.freezerFriendly ? 2 : it.portions;
                  await cookBatch(r, it.portions, r.freezerFriendly ? Math.max(0, it.portions - keep) : 0, today());
                  update({ items: p.items.filter((_, j) => j !== i) });
                }}
              >
                Cooked
              </Button>
            )}
          </div>
        );
      })}
      {p.items.length < 3 && recipes.length > 0 && (
        <Button
          size="sm"
          className="mb-2"
          onClick={() => {
            const pick = recipes.find((r) => !r.archived && r.rating !== -1 && !p.items.some((x) => x.recipeId === r.id)) ?? recipes[0];
            update({ items: [...p.items, { recipeId: pick.id, portions: pick.servings }] });
          }}
        >
          + Recipe
        </Button>
      )}
      {list.length > 0 && (
        <>
          <button className="mt-1 w-full text-left text-sm text-accent" onClick={() => setShowList(!showList)}>
            {showList ? '▾' : '▸'} Shopping list ({list.length - [...checked].filter((c) => shopping.has(c)).length} to buy)
          </button>
          {showList && (
            <ul className="mt-2 divide-y divide-line">
              {list.map(([name, v]) => (
                <li key={name}>
                  <label className="flex items-center gap-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked.has(name)}
                      onChange={(e) => {
                        const next = new Set(checked);
                        if (e.target.checked) next.add(name);
                        else next.delete(name);
                        update({ checked: [...next] });
                      }}
                    />
                    <span className={cx('flex-1', checked.has(name) && 'text-faint line-through')}>
                      {name}
                      {v.watch && <span className="ml-1 text-xs text-warn">sodium</span>}
                    </span>
                    <span className="tnum text-muted">{v.grams >= 1000 ? `${(v.grams / 1000).toFixed(2)} kg` : `${Math.round(v.grams)} g`}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

// ---------------- Library ----------------

function Library() {
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Food | null>(null);
  const [editMeal, setEditMeal] = useState<SavedMeal | null>(null);
  const foods = useLiveQuery(() => db.foods.orderBy('name').toArray(), []) ?? [];
  const meals = useLiveQuery(() => db.savedMeals.orderBy('order').toArray(), []) ?? [];
  const list = foods.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Card title="Quick meals" action={<Button size="sm" onClick={() => setEditMeal({ id: uid(), updatedAt: 0, name: '', slot: 'snack', nutrients: { kcal: 0, protein: 0, carbs: 0, fat: 0, sodiumMg: 0 }, order: meals.length })}>+ New</Button>}>
        <ul className="divide-y divide-line">
          {meals.map((m) => (
            <li key={m.id}>
              <button className="w-full py-2 text-left" onClick={() => setEditMeal(m)}>
                <div className="text-sm">{m.name}</div>
                <NutrientLine n={m.nutrients} />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Ingredients & foods" action={<Button size="sm" onClick={() => setEdit({ id: uid(), updatedAt: 0, name: '', per100: { kcal: 0, protein: 0, carbs: 0, fat: 0, sodiumMg: 0 }, source: 'manual' })}>+ New</Button>}>
        <input className={cx(inputCls, 'mb-2')} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="mb-2 text-xs text-faint">Seed values are approximate per 100 g. Check against fineli.fi and edit.</p>
        <ul className="divide-y divide-line">
          {list.map((f) => (
            <li key={f.id}>
              <button className="w-full py-2 text-left" onClick={() => setEdit(f)}>
                <div className="text-sm">
                  {f.name}
                  {(f.sodiumWatch || watchlistHits(f.name).length > 0) && <span className="ml-1 text-xs text-warn">sodium</span>}
                </div>
                <NutrientLine n={f.per100} />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {edit && <FoodSheet food={edit} onClose={() => setEdit(null)} />}
      {editMeal && <MealSheet meal={editMeal} onClose={() => setEditMeal(null)} />}
    </>
  );
}

function NutrientInputs({ n, onChange }: { n: Nutrients; onChange: (n: Nutrients) => void }) {
  return (
    <div className="mb-3 grid grid-cols-5 gap-2 text-center text-xs">
      {(['kcal', 'protein', 'carbs', 'fat', 'sodiumMg'] as const).map((k) => (
        <label key={k}>
          <span className="text-muted">{k === 'sodiumMg' ? 'Na mg' : k === 'kcal' ? 'kcal' : k[0].toUpperCase() + k.slice(1, 4)}</span>
          <NumInput className="mt-1 px-1 py-1.5 text-center text-sm" value={n[k]} onChange={(v) => onChange({ ...n, [k]: v ?? 0 })} />
        </label>
      ))}
    </div>
  );
}

function FoodSheet({ food, onClose }: { food: Food; onClose: () => void }) {
  const [f, setF] = useState(food);
  const [salt, setSalt] = useState<number | null>(null);
  return (
    <Sheet open onClose={onClose} title={food.name || 'New food'}>
      <Field label="Name">
        <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <div className="mb-1 text-sm text-muted">Per 100 g</div>
      <NutrientInputs n={f.per100} onChange={(per100) => setF({ ...f, per100 })} />
      <Field label="Label says salt (g/100 g)? Convert to sodium" hint="sodium mg = salt g × 400">
        <div className="flex gap-2">
          <NumInput value={salt} onChange={setSalt} />
          <Button disabled={salt === null} onClick={() => setF({ ...f, per100: { ...f.per100, sodiumMg: Math.round((salt ?? 0) * 400) } })}>
            Apply
          </Button>
        </div>
      </Field>
      <Field label="Serving size (g, optional)">
        <NumInput value={f.servingG} onChange={(v) => setF({ ...f, servingG: v ?? undefined })} />
      </Field>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!f.sodiumWatch} onChange={(e) => setF({ ...f, sodiumWatch: e.target.checked })} /> On my sodium watchlist
      </label>
      <div className="flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          disabled={!f.name.trim()}
          onClick={async () => {
            await save('foods', f);
            onClose();
          }}
        >
          Save
        </Button>
        <Button
          onClick={async () => {
            await logFood({ date: today(), slot: 'snack', name: f.name, grams: f.servingG ?? 100, nutrients: forGrams(f.per100, f.servingG ?? 100), ref: { kind: 'food', id: f.id } });
            onClose();
          }}
        >
          Log {f.servingG ?? 100} g
        </Button>
        <Button variant="danger" onClick={async () => { await remove('foods', f.id); onClose(); }}>
          Delete
        </Button>
      </div>
    </Sheet>
  );
}

function MealSheet({ meal, onClose }: { meal: SavedMeal; onClose: () => void }) {
  const [m, setM] = useState(meal);
  return (
    <Sheet open onClose={onClose} title={meal.name || 'New quick meal'}>
      <Field label="Name">
        <input className={inputCls} value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} />
      </Field>
      <Field label="Meal">
        <select className={inputCls} value={m.slot} onChange={(e) => setM({ ...m, slot: e.target.value as SavedMeal['slot'] })}>
          {SLOTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="mb-1 text-sm text-muted">Whole meal</div>
      <NutrientInputs n={m.nutrients} onChange={(nutrients) => setM({ ...m, nutrients })} />
      {m.description && <p className="mb-3 text-xs text-faint">{m.description}</p>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          disabled={!m.name.trim()}
          onClick={async () => {
            await save('savedMeals', { ...m, description: undefined });
            onClose();
          }}
        >
          Save
        </Button>
        <Button variant="danger" onClick={async () => { await remove('savedMeals', m.id); onClose(); }}>
          Delete
        </Button>
      </div>
    </Sheet>
  );
}
