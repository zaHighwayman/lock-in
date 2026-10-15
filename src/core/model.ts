// Entity types shared by the app, the rules and the sync Worker.
// Units: kg, cm, km, seconds, mg (sodium). Dates are local "YYYY-MM-DD".

export type ID = string;

export interface Base {
  id: ID;
  updatedAt: number;
}

export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'core';
export type LoadType = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight';

export interface Exercise extends Base {
  name: string;
  muscleGroup: MuscleGroup;
  kind: 'compound' | 'isolation';
  loadType: LoadType;
  repMin: number;
  /** null = as many clean reps as possible (AMRAP) */
  repMax: number | null;
  increment: number;
  restSec: number;
  archived?: boolean;
}

export interface ProgramItem {
  exerciseId: ID;
  sets: number;
  repMin: number;
  repMax: number | null;
  optional?: boolean;
  alternatives?: ID[];
}

export interface ProgramDay extends Base {
  name: string;
  /** 1 = Monday … 7 = Sunday */
  weekday: number;
  items: ProgramItem[];
}

export interface WorkoutSession extends Base {
  date: string;
  programDayId?: ID;
  name: string;
  startedAt: number;
  endedAt?: number;
  notes?: string;
  isDeload?: boolean;
}

export interface SetLog extends Base {
  sessionId: ID;
  exerciseId: ID;
  date: string;
  /** position of the exercise inside the session */
  order: number;
  setNo: number;
  weight: number;
  reps: number;
  rir?: number;
  done: boolean;
  plannedWeight?: number;
  plannedReps?: number;
}

export type RunType = 'easy' | 'intervals' | 'benchmark' | 'other';

export interface IntervalSpec {
  reps: number;
  workM?: number;
  workSec?: number;
  restSec?: number;
}

export interface Run extends Base {
  date: string;
  type: RunType;
  distanceKm: number;
  durationSec: number;
  avgHr?: number;
  intervals?: IntervalSpec;
  notes?: string;
}

export interface BodyMetric extends Base {
  date: string;
  weightKg?: number;
  waistCm?: number;
  bodyFatPct?: number;
  source: 'withings' | 'manual';
}

export interface SleepRecovery extends Base {
  /** the date you woke up */
  date: string;
  sleepMin?: number;
  /** "HH:MM" local */
  bedtime?: string;
  wakeTime?: string;
  restingHr?: number;
  hrv?: number;
  readiness?: number;
  source: 'oura' | 'manual';
}

export interface Nutrients {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  sodiumMg: number;
}

export interface Food extends Base {
  name: string;
  brand?: string;
  /** values per 100 g (or 100 ml) */
  per100: Nutrients;
  servingG?: number;
  source: 'label' | 'fineli' | 'manual' | 'ai';
  sodiumWatch?: boolean;
}

export type MealSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner' | 'evening';

export interface FoodLogEntry extends Base {
  date: string;
  slot: MealSlot;
  name: string;
  grams?: number;
  nutrients: Nutrients;
  ref?: { kind: 'food' | 'recipe' | 'batch' | 'meal'; id: ID };
  estimated?: boolean;
  /** set on entries that come from outside the app (Cronometer day totals via Apple Health or CSV) */
  source?: 'cronometer';
}

/** Daily activity from Apple Health (via the iPhone Shortcut) or typed in. */
export interface ActivityDay extends Base {
  date: string;
  steps?: number;
  activeKcal?: number;
  distanceKm?: number;
  exerciseMin?: number;
  flights?: number;
  source: 'apple-health' | 'manual';
}

/** One-tap meals ("Huel breakfast", "Evening rahka"). */
export interface SavedMeal extends Base {
  name: string;
  slot: MealSlot;
  nutrients: Nutrients;
  description?: string;
  order: number;
}

export interface RecipeIngredient {
  name: string;
  grams: number;
  per100: Nutrients;
  foodId?: ID;
}

export interface Recipe extends Base {
  name: string;
  servings: number;
  ingredients: RecipeIngredient[];
  steps: string[];
  freezerFriendly: boolean;
  fridgeDays?: number;
  tags?: string[];
  source: 'seed' | 'ai' | 'manual';
  /** 1 = liked, -1 = disliked */
  rating?: 1 | -1 | 0;
  prompt?: string;
  notes?: string;
  archived?: boolean;
}

export interface RecipeFeedback extends Base {
  recipeId: ID;
  recipeName: string;
  date: string;
  kind: 'like' | 'dislike' | 'edit' | 'comment';
  comment?: string;
  /** e.g. "replaced chickpeas 200 g → kidney beans 200 g; servings 4 → 5" */
  detail?: string;
}

export interface MealPrepBatch extends Base {
  recipeId: ID;
  recipeName: string;
  cookedOn: string;
  portionsMade: number;
  portionsFrozen: number;
  portionsEaten: number;
  perPortion: Nutrients;
  storage: 'freezer' | 'fridge';
}

export interface MealPlan extends Base {
  /** cook day "YYYY-MM-DD" (also the id) */
  date: string;
  items: { recipeId: ID; portions: number }[];
  checked?: string[];
}

export type FlagArea = 'lifting' | 'body' | 'running' | 'recovery' | 'nutrition' | 'program';

export interface Flag {
  rule: number;
  area: FlagArea;
  level: 'good' | 'info' | 'warn';
  title: string;
  detail?: string;
  /** suggested daily calorie change, if the rule makes one */
  kcalDelta?: number;
}

export interface CoachReport extends Base {
  weekStart: string;
  flags: Flag[];
  input: unknown;
  summary: string;
  provider: string;
  guardrailIssues?: string[];
}

export interface ChatMessage extends Base {
  role: 'user' | 'coach';
  text: string;
  createdAt: number;
  guardrailIssues?: string[];
}

export interface RunPlanDay {
  run?: RunType | 'optional-easy';
  note?: string;
}

export type Goal = 'recomp' | 'lean-bulk' | 'cut';

export type AiProviderId = 'gemini' | 'groq' | 'openai' | 'anthropic' | 'ollama';

/** The parts of Settings that shape coaching, recipes and guardrails. */
export interface Profile {
  displayName?: string;
  sex: 'male' | 'female' | 'other';
  heightCm: number;
  birthYear: number;
  goal: Goal;
  /** free text: what the person is training for */
  goalText: string;
  proteinGPerKg: number;
  /** medical/fixed target: the coach must never suggest changing it */
  proteinLocked: boolean;
  /** medical low-sodium mode: no added salt, no salt substitutes, sodium watchlist */
  lowSodium: boolean;
  sodiumCeilingMg: number | null;
  /** allergies, foods to avoid, other diet constraints */
  dietNotes: string;
}

export interface Settings extends Base, Profile {
  /** false until the person has filled in their profile */
  profileDone: boolean;
  programStartDate: string | null;
  deloadEvery: number;
  recompWeeks: number;
  runSchedule: Record<string, RunPlanDay>;
  aiProvider: AiProviderId | 'none';
  /** tried when the main provider is busy, rate-limited or failing */
  aiFallback: AiProviderId | 'none';
  groqModel: string;
  groqVisionModel: string;
  /** any OpenAI-compatible API: OpenRouter, Cerebras, Mistral… */
  openaiBaseUrl: string;
  openaiModel: string;
  openaiVisionModel: string;
  geminiModel: string;
  anthropicModel: string;
  ollamaModel: string;
  ollamaUrl: string;
  workerUrl: string;
  /** API keys, encrypted on the device with a key derived from the account password */
  vault?: { v: 1; iv: string; ct: string };
  stepGoal: number;
  /** free-text food likes/dislikes for recipe generation */
  foodPreferences: string;
  lastExportAt?: number;
  lastPhotoAt?: string;
}

export const ZERO: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0, sodiumMg: 0 };
