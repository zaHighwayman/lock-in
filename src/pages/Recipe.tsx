// Recipe detail: rate it, comment, edit (edits are saved as feedback), adapt with AI, log or cook it.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cookBatch, logRecipePortion } from '../app/actions';
import { useSettings } from '../app/hooks';
import { describeEdit } from '../core/coach/taste';
import { today } from '../core/dates';
import type { Recipe, RecipeIngredient } from '../core/model';
import { forbiddenIngredient } from '../core/rules/guardrails';
import { perPortion, watchlistHits } from '../core/rules/nutrition';
import { patch, save, uid } from '../db/repo';
import { db } from '../db/schema';
import { NutrientLine } from '../features/AddFoodSheet';
import { Button, Card, Field, NumInput, Page, Sheet, Stat, cx, inputCls } from '../ui/kit';
import { GenerateSheet } from './Food';

export default function RecipePage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const recipe = useLiveQuery(() => db.recipes.get(id), [id]);
  const feedback = useLiveQuery(() => db.recipeFeedback.where('recipeId').equals(id).toArray(), [id]) ?? [];
  const settings = useSettings();
  const [editing, setEditing] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [comment, setComment] = useState('');
  const [cooking, setCooking] = useState(false);
  const [logged, setLogged] = useState(false);

  if (recipe === undefined) return <Page title="Loading…">{null}</Page>;
  if (recipe === null) return <Page title="Not found" back={() => nav(-1)}>{null}</Page>;

  const p = perPortion(recipe);
  const sodiumShare = settings.sodiumCeilingMg ? p.sodiumMg / settings.sodiumCeilingMg : null;

  async function rate(rating: 1 | -1) {
    const next = recipe!.rating === rating ? 0 : rating;
    await patch('recipes', recipe!.id, { rating: next });
    if (next !== 0) await save('recipeFeedback', { id: uid(), recipeId: recipe!.id, recipeName: recipe!.name, date: today(), kind: next === 1 ? 'like' : 'dislike', comment: comment || undefined });
    setComment('');
  }

  return (
    <Page title={recipe.name} back={() => nav(-1)}>
      <Card>
        <div className="mb-2 grid grid-cols-4 gap-2">
          <Stat label="kcal" value={p.kcal} />
          <Stat label="Protein" value={`${p.protein} g`} />
          <Stat label="Carbs" value={`${p.carbs} g`} />
          <Stat label="Fat" value={`${p.fat} g`} />
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted">Sodium per portion</span>
          <span className={cx('tnum', sodiumShare !== null && sodiumShare > 0.35 ? 'text-warn' : 'text-ink')}>
            {p.sodiumMg} mg{sodiumShare !== null ? ` (${Math.round(sodiumShare * 100)} % of daily)` : ''}
          </span>
        </div>
        <div className="mt-1 text-xs text-muted">
          per portion · {recipe.servings} portions · {recipe.freezerFriendly ? 'freezer-friendly' : `fridge only, ${recipe.fridgeDays ?? 3} days`}
        </div>
      </Card>

      <Card title="Your verdict">
        <div className="mb-2 flex gap-2">
          <Button className={cx('flex-1', recipe.rating === 1 && 'border-good bg-good/15 text-good')} onClick={() => rate(1)}>
            👍 Like
          </Button>
          <Button className={cx('flex-1', recipe.rating === -1 && 'border-bad bg-bad/15 text-bad')} onClick={() => rate(-1)}>
            👎 Dislike
          </Button>
        </div>
        <div className="flex gap-2">
          <input className={inputCls} placeholder="Comment: too dry, more chili, kids loved it…" value={comment} onChange={(e) => setComment(e.target.value)} />
          <Button
            disabled={!comment.trim()}
            onClick={async () => {
              await save('recipeFeedback', { id: uid(), recipeId: recipe.id, recipeName: recipe.name, date: today(), kind: 'comment', comment: comment.trim() });
              setComment('');
            }}
          >
            Save
          </Button>
        </div>
        {feedback.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {feedback
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, 5)
              .map((f) => (
                <li key={f.id}>
                  {f.date} · {f.kind}
                  {f.comment ? `: “${f.comment}”` : ''}
                  {f.detail ? `: ${f.detail}` : ''}
                </li>
              ))}
          </ul>
        )}
      </Card>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          onClick={async () => {
            await logRecipePortion(recipe);
            setLogged(true);
          }}
        >
          {logged ? '✓ Logged' : 'Ate a portion'}
        </Button>
        <Button onClick={() => setCooking(true)}>Cooked a batch</Button>
        <Button onClick={() => setEditing(true)}>Edit</Button>
        <Button onClick={() => setAdapting(true)}>✦ Adapt with AI</Button>
      </div>

      <Card title="Ingredients">
        <ul className="text-sm">
          {recipe.ingredients.map((i, k) => {
            const watch = watchlistHits(i.name).length > 0;
            return (
              <li key={k} className="flex justify-between border-b border-line py-1.5 last:border-0">
                <span>
                  {i.name}
                  {watch && <span className="ml-1 text-xs text-warn">sodium</span>}
                </span>
                <span className="tnum text-muted">{i.grams} g</span>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="Method">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {recipe.steps.map((s, k) => (
            <li key={k}>{s}</li>
          ))}
        </ol>
      </Card>
      <Button variant="ghost" className="w-full" onClick={async () => { await patch('recipes', recipe.id, { archived: !recipe.archived }); nav(-1); }}>
        {recipe.archived ? 'Restore recipe' : 'Archive recipe'}
      </Button>

      {editing && <EditSheet recipe={recipe} onClose={() => setEditing(false)} />}
      {adapting && <GenerateSheet base={recipe} onClose={() => setAdapting(false)} />}
      {cooking && <CookSheet recipe={recipe} onClose={() => setCooking(false)} />}
    </Page>
  );
}

function CookSheet({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const [portions, setPortions] = useState<number | null>(recipe.servings);
  const [frozen, setFrozen] = useState<number | null>(recipe.freezerFriendly ? Math.max(0, recipe.servings - 2) : 0);
  return (
    <Sheet open onClose={onClose} title="Cooked a batch">
      <Field label="Portions made">
        <NumInput value={portions} onChange={setPortions} />
      </Field>
      {recipe.freezerFriendly && (
        <Field label="Of which frozen" hint="The rest go in the fridge for the next 2–3 days.">
          <NumInput value={frozen} onChange={setFrozen} />
        </Field>
      )}
      <Button
        variant="primary"
        className="w-full"
        disabled={!portions}
        onClick={async () => {
          await cookBatch(recipe, portions!, Math.min(portions!, frozen ?? 0));
          onClose();
        }}
      >
        Add to inventory
      </Button>
    </Sheet>
  );
}

function EditSheet({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const settings = useSettings();
  const [r, setR] = useState<Recipe>(structuredClone(recipe));
  const foods = useLiveQuery(() => db.foods.orderBy('name').toArray(), []) ?? [];
  const [error, setError] = useState<string | null>(null);
  const setIng = (i: number, changes: Partial<RecipeIngredient>) => setR({ ...r, ingredients: r.ingredients.map((x, j) => (j === i ? { ...x, ...changes } : x)) });

  async function saveIt() {
    const bad = r.ingredients.map((i) => forbiddenIngredient(i.name, settings.lowSodium)).find(Boolean);
    if (bad) return setError(`Not allowed on your low-sodium diet: ${bad}.`);
    const detail = describeEdit(recipe, r);
    await save('recipes', { ...r, steps: r.steps.filter((s) => s.trim()) });
    if (detail) await save('recipeFeedback', { id: uid(), recipeId: r.id, recipeName: r.name, date: today(), kind: 'edit', detail });
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Edit recipe">
      <Field label="Name">
        <input className={inputCls} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Portions">
          <NumInput value={r.servings} onChange={(v) => v && setR({ ...r, servings: Math.max(1, Math.round(v)) })} />
        </Field>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={r.freezerFriendly} onChange={(e) => setR({ ...r, freezerFriendly: e.target.checked })} /> Freezer-friendly
        </label>
      </div>
      <div className="mb-1 text-sm text-muted">Ingredients (g)</div>
      <ul className="mb-2 space-y-2">
        {r.ingredients.map((i, k) => (
          <li key={k} className="flex items-center gap-2">
            <input className={cx(inputCls, 'py-2 text-sm')} value={i.name} onChange={(e) => setIng(k, { name: e.target.value, foodId: undefined })} />
            <NumInput className="w-20 py-2" value={i.grams} onChange={(v) => setIng(k, { grams: v ?? 0 })} />
            <button className="px-1 text-faint" onClick={() => setR({ ...r, ingredients: r.ingredients.filter((_, j) => j !== k) })}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <select
        className={cx(inputCls, 'mb-4')}
        value=""
        onChange={(e) => {
          const f = foods.find((x) => x.id === e.target.value);
          if (f) setR({ ...r, ingredients: [...r.ingredients, { name: f.name, grams: 100, per100: f.per100, foodId: f.id }] });
        }}
      >
        <option value="">+ Add ingredient from library</option>
        {foods.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <Field label="Method (one step per line)">
        <textarea className={cx(inputCls, 'h-40 text-sm')} value={r.steps.join('\n')} onChange={(e) => setR({ ...r, steps: e.target.value.split('\n') })} />
      </Field>
      <div className="mb-3">
        <NutrientLine n={perPortion(r)} /> <span className="text-xs text-faint">per portion</span>
      </div>
      {error && <p className="mb-2 text-sm text-bad">{error}</p>}
      <Button variant="primary" className="w-full" onClick={saveIt}>
        Save changes
      </Button>
    </Sheet>
  );
}
