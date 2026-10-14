// Nutrition math, protein target, sodium watchlist.
import type { Flag, FoodLogEntry, Nutrients, Recipe, RecipeIngredient } from '../model';
import { ZERO } from '../model';

export function addN(a: Nutrients, b: Nutrients): Nutrients {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
    sodiumMg: a.sodiumMg + b.sodiumMg,
  };
}

export function scaleN(n: Nutrients, factor: number): Nutrients {
  return {
    kcal: n.kcal * factor,
    protein: n.protein * factor,
    carbs: n.carbs * factor,
    fat: n.fat * factor,
    sodiumMg: n.sodiumMg * factor,
  };
}

export const sumN = (list: Nutrients[]) => list.reduce(addN, ZERO);

export function roundN(n: Nutrients): Nutrients {
  return {
    kcal: Math.round(n.kcal),
    protein: Math.round(n.protein * 10) / 10,
    carbs: Math.round(n.carbs * 10) / 10,
    fat: Math.round(n.fat * 10) / 10,
    sodiumMg: Math.round(n.sodiumMg),
  };
}

export const forGrams = (per100: Nutrients, grams: number) => scaleN(per100, grams / 100);

export function recipeTotal(ingredients: RecipeIngredient[]): Nutrients {
  return sumN(ingredients.map((i) => forGrams(i.per100, i.grams)));
}

export function perPortion(r: Pick<Recipe, 'ingredients' | 'servings'>): Nutrients {
  return roundN(scaleN(recipeTotal(r.ingredients), 1 / Math.max(1, r.servings)));
}

/** Fixed 1.5 g/kg target (user-set medical constraint). */
export function proteinTarget(weightKg: number, gPerKg: number): number {
  return Math.round(weightKg * gPerKg);
}

export function dayTotals(entries: FoodLogEntry[]): Nutrients {
  return roundN(sumN(entries.map((e) => e.nutrients)));
}

/** Ingredients that are usually high in sodium. Matched on whole words (English + Finnish). */
export const SODIUM_WATCHLIST = [
  'salt', 'suola', 'stock cube', 'bouillon', 'liemikuutio', 'fond', 'liemi', 'broth', 'stock',
  'soy sauce', 'soijakastike', 'fish sauce', 'kalakastike', 'oyster sauce', 'worcestershire',
  'ready sauce', 'valmiskastike', 'pasta sauce', 'pastakastike', 'taco sauce', 'curry paste', 'currytahna',
  'spice mix', 'mausteseos', 'taco seasoning', 'grill seasoning', 'grillimauste', 'seasoning',
  'cheese', 'juusto', 'feta', 'parmesan', 'halloumi',
  'ham', 'kinkku', 'salami', 'bacon', 'pekoni', 'sausage', 'makkara', 'nakki', 'leikkele', 'cold cut',
  'tortilla', 'wrap', 'bread', 'leipä', 'pita', 'naan',
  'ketchup', 'pesto', 'olives', 'oliivit', 'pickle', 'suolakurkku', 'capers', 'kapris',
  'canned tuna', 'tonnikala', 'smoked salmon', 'savulohi', 'smoked ham',
];

export function watchlistHits(name: string): string[] {
  const n = name.toLowerCase();
  return SODIUM_WATCHLIST.filter((w) => new RegExp(`(^|[^a-zäöå])${w}(s|es)?(?![a-zäöå])`, 'i').test(n) && !isSafeVariant(n, w));
}

/** "no-salt", "low sodium", "unsalted", "suolaton" variants are fine. */
function isSafeVariant(name: string, hit: string): boolean {
  if (/(no[- ](added[- ])?salt|salt[- ]free|unsalted|without salt|low[- ]sodium|sodium[- ]free|suolaton|vähäsuolainen|ilman (lisättyä )?suolaa)/.test(name)) {
    return ['salt', 'suola', 'stock', 'liemi', 'broth', 'stock cube', 'bouillon', 'fond'].includes(hit);
  }
  return false;
}

/** Protein + sodium check for one day of logging. */
export function dayFlags(totals: Nutrients, proteinTargetG: number, sodiumCeilingMg: number | null): Flag[] {
  const flags: Flag[] = [];
  if (totals.protein < proteinTargetG * 0.9) {
    flags.push({
      rule: 0,
      area: 'nutrition',
      level: 'info',
      title: `Protein ${Math.round(totals.protein)} / ${proteinTargetG} g`,
      detail: 'Still short of the 1.5 g/kg target. A rahka or an extra dinner portion closes the gap.',
    });
  }
  if (sodiumCeilingMg && totals.sodiumMg > sodiumCeilingMg) {
    flags.push({
      rule: 0,
      area: 'nutrition',
      level: 'warn',
      title: `Sodium ${Math.round(totals.sodiumMg)} mg is over your ${sodiumCeilingMg} mg ceiling`,
      detail: 'Check the logged items for watchlist foods (bread, cheese, ready sauces, school lunch).',
    });
  }
  return flags;
}
