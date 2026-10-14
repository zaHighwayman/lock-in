// The four AI jobs: food photo estimate, recipe generation, weekly report, chat.
import { z } from 'zod';
import type { Food, Nutrients, Profile, Recipe, RecipeIngredient } from '../core/model';
import { age, checkText, constraintsText, forbiddenIngredient } from '../core/rules/guardrails';
import { parseJson, type ImagePart, type LlmMessage, type LlmProvider } from './provider';

const num = z.coerce.number().finite().nonnegative();
const nutrients = z.object({ kcal: num, protein: num, carbs: num, fat: num, sodiumMg: num });

// ---------- 1. Food photo → macros + portion grams ----------

const FoodEstimate = z.object({
  name: z.string().min(1),
  per100: nutrients,
  grams: num,
  confidence: z.enum(['low', 'medium', 'high']).catch('medium'),
  notes: z.string().catch(''),
});
export type FoodEstimate = z.infer<typeof FoodEstimate>;

export async function estimateFood(
  ai: LlmProvider,
  input: { label?: ImagePart; portion?: ImagePart; text?: string },
): Promise<FoodEstimate> {
  const system = `You read food nutrition labels and estimate portion sizes for a food log.
Return ONLY JSON: {"name": string, "per100": {"kcal","protein","carbs","fat","sodiumMg"}, "grams": number, "confidence": "low"|"medium"|"high", "notes": string}.
Rules:
- per100 is per 100 g (or 100 ml). If the label only shows per serving, convert using the serving size.
- EU labels show "salt" (suola) in grams, not sodium: sodiumMg = salt_g × 400. If the label shows sodium directly, use it.
- grams is the weight of the portion the user will eat. Use the portion photo (compare with plate, cutlery, hand, package size) and/or the user's text. If the user states an amount, use it exactly.
- If there is no label photo, use typical values for that food and set confidence to "low" or "medium".
- notes: one short sentence on how you estimated the portion. Mention high sodium if sodiumMg per 100 g > 400.`;
  const images = [input.label, input.portion].filter((x): x is ImagePart => !!x);
  const parts = [
    input.label ? 'Image 1 is the nutrition label.' : '',
    input.portion ? `Image ${input.label ? 2 : 1} is my portion.` : '',
    input.text ? `My note: ${input.text}` : '',
  ].filter(Boolean);
  const reply = await ai.generate(system, [{ role: 'user', text: parts.join('\n') || 'Estimate this food.', images }], { json: true, temperature: 0.1 });
  return FoodEstimate.parse(parseJson(reply));
}

// ---------- 2. Recipe generation ----------

const GeneratedRecipe = z.object({
  name: z.string().min(1),
  servings: z.coerce.number().int().min(1).max(12),
  freezerFriendly: z.coerce.boolean().catch(true),
  fridgeDays: z.coerce.number().optional().catch(undefined),
  tags: z.array(z.string()).catch([]),
  ingredients: z.array(z.object({ name: z.string().min(1), grams: num, per100: nutrients })).min(1),
  steps: z.array(z.string().min(1)).min(1),
});

export interface RecipeRequest {
  want: string;
  servings: number;
  proteinPerPortionG: number;
  sodiumPerPortionMaxMg: number | null;
  tasteProfile: string;
  pantry: Food[];
  profile: Profile;
  /** when set, adapt this recipe instead of creating one from scratch */
  base?: Recipe;
}

export interface RecipeResult {
  recipe: Omit<Recipe, 'id' | 'updatedAt'>;
  removed: string[];
  issues: string[];
}

function matchPantry(name: string, pantry: Food[]): Food | undefined {
  const n = name.trim().toLowerCase();
  return pantry.find((f) => f.name.toLowerCase() === n) ?? pantry.find((f) => f.name.toLowerCase().split(',')[0] === n.split(',')[0]);
}

export async function generateRecipe(ai: LlmProvider, req: RecipeRequest): Promise<RecipeResult> {
  const p = req.profile;
  const sodiumRules = p.lowSodium
    ? `- No added salt anywhere and no salt substitutes. Never use stock cubes, soy sauce, fish sauce, ready sauces, spice mixes with salt, cheese, cold cuts, tortillas or bread. Build flavour with onion, garlic, ginger, acid (lemon, lime, vinegar), herbs, pure spices, chili, tomato paste, slow cooking and browning.
- Canned beans/tomatoes must be the "no added salt" kind.
${req.sodiumPerPortionMaxMg ? `- Sodium per portion must stay under ${req.sodiumPerPortionMaxMg} mg.` : '- Keep sodium per portion as low as practical (aim under 400 mg).'}`
    : '- Season normally but keep sodium moderate (aim under ~800 mg per portion).';
  const system = `You are a meal-prep recipe developer for a ${age(p.birthYear)}-year-old who trains (goal: ${p.goal}), cooking in Finland.
${constraintsText(p)}
Recipe rules:
${sodiumRules}
- Each portion: about ${req.proteinPerPortionG} g protein, a carb source included (rice, potato, pasta, lentils), realistic Finnish supermarket ingredients (K-Market, Prisma, Lidl).
- Prefer freezer-friendly batch dinners unless asked otherwise.
- Ingredient amounts in grams (liquids: ml counted as grams). per100 = nutrition per 100 g of that ingredient as used (raw/dry unless stated). Reuse the exact names and values from the pantry list when an ingredient is in it.
- Steps: short, in order, practical.
Learn from the taste profile: repeat what they liked, avoid what they disliked, and apply their past edits by default.
Return ONLY JSON: {"name","servings","freezerFriendly","fridgeDays","tags":[],"ingredients":[{"name","grams","per100":{"kcal","protein","carbs","fat","sodiumMg"}}],"steps":[]}`;

  const pantry = req.pantry.map((f) => `${f.name}: ${f.per100.kcal} kcal, P ${f.per100.protein}, C ${f.per100.carbs}, F ${f.per100.fat}, Na ${f.per100.sodiumMg} mg`).join('\n');
  const base = req.base
    ? `\nAdapt this existing recipe as asked (keep what is not mentioned):\n${JSON.stringify({ name: req.base.name, servings: req.base.servings, ingredients: req.base.ingredients.map((i) => ({ name: i.name, grams: i.grams })), steps: req.base.steps })}`
    : '';
  const user = `What I want: ${req.want || 'a new high-protein freezer dinner'}
Servings: ${req.servings}
${base}

Taste profile:
${req.tasteProfile}

Pantry (per 100 g):
${pantry}`;

  const reply = await ai.generate(system, [{ role: 'user', text: user }], { json: true, temperature: 0.8 });
  const g = GeneratedRecipe.parse(parseJson(reply));

  const removed: string[] = [];
  const ingredients: RecipeIngredient[] = [];
  for (const i of g.ingredients) {
    const bad = forbiddenIngredient(i.name, p.lowSodium);
    if (bad) {
      removed.push(`${i.name} (${bad})`);
      continue;
    }
    const known = matchPantry(i.name, req.pantry);
    ingredients.push(known ? { name: known.name, grams: i.grams, per100: known.per100, foodId: known.id } : { name: i.name, grams: i.grams, per100: i.per100 as Nutrients });
  }
  const issues = checkText([g.name, ...g.steps].join('\n'), p);
  return {
    recipe: {
      name: g.name,
      servings: g.servings,
      freezerFriendly: g.freezerFriendly,
      fridgeDays: g.freezerFriendly ? undefined : g.fridgeDays ?? 3,
      tags: g.tags,
      ingredients,
      steps: g.steps,
      source: 'ai',
      rating: 0,
      prompt: req.want,
    },
    removed,
    issues,
  };
}

// ---------- 3. Weekly report ----------

const GOAL_LABEL = { recomp: 'body recomposition at maintenance calories', 'lean-bulk': 'lean bulk (slow, controlled weight gain)', cut: 'fat loss while keeping muscle' } as const;

export function coachSystem(p: Profile, weightKg: number | null): string {
  const who = [`${age(p.birthYear)}-year-old`, p.sex === 'other' ? 'athlete' : p.sex, `${p.heightCm} cm`, weightKg ? `~${Math.round(weightKg)} kg` : null].filter(Boolean).join(', ');
  return `You are a direct, honest strength-and-conditioning coach for one athlete${p.displayName ? ` named ${p.displayName}` : ''}: ${who}.
Goal: ${GOAL_LABEL[p.goal]}.${p.goalText.trim() ? ` In their words: ${p.goalText.trim()}` : ''}
The training program is the athlete's own. You adjust within the rules; you never write a new program.
${constraintsText(p)}
${p.lowSodium ? 'Do not mention salt substitutes at all, not even to warn against them. ' : ''}Do not mention supplements at all.
Style: plain, specific, numbers over adjectives, no hype, no emojis. Short.`;
}

export async function weeklyReport(ai: LlmProvider, input: unknown, program: string, profile: Profile, weightKg: number | null): Promise<{ text: string; issues: string[] }> {
  const user = `Here is my week as JSON (rule outputs are in "flags"):
${JSON.stringify(input)}

My program:
${program}

Write the weekly report in Markdown with exactly these sections:
## What went well
## What to fix
## Next week's focus
(1–3 numbered points, each one concrete action)
Max ~180 words total. Reference the actual numbers. If data is missing for an area, say so in one line instead of guessing.`;
  const text = await ai.generate(coachSystem(profile, weightKg), [{ role: 'user', text: user }], { temperature: 0.4 });
  return { text, issues: checkText(text, profile) };
}

// ---------- 4. Ask the coach ----------

export async function askCoach(ai: LlmProvider, history: LlmMessage[], context: string, profile: Profile, weightKg: number | null): Promise<{ text: string; issues: string[] }> {
  const system = `${coachSystem(profile, weightKg)}

Context: the athlete's last 4 weeks (aggregated) and program:
${context}

Answer the question in under ~150 words unless more detail is asked for. Use the data; say when the data doesn't cover something.`;
  const text = await ai.generate(system, history.slice(-12), { temperature: 0.5 });
  return { text, issues: checkText(text, profile) };
}
