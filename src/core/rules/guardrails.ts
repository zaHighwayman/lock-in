// Constraints checked in code, independent of what any LLM says. Driven by each person's profile:
// low-sodium mode (no salt, no salt substitutes), a locked protein target, a deficit ceiling per goal,
// and for everyone: no skipped meals, no supplement or medication advice.
import type { Goal, Profile } from '../model';

export type GuardProfile = Pick<Profile, 'lowSodium' | 'proteinLocked' | 'proteinGPerKg' | 'goal' | 'dietNotes' | 'birthYear'>;

/** The original single-user setup: medical low-sodium diet, protein fixed at 1.5 g/kg, recomp. */
export const STRICT_PROFILE: GuardProfile = { lowSodium: true, proteinLocked: true, proteinGPerKg: 1.5, goal: 'recomp', dietNotes: '', birthYear: 2009 };

/** Largest daily deficit any rule or the coach may suggest. */
export function maxDeficit(goal: Goal): number {
  return goal === 'cut' ? 500 : 250;
}

const SALT_SUBSTITUTE = /pansuola|potassium chloride|kaliumkloridi|salt substitute|suolankorvike|lo-?salt|nosalt\b|low[- ]sodium salt|mineral salt|mineraalisuola/i;
const ADD_SALT = /(add|more|extra|increase|pinch of|season(ed)? with|sprinkle)\s+(some\s+)?(sea\s+)?salt|salt to taste|more sodium|increase (your )?sodium|suolaa maun mukaan|lisää suolaa/i;
const SKIP_MEALS = /\b(skip|skipping|cut out)\b[^.]{0,20}\b(meal|breakfast|lunch|dinner)\b|intermittent fasting|\bomad\b/i;
const CHANGE_PROTEIN = /(reduce|lower|change|cut|drop|raise|increase)\s+(your\s+)?protein (target|goal)/i;
const PROTEIN_NUMBER = /(?<![\d.])(\d(?:\.\d+)?)\s*g\s*(?:\/|per)\s*kg/gi;
const DEFICIT = /(?:deficit|cut) of\s*(\d{3,4})\s*kcal|(\d{3,4})\s*kcal\s*(?:daily\s+|a day\s+)?deficit/i;
const SUPPLEMENTS = /\b(creatine|pre-?workout|fat burner|supplement(s|ation)?|melatonin|ashwagandha|caffeine pills?|sarms?|steroids?|medication|ibuprofen|painkiller)\b/i;

/** Returns human-readable issues; empty when the text is clean. */
export function checkText(text: string, p: GuardProfile = STRICT_PROFILE): string[] {
  const issues: string[] = [];
  if (p.lowSodium && SALT_SUBSTITUTE.test(text)) issues.push('Mentions a salt substitute (potassium chloride). Not allowed on a low-salt medical diet.');
  if (p.lowSodium && ADD_SALT.test(text)) issues.push('Suggests adding salt.');
  if (SKIP_MEALS.test(text)) issues.push('Suggests skipping meals.');
  if (p.proteinLocked) {
    const other = [...text.matchAll(PROTEIN_NUMBER)].map((m) => Number(m[1])).find((v) => Math.abs(v - p.proteinGPerKg) > 0.05);
    if (CHANGE_PROTEIN.test(text) || other !== undefined) issues.push(`Talks about changing the fixed ${p.proteinGPerKg} g/kg protein target.`);
  }
  const d = text.match(DEFICIT);
  if (d) {
    const kcal = Number(d[1] ?? d[2]);
    const cap = maxDeficit(p.goal);
    if (kcal > cap) issues.push(`Suggests a ${kcal} kcal deficit (max is ${cap} kcal/day).`);
  }
  if (SUPPLEMENTS.test(text)) issues.push('Mentions supplements or medication. The coach does not give that advice.');
  return issues;
}

/** Ingredients never allowed in a recipe for this person (vs watchlist items, which are only flagged). */
export function forbiddenIngredient(name: string, lowSodium = true): string | null {
  if (!lowSodium) return null;
  const n = name.toLowerCase();
  if (SALT_SUBSTITUTE.test(n)) return 'salt substitute';
  if (/^(sea |table |kosher |flaky |)salt$|^suola$|^merisuola$/.test(n.trim())) return 'added salt';
  return null;
}

export function age(birthYear: number, now = new Date()): number {
  return now.getFullYear() - birthYear;
}

export function constraintsText(p: GuardProfile): string {
  const lines = ['Constraints (non-negotiable, set by the athlete):'];
  if (p.lowSodium) {
    lines.push('- Medical low-salt (low-sodium) diet. Never suggest adding salt or raising salt intake, and never suggest any salt substitute. Prefer no-salt ingredients and point out salty ones. Always talk about salt in grams, not sodium in mg.');
  }
  lines.push(
    p.proteinLocked
      ? `- Protein target is fixed at ${p.proteinGPerKg} g per kg bodyweight (medical). Do not suggest changing it.`
      : `- Protein target: ${p.proteinGPerKg} g per kg bodyweight.`,
  );
  lines.push(`- Never suggest a deficit larger than ${maxDeficit(p.goal)} kcal/day. Never suggest skipping meals or fasting.`);
  if (age(p.birthYear) < 18) lines.push('- The athlete is under 18: keep nutrition advice conservative and growth-friendly.');
  lines.push('- No supplement or medication advice of any kind.');
  if (p.dietNotes.trim()) lines.push(`- Diet notes from the athlete (always respect): ${p.dietNotes.trim()}`);
  lines.push('- The deterministic rule outputs are authoritative. Explain them. If you disagree with one, say so explicitly and give the reason; never silently override it.');
  return lines.join('\n');
}

/** Kept for callers/tests that use the original fixed setup. */
export const CONSTRAINTS_TEXT = constraintsText(STRICT_PROFILE);
