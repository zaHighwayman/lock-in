import { describe, expect, it } from 'vitest';
import type { Recipe, RecipeFeedback } from '../model';
import { describeEdit, tasteProfile } from './taste';

const n = { kcal: 100, protein: 10, carbs: 10, fat: 1, sodiumMg: 10 };
const recipe = (id: string, name: string, rating: Recipe['rating'], ings: [string, number][]): Recipe => ({
  id, name, rating, updatedAt: 0, servings: 4, freezerFriendly: true, source: 'ai', steps: ['cook'],
  ingredients: ings.map(([name, grams]) => ({ name, grams, per100: n })),
});

describe('taste profile', () => {
  it('lists likes, dislikes with comments and edits', () => {
    const recipes = [
      recipe('a', 'Chili', 1, [['Chicken breast, raw', 900], ['Kidney beans', 400]]),
      recipe('b', 'Mushroom stew', -1, [['Mushrooms', 600]]),
    ];
    const fb: RecipeFeedback[] = [
      { id: '1', updatedAt: 2, recipeId: 'b', recipeName: 'Mushroom stew', date: '2026-10-01', kind: 'dislike', comment: 'hate mushrooms' },
      { id: '2', updatedAt: 3, recipeId: 'a', recipeName: 'Chili', date: '2026-10-02', kind: 'edit', detail: 'chili flakes 3 → 6 g' },
    ];
    const p = tasteProfile(recipes, fb, 'spicy please');
    expect(p).toContain('Stated preferences: spicy please');
    expect(p).toContain('- Chili (chicken breast, kidney beans)');
    expect(p).toContain('"hate mushrooms"');
    expect(p).toContain('Chili: chili flakes 3 → 6 g');
  });
  it('says when there is no feedback', () => {
    expect(tasteProfile([], [], '')).toBe('No feedback yet.');
  });
});

describe('describeEdit', () => {
  it('summarises ingredient and serving changes', () => {
    const a = recipe('a', 'Chili', 0, [['Chicken', 900], ['Chickpeas', 200]]);
    const b = { ...recipe('a', 'Chili', 0, [['Chicken', 1000], ['Kidney beans', 200]]), servings: 5 };
    expect(describeEdit(a, b)).toBe('servings 4 → 5; removed Chickpeas; added Kidney beans 200 g; Chicken 900 → 1000 g');
  });
});
