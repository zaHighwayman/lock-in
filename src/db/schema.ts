// IndexedDB via Dexie. The device copy is the source of truth; sync (if configured) runs in the background.
import Dexie, { type Table } from 'dexie';
import type {
  BodyMetric, ChatMessage, CoachReport, Exercise, Food, FoodLogEntry, MealPlan, MealPrepBatch, ProgramDay,
  Recipe, RecipeFeedback, Run, SavedMeal, SetLog, Settings, SleepRecovery, WorkoutSession,
} from '../core/model';

export interface Tombstone {
  id: string; // `${table}:${recordId}`
  table: SyncedTable;
  recordId: string;
  updatedAt: number;
}

export interface Photo {
  id: string;
  date: string;
  blob: Blob;
}

export interface Meta {
  key: string;
  value: unknown;
}

export interface Alias {
  /** lowercased external exercise name from an import */
  id: string;
  exerciseId: string;
}

export class LockInDB extends Dexie {
  exercises!: Table<Exercise, string>;
  programDays!: Table<ProgramDay, string>;
  sessions!: Table<WorkoutSession, string>;
  sets!: Table<SetLog, string>;
  runs!: Table<Run, string>;
  body!: Table<BodyMetric, string>;
  sleep!: Table<SleepRecovery, string>;
  foods!: Table<Food, string>;
  foodLog!: Table<FoodLogEntry, string>;
  savedMeals!: Table<SavedMeal, string>;
  recipes!: Table<Recipe, string>;
  recipeFeedback!: Table<RecipeFeedback, string>;
  batches!: Table<MealPrepBatch, string>;
  mealPlans!: Table<MealPlan, string>;
  coachReports!: Table<CoachReport, string>;
  chat!: Table<ChatMessage, string>;
  settings!: Table<Settings, string>;
  aliases!: Table<Alias & { updatedAt: number }, string>;
  tombstones!: Table<Tombstone, string>;
  photos!: Table<Photo, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super('lock-in');
    this.version(1).stores({
      exercises: 'id, name, updatedAt',
      programDays: 'id, weekday, updatedAt',
      sessions: 'id, date, programDayId, updatedAt',
      sets: 'id, sessionId, exerciseId, date, updatedAt',
      runs: 'id, date, type, updatedAt',
      body: 'id, date, updatedAt',
      sleep: 'id, date, updatedAt',
      foods: 'id, name, updatedAt',
      foodLog: 'id, date, updatedAt',
      savedMeals: 'id, order, updatedAt',
      recipes: 'id, name, updatedAt',
      recipeFeedback: 'id, recipeId, date, updatedAt',
      batches: 'id, cookedOn, recipeId, updatedAt',
      mealPlans: 'id, date, updatedAt',
      coachReports: 'id, weekStart, updatedAt',
      chat: 'id, createdAt, updatedAt',
      settings: 'id, updatedAt',
      aliases: 'id, updatedAt',
      tombstones: 'id, updatedAt',
      photos: 'id, date',
      meta: 'key',
    });
  }
}

export const db = new LockInDB();

/** Tables that sync to the Worker. Photos and meta (incl. API keys) stay on the device. */
export const SYNCED_TABLES = [
  'exercises', 'programDays', 'sessions', 'sets', 'runs', 'body', 'sleep', 'foods', 'foodLog',
  'savedMeals', 'recipes', 'recipeFeedback', 'batches', 'mealPlans', 'coachReports', 'chat', 'settings', 'aliases',
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export interface TableTypes {
  exercises: Exercise;
  programDays: ProgramDay;
  sessions: WorkoutSession;
  sets: SetLog;
  runs: Run;
  body: BodyMetric;
  sleep: SleepRecovery;
  foods: Food;
  foodLog: FoodLogEntry;
  savedMeals: SavedMeal;
  recipes: Recipe;
  recipeFeedback: RecipeFeedback;
  batches: MealPrepBatch;
  mealPlans: MealPlan;
  coachReports: CoachReport;
  chat: ChatMessage;
  settings: Settings;
  aliases: Alias & { updatedAt: number };
}
