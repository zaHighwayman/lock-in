import { describe, expect, it } from 'vitest';
import type { Food, Profile } from '../core/model';
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

const strict: Profile = { sex: 'male', heightCm: 176, birthYear: 2009, goal: 'recomp', goalText: 'aesthetic', proteinGPerKg: 1.5, proteinLocked: true, lowSodium: true, sodiumCeilingMg: 2000, dietNotes: '' };
const relaxed: Profile = { ...strict, sex: 'female', birthYear: 1998, goal: 'cut', proteinGPerKg: 1.8, proteinLocked: false, lowSodium: false, sodiumCeilingMg: null, dietNotes: 'vegetarian' };

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
    const r = await generateRecipe(ai, { want: 'chili', servings: 4, proteinPerPortionG: 35, sodiumPerPortionMaxMg: 600, tasteProfile: 'Liked: chili', pantry, profile: strict });
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
    const r = await askCoach(ai, [{ role: 'user', text: 'should I cut?' }], '{"week":1}', strict, 68);
    expect(ai.calls[0].system).toContain('1.5 g per kg');
    expect(ai.calls[0].system).toContain('{"week":1}');
    expect(r.issues[0]).toMatch(/500 kcal/);
  });
});

describe('prompts follow the profile', () => {
  it('a relaxed profile keeps salt and drops the medical locks', async () => {
    const ai = fake(JSON.stringify({ name: 'Bean chili', servings: 4, freezerFriendly: true, ingredients: [{ name: 'Salt', grams: 3, per100: n(0, 0, 0, 0, 38000) }, { name: 'Beans', grams: 400, per100: n(100, 7, 14, 0.5, 10) }], steps: ['Season with salt.'] }));
    const r = await generateRecipe(ai, { want: 'chili', servings: 4, proteinPerPortionG: 30, sodiumPerPortionMaxMg: null, tasteProfile: '', pantry: [], profile: relaxed });
    expect(r.removed).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(ai.calls[0].system).not.toContain('No added salt');
    expect(ai.calls[0].system).toContain('vegetarian');
  });
  it('the coach prompt describes the person, not a fixed athlete', async () => {
    const ai = fake('ok');
    await askCoach(ai, [{ role: 'user', text: 'hi' }], '{}', { ...relaxed, displayName: 'Sara' }, 61.4);
    const sys = ai.calls[0].system;
    expect(sys).toContain('named Sara');
    expect(sys).toContain('female');
    expect(sys).toContain('~61 kg');
    expect(sys).toContain('fat loss');
    expect(sys).not.toContain('low-sodium');
    expect(sys).not.toContain('17-year-old');
  });
});
