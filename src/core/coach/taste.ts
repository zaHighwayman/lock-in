// Turns recipe likes/dislikes/edits into a compact preference profile for recipe generation,
// and describes what changed when a recipe is edited.
import type { Recipe, RecipeFeedback } from '../model';

function mainIngredients(r: Recipe, n = 4): string {
  return [...r.ingredients]
    .sort((a, b) => b.grams - a.grams)
    .slice(0, n)
    .map((i) => i.name.split(',')[0].toLowerCase())
    .join(', ');
}

export function tasteProfile(recipes: Recipe[], feedback: RecipeFeedback[], notes: string): string {
  const liked = recipes.filter((r) => r.rating === 1);
  const disliked = recipes.filter((r) => r.rating === -1);
  const recent = [...feedback].sort((a, b) => b.updatedAt - a.updatedAt);
  const commentFor = (id: string) => recent.find((f) => f.recipeId === id && f.comment)?.comment;
  const edits = recent.filter((f) => f.kind === 'edit' && f.detail).slice(0, 12);
  const comments = recent.filter((f) => f.kind === 'comment' && f.comment).slice(0, 8);

  const lines: string[] = [];
  if (notes.trim()) lines.push(`Stated preferences: ${notes.trim()}`);
  if (liked.length) {
    lines.push('Liked recipes:');
    for (const r of liked.slice(0, 12)) {
      const c = commentFor(r.id);
      lines.push(`- ${r.name} (${mainIngredients(r)})${c ? ` — "${c}"` : ''}`);
    }
  }
  if (disliked.length) {
    lines.push('Disliked recipes (avoid what made these bad):');
    for (const r of disliked.slice(0, 12)) {
      const c = commentFor(r.id);
      lines.push(`- ${r.name} (${mainIngredients(r)})${c ? ` — "${c}"` : ''}`);
    }
  }
  if (edits.length) {
    lines.push('Changes the user made to generated recipes (learn from these):');
    for (const e of edits) lines.push(`- ${e.recipeName}: ${e.detail}`);
  }
  if (comments.length) {
    lines.push('Other comments:');
    for (const c of comments) lines.push(`- ${c.recipeName}: "${c.comment}"`);
  }
  return lines.length ? lines.join('\n') : 'No feedback yet.';
}

/** Human-readable diff of an edit, stored as feedback so future generations learn from it. */
export function describeEdit(before: Recipe, after: Recipe): string {
  const changes: string[] = [];
  if (before.name !== after.name) changes.push(`renamed to "${after.name}"`);
  if (before.servings !== after.servings) changes.push(`servings ${before.servings} → ${after.servings}`);
  const key = (n: string) => n.trim().toLowerCase();
  const old = new Map(before.ingredients.map((i) => [key(i.name), i]));
  const neu = new Map(after.ingredients.map((i) => [key(i.name), i]));
  const removed = [...old.keys()].filter((k) => !neu.has(k));
  const added = [...neu.keys()].filter((k) => !old.has(k));
  for (const k of removed) changes.push(`removed ${old.get(k)!.name}`);
  for (const k of added) changes.push(`added ${neu.get(k)!.name} ${neu.get(k)!.grams} g`);
  for (const [k, i] of neu) {
    const o = old.get(k);
    if (o && Math.abs(o.grams - i.grams) >= 1) changes.push(`${i.name} ${o.grams} → ${i.grams} g`);
  }
  if (before.steps.join('\n') !== after.steps.join('\n')) changes.push('changed the method');
  return changes.join('; ');
}
