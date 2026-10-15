// First-run seed: your exercises, the 4-day program, schedule, default meals, ingredient table, recipes.
// Ingredient values are approximate per 100 g (raw unless stated); edit them in Food → Library.
import type { Exercise, Food, LoadType, MuscleGroup, Nutrients, ProgramDay, ProgramItem, Recipe, SavedMeal, Settings } from '../core/model';
import { db } from './schema';

const ex = (
  id: string, name: string, muscleGroup: MuscleGroup, kind: Exercise['kind'], loadType: LoadType,
  repMin: number, repMax: number | null, increment: number, restSec: number,
): Exercise => ({ id, name, muscleGroup, kind, loadType, repMin, repMax, increment, restSec, updatedAt: 0 });

export const SEED_EXERCISES: Exercise[] = [
  ex('bench-press', 'Bench press', 'chest', 'compound', 'barbell', 5, 8, 2.5, 180),
  ex('chest-supported-row', 'Chest-supported row', 'back', 'compound', 'machine', 8, 12, 2, 120),
  ex('barbell-row', 'Barbell row', 'back', 'compound', 'barbell', 8, 12, 2.5, 120),
  ex('overhead-press', 'Overhead press', 'shoulders', 'compound', 'barbell', 6, 10, 2.5, 150),
  ex('lat-pulldown', 'Lat pulldown', 'back', 'compound', 'cable', 8, 12, 2, 120),
  ex('lateral-raise', 'Lateral raise', 'shoulders', 'isolation', 'dumbbell', 12, 20, 1, 60),
  ex('preacher-curl', 'Preacher curl', 'biceps', 'isolation', 'machine', 8, 12, 2, 75),
  ex('triceps-pushdown', 'Triceps pushdown', 'triceps', 'isolation', 'cable', 10, 15, 2, 75),
  ex('leg-extension', 'Leg extension', 'quads', 'isolation', 'machine', 10, 15, 2, 90),
  ex('leg-curl', 'Lying leg curl', 'hamstrings', 'isolation', 'machine', 10, 15, 2, 90),
  ex('seated-leg-curl', 'Seated leg curl', 'hamstrings', 'isolation', 'machine', 10, 15, 2, 90),
  ex('calf-raise', 'Calf raise', 'calves', 'isolation', 'machine', 12, 20, 2, 60),
  ex('hammer-curl', 'Hammer curl', 'biceps', 'isolation', 'dumbbell', 10, 12, 1, 75),
  ex('dips', 'Dips', 'triceps', 'compound', 'bodyweight', 8, 12, 2.5, 90),
  ex('close-grip-pushup', 'Close-grip push-up', 'triceps', 'compound', 'bodyweight', 8, 12, 0, 75),
  ex('hanging-leg-raise', 'Hanging leg raise', 'core', 'isolation', 'bodyweight', 10, 15, 0, 60),
  ex('incline-db-press', 'Incline DB press', 'chest', 'compound', 'dumbbell', 8, 12, 2, 120),
  ex('incline-bb-press', 'Incline barbell press', 'chest', 'compound', 'barbell', 8, 12, 2.5, 150),
  ex('pull-up', 'Pull-up', 'back', 'compound', 'bodyweight', 5, null, 2.5, 150),
  ex('seated-cable-row', 'Seated cable row', 'back', 'compound', 'cable', 10, 12, 2, 90),
  ex('db-shoulder-press', 'DB shoulder press', 'shoulders', 'compound', 'dumbbell', 8, 12, 2, 120),
  ex('rear-delt-fly', 'Rear-delt fly', 'shoulders', 'isolation', 'dumbbell', 15, 20, 1, 60),
  ex('incline-db-curl', 'Incline DB curl', 'biceps', 'isolation', 'dumbbell', 10, 15, 1, 75),
  ex('overhead-triceps-ext', 'Overhead triceps extension', 'triceps', 'isolation', 'cable', 10, 15, 2, 75),
  ex('romanian-deadlift', 'Romanian deadlift', 'hamstrings', 'compound', 'barbell', 8, 10, 2.5, 150),
  ex('face-pull', 'Face pull', 'shoulders', 'isolation', 'cable', 15, 20, 2, 60),
  ex('cable-crunch', 'Cable crunch', 'core', 'isolation', 'cable', 10, 15, 2, 60),
];

const it = (exerciseId: string, sets: number, repMin: number, repMax: number | null, extra: Partial<ProgramItem> = {}): ProgramItem =>
  ({ exerciseId, sets, repMin, repMax, ...extra });

export const SEED_PROGRAM: ProgramDay[] = [
  {
    id: 'upper-a', name: 'Upper A', weekday: 1, updatedAt: 0,
    items: [
      it('bench-press', 3, 5, 8),
      it('chest-supported-row', 3, 8, 12, { alternatives: ['barbell-row'] }),
      it('overhead-press', 3, 6, 10),
      it('lat-pulldown', 3, 8, 12),
      it('lateral-raise', 3, 12, 20),
      it('preacher-curl', 2, 8, 12),
      it('triceps-pushdown', 2, 10, 15),
    ],
  },
  {
    id: 'legs-arms', name: 'Legs + arms', weekday: 2, updatedAt: 0,
    items: [
      it('leg-extension', 3, 10, 15),
      it('leg-curl', 3, 10, 15),
      it('calf-raise', 3, 12, 20),
      it('lateral-raise', 3, 15, 20),
      it('hammer-curl', 2, 10, 12),
      it('dips', 2, 8, 12, { alternatives: ['close-grip-pushup'] }),
      it('hanging-leg-raise', 3, 10, 15),
    ],
  },
  {
    id: 'upper-b', name: 'Upper B', weekday: 4, updatedAt: 0,
    items: [
      it('incline-db-press', 3, 8, 12, { alternatives: ['incline-bb-press'] }),
      it('pull-up', 3, 5, null),
      it('seated-cable-row', 3, 10, 12),
      it('db-shoulder-press', 2, 8, 12),
      it('lateral-raise', 3, 12, 20),
      it('rear-delt-fly', 2, 15, 20),
      it('incline-db-curl', 2, 10, 15),
      it('overhead-triceps-ext', 2, 10, 15),
    ],
  },
  {
    id: 'legs-shoulders', name: 'Legs + shoulders/core', weekday: 5, updatedAt: 0,
    items: [
      it('leg-extension', 3, 10, 15),
      it('seated-leg-curl', 3, 10, 15),
      it('calf-raise', 3, 12, 20),
      it('romanian-deadlift', 2, 8, 10, { optional: true }),
      it('face-pull', 3, 15, 20, { alternatives: ['rear-delt-fly'] }),
      it('lateral-raise', 3, 15, 20),
      it('cable-crunch', 3, 10, 15),
    ],
  },
];

/** A new person's starting point. The profile screen fills in the rest on first run. */
export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  updatedAt: 0,
  profileDone: false,
  displayName: '',
  sex: 'other',
  heightCm: 175,
  birthYear: 2008,
  goal: 'recomp',
  goalText: '',
  proteinGPerKg: 1.6,
  proteinLocked: false,
  lowSodium: false,
  sodiumCeilingMg: null,
  dietNotes: '',
  programStartDate: null,
  deloadEvery: 6,
  recompWeeks: 12,
  runSchedule: {
    '1': { run: 'easy', note: 'Easy run 4–5 km before 07:00' },
    '2': { run: 'intervals', note: 'Intervals before 07:00' },
    '3': { note: 'Cook day' },
    '4': { run: 'easy', note: 'Easy run 4–5 km before 07:00' },
    '5': {},
    '6': { run: 'benchmark', note: 'Sub-20 4 km benchmark' },
    '7': { run: 'optional-easy', note: 'Optional easy 30–45 min · cook day' },
  },
  aiProvider: 'gemini',
  aiFallback: 'none',
  geminiModel: 'gemini-flash-latest',
  groqModel: 'openai/gpt-oss-120b',
  groqVisionModel: 'qwen/qwen3.8-27b',
  openaiBaseUrl: 'https://openrouter.ai/api/v1',
  openaiModel: '',
  openaiVisionModel: '',
  anthropicModel: 'claude-haiku-5-5',
  ollamaModel: 'llama3.1',
  ollamaUrl: 'http://localhost:11434',
  workerUrl: '',
  foodPreferences: '',
};

/** Stored settings over defaults, so fields added in later versions always have a value. */
export function withDefaults(s: Settings | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

/** The original owner's profile (from the build spec). Applied once to installs that predate profiles. */
export const ORIGINAL_PROFILE: Partial<Settings> = {
  profileDone: true,
  sex: 'male',
  heightCm: 176,
  birthYear: 2009,
  goal: 'recomp',
  goalText: 'Aesthetic, athletic build (broad shoulders, wide lats, upper chest, arms, tight waist) plus strong running fitness. 12-week recomp at maintenance, steered by weight and waist trends. Not bulky.',
  proteinGPerKg: 1.5,
  proteinLocked: true,
  lowSodium: true,
  dietNotes: 'Medical low-sodium diet (kidney condition).',
};

/** Settings saved before profiles existed belong to the original single user: give them that profile. */
export async function migrateLegacySettings() {
  const s = await db.settings.get('settings');
  if (!s || (s as Partial<Settings>).profileDone !== undefined) return;
  // old values (height, sodium ceiling, keys…) win; the new profile fields come from the original profile
  await db.settings.put({ ...DEFAULT_SETTINGS, ...ORIGINAL_PROFILE, ...s, profileDone: true, updatedAt: Date.now() });
}

const N = (kcal: number, protein: number, carbs: number, fat: number, sodiumMg: number): Nutrients => ({ kcal, protein, carbs, fat, sodiumMg });

export const SEED_MEALS: SavedMeal[] = [
  { id: 'meal-huel', name: 'Huel breakfast', slot: 'breakfast', order: 0, updatedAt: 0, nutrients: N(400, 30, 37, 13, 290), description: 'Edit to match your exact serving and the label.' },
  { id: 'meal-school', name: 'School lunch', slot: 'lunch', order: 1, updatedAt: 0, nutrients: N(650, 28, 80, 20, 900), description: 'Estimate. School food is often salty; adjust once you know better.' },
  { id: 'meal-pregym', name: 'Pre-gym snack', slot: 'snack', order: 2, updatedAt: 0, nutrients: N(250, 10, 45, 4, 80), description: 'e.g. banana + rice cakes. Edit to what you actually eat.' },
  { id: 'meal-rahka', name: 'Evening rahka', slot: 'evening', order: 3, updatedAt: 0, nutrients: N(170, 28, 10, 1, 100), description: '250 g maitorahka. Edit per the label.' },
];

const food = (id: string, name: string, per100: Nutrients, extra: Partial<Food> = {}): Food =>
  ({ id: `f-${id}`, name, per100, source: 'fineli', updatedAt: 0, ...extra });

export const SEED_FOODS: Food[] = [
  food('chicken-breast', 'Chicken breast fillet, plain (not marinated), raw', N(105, 23.5, 0, 1.2, 60)),
  food('chicken-thigh', 'Chicken thigh fillet, plain, raw', N(130, 19, 0, 6, 75)),
  food('beef-10', 'Beef mince 10 %, raw', N(170, 20, 0, 10, 70)),
  food('salmon', 'Salmon fillet, raw', N(200, 20, 0, 13, 50)),
  food('egg', 'Egg', N(140, 12.5, 0.5, 10, 140)),
  food('red-lentils', 'Red lentils, dry', N(330, 24, 50, 1.5, 5)),
  food('kidney-beans', 'Kidney beans, canned, no added salt, drained', N(100, 7, 14, 0.5, 10)),
  food('black-beans', 'Black beans, canned, no added salt, drained', N(95, 6.5, 14, 0.5, 10)),
  food('chickpeas', 'Chickpeas, canned, no added salt, drained', N(120, 7, 17, 2.5, 10)),
  food('crushed-tomatoes', 'Crushed tomatoes, canned, no added salt', N(25, 1.2, 4, 0.2, 20)),
  food('tomato-paste', 'Tomato paste, no added salt', N(90, 4.5, 15, 0.5, 60)),
  food('onion', 'Onion', N(35, 1, 7, 0.1, 3)),
  food('garlic', 'Garlic', N(140, 6, 30, 0.5, 15)),
  food('ginger', 'Ginger, fresh', N(80, 1.8, 15, 0.8, 13)),
  food('carrot', 'Carrot', N(35, 0.8, 7, 0.2, 60)),
  food('celery', 'Celery', N(15, 0.7, 2, 0.2, 80)),
  food('bell-pepper', 'Bell pepper', N(30, 1, 5, 0.3, 3)),
  food('zucchini', 'Zucchini', N(17, 1.2, 2.5, 0.3, 8)),
  food('spinach', 'Spinach, frozen', N(25, 3, 1, 0.4, 70)),
  food('broccoli', 'Broccoli', N(35, 3.5, 3, 0.4, 25)),
  food('peas', 'Green peas, frozen', N(75, 5.5, 10, 0.5, 5)),
  food('sweet-potato', 'Sweet potato', N(85, 1.6, 18, 0.1, 50)),
  food('potato', 'Potato', N(75, 2, 16, 0.1, 5)),
  food('rice', 'Basmati rice, dry', N(355, 8, 78, 0.8, 2)),
  food('pasta', 'Wholegrain pasta, dry', N(350, 13, 65, 2.5, 5)),
  food('oats', 'Oat flakes', N(370, 13, 58, 7, 5)),
  food('rapeseed-oil', 'Rapeseed oil', N(900, 0, 0, 100, 0)),
  food('olive-oil', 'Olive oil', N(900, 0, 0, 100, 0)),
  food('coconut-light', 'Coconut milk, light', N(75, 0.8, 2, 7, 15)),
  food('milk', 'Milk 1.5 %', N(45, 3.4, 4.8, 1.5, 40)),
  food('rahka', 'Maitorahka (quark), plain', N(65, 11, 4, 0.2, 40)),
  food('skyr', 'Skyr, plain', N(60, 11, 4, 0.2, 45)),
  food('banana', 'Banana', N(90, 1.1, 20, 0.3, 1)),
  food('berries', 'Mixed berries, frozen', N(40, 0.8, 7, 0.4, 1)),
  food('lemon', 'Lemon juice', N(22, 0.4, 7, 0.2, 1)),
  food('stock-nosalt', 'Vegetable stock, homemade, no salt', N(5, 0.3, 1, 0, 20)),
  food('cumin', 'Cumin, ground', N(375, 18, 44, 22, 170)),
  food('paprika', 'Paprika powder (smoked or sweet)', N(280, 14, 34, 13, 70)),
  food('chili-flakes', 'Chili flakes (pure, no salt)', N(320, 12, 50, 17, 30)),
  food('curry-powder', 'Curry powder, no salt added', N(330, 12, 30, 14, 50)),
  food('garam-masala', 'Garam masala, no salt added', N(380, 15, 45, 15, 100)),
  food('oregano', 'Oregano, dried', N(265, 9, 25, 4, 25)),
  food('basil', 'Basil, dried', N(250, 23, 10, 4, 75)),
  food('thyme', 'Thyme, dried', N(275, 9, 27, 7, 55)),
  food('black-pepper', 'Black pepper', N(250, 10, 38, 3, 20)),
  food('parsley', 'Parsley, fresh', N(36, 3, 6, 0.8, 56)),
];

const F = new Map(SEED_FOODS.map((f) => [f.id.slice(2), f]));
const ing = (key: string, grams: number) => {
  const f = F.get(key);
  if (!f) throw new Error(`seed: unknown food ${key}`);
  return { name: f.name, grams, per100: f.per100, foodId: f.id };
};

export const SEED_RECIPES: Recipe[] = [
  {
    id: 'r-chili', name: 'Chicken & bean chili with rice', servings: 6, freezerFriendly: true, source: 'seed', updatedAt: 0, tags: ['freezer', 'high-protein'],
    ingredients: [
      ing('chicken-breast', 900), ing('kidney-beans', 480), ing('black-beans', 240), ing('crushed-tomatoes', 800),
      ing('tomato-paste', 70), ing('onion', 200), ing('garlic', 15), ing('bell-pepper', 300), ing('cumin', 8),
      ing('paprika', 8), ing('chili-flakes', 3), ing('oregano', 3), ing('rapeseed-oil', 20), ing('rice', 450),
    ],
    steps: [
      'Dice onion and pepper, mince garlic. Cut chicken into 2 cm cubes.',
      'Heat oil in a large pot, brown the chicken in two batches, set aside.',
      'Soften onion and pepper 5 min, add garlic, cumin, paprika, chili and oregano for 1 min.',
      'Add tomato paste, crushed tomatoes, beans and the chicken. Simmer 25 min, lid half on.',
      'Cook the rice. Portion 6 boxes with rice on one side; cool, then freeze. Finish with lime or lemon juice instead of salt.',
    ],
  },
  {
    id: 'r-bolognese', name: 'Beef bolognese (homemade sauce) with wholegrain pasta', servings: 6, freezerFriendly: true, source: 'seed', updatedAt: 0, tags: ['freezer'],
    ingredients: [
      ing('beef-10', 800), ing('onion', 200), ing('carrot', 200), ing('celery', 100), ing('garlic', 15),
      ing('crushed-tomatoes', 800), ing('tomato-paste', 70), ing('oregano', 3), ing('basil', 3), ing('black-pepper', 2),
      ing('olive-oil', 15), ing('pasta', 480),
    ],
    steps: [
      'Finely dice onion, carrot and celery (or grate them).',
      'Brown the mince in the oil in batches, then add the vegetables and cook 8 min.',
      'Add garlic, tomato paste, crushed tomatoes, herbs and pepper. Simmer at least 30 min.',
      'Cook pasta, portion with sauce into 6 boxes and freeze. No stock cube or ready sauce needed: the slow simmer gives the flavour.',
    ],
  },
  {
    id: 'r-curry', name: 'Chicken & red lentil curry with rice', servings: 6, freezerFriendly: true, source: 'seed', updatedAt: 0, tags: ['freezer'],
    ingredients: [
      ing('chicken-thigh', 800), ing('red-lentils', 250), ing('coconut-light', 400), ing('crushed-tomatoes', 400),
      ing('onion', 200), ing('garlic', 15), ing('ginger', 20), ing('curry-powder', 15), ing('garam-masala', 8),
      ing('spinach', 300), ing('rapeseed-oil', 15), ing('rice', 420),
    ],
    steps: [
      'Soften the onion in oil 6 min. Add garlic, ginger, curry powder and garam masala for 1 min.',
      'Add the chicken (bite-size), rinsed lentils, tomatoes, coconut milk and 400 ml water. Simmer 25 min, stirring.',
      'Stir in the spinach for the last 5 min. Finish with lemon juice.',
      'Serve with rice. Portion and freeze 6 boxes.',
    ],
  },
  {
    id: 'r-meatballs', name: 'Baked no-salt meatballs in tomato sauce with potatoes', servings: 6, freezerFriendly: true, source: 'seed', updatedAt: 0, tags: ['freezer'],
    ingredients: [
      ing('beef-10', 900), ing('egg', 55), ing('oats', 60), ing('onion', 150), ing('garlic', 10), ing('black-pepper', 2),
      ing('oregano', 2), ing('crushed-tomatoes', 800), ing('tomato-paste', 50), ing('basil', 2), ing('olive-oil', 10),
      ing('potato', 1200),
    ],
    steps: [
      'Oven 220 °C. Grate the onion, mix with mince, egg, oats, garlic, pepper and oregano. No breadcrumbs (bread is high in sodium).',
      'Roll ~30 balls, bake on a lined tray 15 min.',
      'Simmer tomatoes, paste, basil and oil 10 min, add the meatballs and simmer 10 min more.',
      'Boil the potatoes. Portion 6 boxes and freeze.',
    ],
  },
  {
    id: 'r-shepherds', name: "Shepherd's pie with lentils", servings: 6, freezerFriendly: true, source: 'seed', updatedAt: 0, tags: ['freezer'],
    ingredients: [
      ing('beef-10', 600), ing('red-lentils', 200), ing('onion', 200), ing('carrot', 250), ing('peas', 200),
      ing('tomato-paste', 60), ing('stock-nosalt', 500), ing('thyme', 3), ing('black-pepper', 2), ing('rapeseed-oil', 10),
      ing('potato', 1400), ing('milk', 150),
    ],
    steps: [
      'Brown mince in the oil, add diced onion and carrot for 6 min.',
      'Add lentils, tomato paste, thyme, pepper and no-salt stock. Simmer 20 min until lentils are soft, then stir in peas.',
      'Boil potatoes, mash with warm milk.',
      'Spread filling in a dish, top with mash, bake 200 °C for 25 min. Cut into 6 and freeze.',
    ],
  },
  {
    id: 'r-tray', name: 'Oven tray salmon + vegetables', servings: 3, freezerFriendly: false, fridgeDays: 3, source: 'seed', updatedAt: 0, tags: ['fridge'],
    ingredients: [
      ing('salmon', 450), ing('sweet-potato', 600), ing('broccoli', 400), ing('bell-pepper', 200), ing('olive-oil', 20),
      ing('lemon', 30), ing('paprika', 4), ing('garlic', 10), ing('black-pepper', 2),
    ],
    steps: [
      'Oven 210 °C. Cube the sweet potato, toss with half the oil and paprika, roast 15 min.',
      'Add broccoli and pepper with the rest of the oil and garlic, then the salmon pieces on top.',
      'Roast 12–14 min more. Lemon juice and pepper to finish.',
      'Keep in the fridge, eat within 2–3 days (does not freeze well).',
    ],
  },
];

export async function seedIfEmpty() {
  const existing = await db.settings.get('settings');
  if (existing) return false;
  const now = Date.now();
  const stamp = <T extends { updatedAt: number }>(rows: T[]) => rows.map((r) => ({ ...r, updatedAt: now }));
  await db.transaction('rw', [db.settings, db.exercises, db.programDays, db.savedMeals, db.foods, db.recipes], async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, updatedAt: now });
    await db.exercises.bulkPut(stamp(SEED_EXERCISES));
    await db.programDays.bulkPut(stamp(SEED_PROGRAM));
    await db.savedMeals.bulkPut(stamp(SEED_MEALS));
    await db.foods.bulkPut(stamp(SEED_FOODS));
    await db.recipes.bulkPut(stamp(SEED_RECIPES));
  });
  return true;
}
