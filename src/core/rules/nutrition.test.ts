import { describe, expect, it } from 'vitest';
import { checkText, constraintsText, forbiddenIngredient, STRICT_PROFILE, type GuardProfile } from './guardrails';
import { dayFlags, perPortion, proteinTarget, watchlistHits } from './nutrition';

const n = (kcal: number, protein: number, carbs: number, fat: number, sodiumMg: number) => ({ kcal, protein, carbs, fat, sodiumMg });

describe('nutrition math', () => {
  it('computes per-portion values from ingredients', () => {
    const p = perPortion({
      servings: 2,
      ingredients: [
        { name: 'chicken breast', grams: 400, per100: n(110, 23, 0, 2, 60) },
        { name: 'rice', grams: 200, per100: n(350, 7, 78, 1, 5) },
      ],
    });
    expect(p).toEqual({ kcal: 570, protein: 53, carbs: 78, fat: 5, sodiumMg: 125 });
  });
  it('protein target is 1.5 g/kg', () => {
    expect(proteinTarget(68, 1.5)).toBe(102);
  });
  it('flags low protein and sodium over the ceiling', () => {
    const f = dayFlags(n(2400, 80, 300, 70, 2300), 102, 2000);
    expect(f.map((x) => x.level)).toEqual(['info', 'warn']);
    expect(dayFlags(n(2400, 105, 300, 70, 1500), 102, 2000)).toEqual([]);
  });
});

describe('sodium watchlist', () => {
  it('flags high-sodium ingredients in English and Finnish', () => {
    expect(watchlistHits('Chicken stock cube')).toContain('stock cube');
    expect(watchlistHits('Soijakastike')).toContain('soijakastike');
    expect(watchlistHits('Grated cheese')).toContain('cheese');
    expect(watchlistHits('Tortillas')).toContain('tortilla');
  });
  it('does not flag safe look-alikes', () => {
    expect(watchlistHits('Olive oil')).toEqual([]);
    expect(watchlistHits('Smoked paprika')).toEqual([]);
    expect(watchlistHits('Hamburger patty')).not.toContain('ham');
    expect(watchlistHits('No-salt chicken stock')).toEqual([]);
    expect(watchlistHits('Crushed tomatoes, canned, no added salt')).toEqual([]);
    expect(watchlistHits('Vegetable stock, homemade, no salt')).toEqual([]);
    expect(watchlistHits('Chicken stock')).toContain('stock');
  });
});

describe('guardrails', () => {
  it('catches salt substitutes', () => {
    expect(checkText('Use Pansuola instead of salt')).toHaveLength(1);
    expect(checkText('a bit of potassium chloride')).toHaveLength(1);
    expect(forbiddenIngredient('Pansuola')).toBe('salt substitute');
  });
  it('catches adding salt', () => {
    expect(checkText('Season with salt and pepper.')).toHaveLength(1);
    expect(checkText('salt to taste')).toHaveLength(1);
    expect(forbiddenIngredient('Sea salt')).toBe('added salt');
    expect(forbiddenIngredient('No-salt stock')).toBeNull();
  });
  it('catches protein target changes but not the 1.5 g/kg target itself', () => {
    expect(checkText('You are hitting 1.5 g/kg, nice.')).toEqual([]);
    expect(checkText('Go up to 2 g/kg protein')).toHaveLength(1);
    expect(checkText('lower your protein target')).toHaveLength(1);
  });
  it('catches big deficits but allows 250', () => {
    expect(checkText('Run a 500 kcal deficit')).toHaveLength(1);
    expect(checkText('a deficit of 200 kcal is fine')).toEqual([]);
  });
  it('catches skipped meals and supplements', () => {
    expect(checkText('Just skip breakfast on rest days')).toHaveLength(1);
    expect(checkText('Take creatine')).toHaveLength(1);
  });
  it('passes normal coaching text', () => {
    expect(checkText('Bench went up 2.5 kg, sleep averaged 8 h 10 min. Keep the dinner carb portion as is.')).toEqual([]);
  });
});

describe('guardrails follow the profile', () => {
  const relaxed: GuardProfile = { lowSodium: false, proteinLocked: false, proteinGPerKg: 1.8, goal: 'cut', dietNotes: 'vegetarian', birthYear: 2000 };
  it('salt is fine without low-sodium mode', () => {
    expect(checkText('Season with salt and pepper.', relaxed)).toEqual([]);
    expect(forbiddenIngredient('Salt', false)).toBeNull();
  });
  it('protein numbers are only policed when the target is locked', () => {
    expect(checkText('Go up to 2 g/kg protein', relaxed)).toEqual([]);
    expect(checkText('Aim for 1.8 g/kg', { ...relaxed, proteinLocked: true })).toEqual([]);
    expect(checkText('Aim for 2.2 g/kg', { ...relaxed, proteinLocked: true })).toHaveLength(1);
  });
  it('a cut allows up to 500 kcal deficit', () => {
    expect(checkText('Run a 400 kcal deficit', relaxed)).toEqual([]);
    expect(checkText('Run a 700 kcal deficit', relaxed)).toHaveLength(1);
    expect(checkText('Run a 400 kcal deficit', STRICT_PROFILE)).toHaveLength(1);
  });
  it('skipped meals and supplements are flagged for everyone', () => {
    expect(checkText('skip breakfast', relaxed)).toHaveLength(1);
    expect(checkText('take creatine', relaxed)).toHaveLength(1);
  });
  it('builds constraint text from the profile', () => {
    const strict = constraintsText(STRICT_PROFILE);
    expect(strict).toContain('low-sodium');
    expect(strict).toContain('fixed at 1.5 g');
    expect(strict).toContain('under 18');
    const other = constraintsText(relaxed);
    expect(other).not.toContain('low-sodium');
    expect(other).toContain('1.8 g per kg');
    expect(other).toContain('500 kcal');
    expect(other).toContain('vegetarian');
  });
});
