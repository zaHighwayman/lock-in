import { describe, expect, it } from 'vitest';
import type { Food } from '../core/model';
import { parseJson, type LlmProvider } from './provider';
import { askCoach, estimateFood, generateRecipe } from './tasks';

const fake = (reply: string): LlmProvider & { calls: { system: string; text: string }[] } => {
  const calls: { system: string; text: string }[] = [];
  return {
    name: 'fake',
    calls,
    async generate(system, messages) {
      calls.push({ system, text: messages[messages.length - 1].text });
      return reply;
    },
  };
};

const n = (kcal: number, protein: number, carbs: number, fat: number, sodiumMg: number) => ({ kcal, protein, carbs, fat, sodiumMg });

describe('parseJson', () => {
  it('reads fenced and prose-wrapped JSON', () => {
    expect(parseJson('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('sure {"a":[1,2]} done')).toEqual({ a: [1, 2] });
  });
});

describe('estimateFood', () => {
  it('validates and coerces the reply', async () => {
    const ai = fake('{"name":"Skyr vanilla","per100":{"kcal":"62","protein":10,"carbs":4,"fat":0.2,"sodiumMg":40},"grams":150,"confidence":"high","notes":"pot is 150 g"}');
    const r = await estimateFood(ai, { text: 'one pot' });
    expect(r.per100.kcal).toBe(62);
    expect(r.grams).toBe(150);
    expect(ai.calls[0].system).toContain('salt_g × 400');
  });
});

describe('generateRecipe', () => {
  const pantry: Food[] = [{ id: 'f-rice', updatedAt: 0, name: 'Basmati rice, dry', per100: n(355, 8, 78, 0.8, 2), source: 'fineli' }];
  const reply = JSON.stringify({
    name: 'Turkey chili',
    servings: 4,
    freezerFriendly: true,
    tags: ['freezer'],
    ingredients: [
      { name: 'Turkey mince', grams: 600, per100: n(150, 20, 0, 7, 70) },
      { name: 'Basmati rice, dry', grams: 300, per100: n(999, 0, 0, 0, 0) },
      { name: 'Pansuola', grams: 5, per100: n(0, 0, 0, 0, 0) },
      { name: 'Salt', grams: 3, per100: n(0, 0, 0, 0, 38000) },
    ],
    steps: ['Brown the turkey.', 'Season with salt to taste.'],
  });

  it('drops forbidden ingredients, reuses pantry values and flags salt in the steps', async () => {
    const ai = fake(reply);
    const r = await generateRecipe(ai, { want: 'chili', servings: 4, proteinPerPortionG: 35, sodiumPerPortionMaxMg: 600, tasteProfile: 'Liked: chili', pantry });
    expect(r.recipe.ingredients.map((i) => i.name)).toEqual(['Turkey mince', 'Basmati rice, dry']);
    expect(r.recipe.ingredients[1].per100.kcal).toBe(355);
    expect(r.removed).toEqual(['Pansuola (salt substitute)', 'Salt (added salt)']);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(ai.calls[0].system).toContain('under 600 mg');
    expect(ai.calls[0].text).toContain('Liked: chili');
  });
});

describe('askCoach', () => {
  it('passes the constraints and context, and checks the reply', async () => {
    const ai = fake('Run a 500 kcal deficit.');
    const r = await askCoach(ai, [{ role: 'user', text: 'should I cut?' }], '{"week":1}');
    expect(ai.calls[0].system).toContain('1.5 g per kg');
    expect(ai.calls[0].system).toContain('{"week":1}');
    expect(r.issues[0]).toMatch(/500 kcal/);
  });
});
