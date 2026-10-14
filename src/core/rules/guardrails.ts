// Fixed constraints checked in code, independent of what any LLM says.
// Medical low-sodium diet, fixed 1.5 g/kg protein, no aggressive cutting, no supplement/medication advice.

interface Pattern {
  re: RegExp;
  issue: string;
}

const PATTERNS: Pattern[] = [
  { re: /pansuola|potassium chloride|kaliumkloridi|salt substitute|suolankorvike|lo-?salt|nosalt\b|low[- ]sodium salt|mineral salt|mineraalisuola/i, issue: 'Mentions a salt substitute (potassium chloride). Not allowed on your diet.' },
  { re: /(add|more|extra|increase|pinch of|season(ed)? with|sprinkle)\s+(some\s+)?(sea\s+)?salt|salt to taste|more sodium|increase (your )?sodium|suolaa maun mukaan|lisää suolaa/i, issue: 'Suggests adding salt or sodium.' },
  { re: /\b(skip|skipping|cut out)\b[^.]{0,20}\b(meal|breakfast|lunch|dinner)\b|intermittent fasting|\bomad\b/i, issue: 'Suggests skipping meals.' },
  { re: /(reduce|lower|change|cut|drop)\s+(your\s+)?protein (target|intake|goal)|(?<![\d.])(1\.[0-46-9]|[02-9](\.\d)?)\s*g\s*(\/|per)\s*kg/i, issue: 'Talks about changing the 1.5 g/kg protein target.' },
  { re: /(deficit|cut) of\s*(\d{3,4})\s*kcal|(\d{3,4})\s*kcal\s*(daily\s+)?deficit/i, issue: 'deficit' },
  { re: /\b(creatine|pre-?workout|fat burner|supplement(s|ation)?|whey isolate tablets|melatonin|ashwagandha|caffeine pills?|sarms?|steroids?|medication|ibuprofen|painkiller)\b/i, issue: 'Mentions supplements or medication. The coach does not give that advice.' },
];

/** Returns human-readable issues; empty when the text is clean. */
export function checkText(text: string): string[] {
  const issues = new Set<string>();
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    if (p.issue === 'deficit') {
      const kcal = Number(m[2] ?? m[3]);
      if (kcal > 250) issues.add(`Suggests a ${kcal} kcal deficit (max is 250 kcal/day).`);
      continue;
    }
    issues.add(p.issue);
  }
  return [...issues];
}

/** Ingredient names that are never allowed in a recipe (vs watchlist items, which are just flagged). */
export function forbiddenIngredient(name: string): string | null {
  const n = name.toLowerCase();
  if (/pansuola|potassium chloride|kaliumkloridi|salt substitute|suolankorvike|mineral salt|mineraalisuola/.test(n)) return 'salt substitute';
  if (/^(sea |table |kosher |flaky |)salt$|^suola$|^merisuola$/.test(n.trim())) return 'added salt';
  return null;
}

export const CONSTRAINTS_TEXT = `Fixed, non-negotiable constraints (set by the user's medical plan):
- Low-sodium diet for a kidney condition. Never suggest adding salt, raising sodium, or any salt substitute (potassium chloride, Pansuola, "mineral salt"). Prefer no-salt ingredients and flag high-sodium ones.
- Protein target is fixed at 1.5 g per kg bodyweight. Do not suggest changing it.
- No aggressive cutting: never suggest a deficit larger than 250 kcal/day, never suggest skipping meals or fasting.
- No supplement or medication advice of any kind.
- The deterministic rule outputs are authoritative. Explain them. If you disagree with one, say so explicitly and give the reason; never silently override it.`;
