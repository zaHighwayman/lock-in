# Lock-In: implementation plan

> **Status (2026-10-14): all five phases built.** Changes from the plan below:
> - **Food logging was expanded on request.** It now has photo-based estimates (label photo + portion photo → per-100 g values and grams), one-tap quick meals, a library, and macro + sodium totals. This replaces the original "no calorie counting" non-goal.
> - **AI recipes learn from feedback.** Likes, dislikes (with reasons), edits (stored as diffs) and free-text preferences build a taste profile that goes into every generation. Forbidden ingredients (salt, salt substitutes) are stripped in code.
> - **AI calls go straight from the device** with the key stored only on that device, instead of through the Worker. So the coach works without deploying the Worker. The weekly report is generated in the app (Coach tab, with a nudge on Sundays) rather than by a server cron.
> - The Worker handles sync and Withings/Oura only. It was tested locally (wrangler dev + D1), including a full app ↔ Worker sync round trip. The Withings and Oura calls are written against their documented APIs but untested without real accounts.

Plan for the spec in the original brief (logger, rules, integrations, meal prep, AI coach). It covers architecture, data model, rule definitions and phases. Each phase ships on its own before the next one starts.

---

## 1. Key decision: GitHub Pages hosts static files only

GitHub Pages serves static files. It cannot run server code, keep secrets or run scheduled jobs. Several parts of the spec need those:

| Need | Why Pages can't do it |
| --- | --- |
| Withings / Oura OAuth | The token exchange needs a **client secret**, which can't ship in a public JS bundle |
| Daily sync, Sunday coach run | Needs cron |
| Gemini / Claude API keys | Can't sit in a public repo or bundle |
| Same data on phone and PC | Needs a shared store somewhere |

**Architecture: local-first PWA on Pages + a small Cloudflare Worker for backend work.**

```
 iPhone / PC browser                        Cloudflare (free tier)
┌──────────────────────────────┐           ┌────────────────────────────────┐
│ PWA (GitHub Pages)           │  HTTPS    │ Worker  (api.<you>.workers.dev)│
│  React UI                    │ ───────▶  │  /sync    push/pull changes    │
│  core/rules (pure TS)        │  bearer   │  /oauth   Withings + Oura      │
│  Dexie → IndexedDB (source   │  token    │  /coach   LLM proxy            │
│   of truth on device)        │ ◀───────  │  Cron: daily sync, Sun report  │
│  Service worker (offline)    │           │  D1 (SQLite) + encrypted tokens│
└──────────────────────────────┘           └────────────────────────────────┘
```

- **Phase 1 needs no Worker at all.** The logger runs entirely on the device, and data stays in IndexedDB.
- **The Worker is added in Phase 2**, together with Withings. D1 is SQLite, which matches the spec's database choice, and Cron Triggers handle the scheduled jobs. Everything here fits the free tier.
- The app writes to IndexedDB first and syncs in the background. Logging a set never waits on the network, so bad gym signal doesn't matter.
- **Single-user auth:** the Worker checks a long random bearer token. You paste it into Settings once on each device. No accounts and no passwords.

### GitHub Pages specifics
- On a free GitHub plan, a Pages site has to come from a **public repo**. That's fine here: the code and seed data (program, recipes) are public, but your logs never touch the repo. Keep `.env*` gitignored from the first commit.
- Deploy with a GitHub Actions workflow (`actions/deploy-pages`) on every push to `main`.
- The site lives at `https://<user>.github.io/lock-in/`. Set Vite `base: '/lock-in/'` and the manifest `start_url`/`scope` to match. Use hash-based routing (`/#/workout`) so reloads never return a 404 on Pages.

### iPhone PWA notes
- Add to Home Screen from Safari, with `display: standalone`, an `apple-touch-icon`, `viewport-fit=cover` and safe-area padding. The app is dark by default anyway.
- Home-screen web apps are exempt from Safari's 7-day storage eviction. On first launch, also call `navigator.storage.persist()`. **Before Phase 2 brings sync, the phone holds the only copy.** Settings will show a "last backup" date and a one-tap JSON export, and will nudge you weekly.
- Rest timer: iOS suspends background JS, so the timer stores the *end timestamp* and computes the remaining time on return. It stays correct after you lock the phone. There's no vibration API on iOS. An audible beep plays while the app is open, and push alerts can come later if they're wanted.

---

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Build | **Vite + React + TypeScript** | Next.js gives nothing on static hosting, while Vite gives a smaller bundle and simpler PWA setup |
| Styling | Tailwind, dark by default | As specified |
| Routing | React Router (hash router) | Works on Pages |
| Local DB | **Dexie** (IndexedDB) | Offline-first, with reactive queries via `useLiveQuery` |
| PWA | `vite-plugin-pwa` (Workbox) | Precaches the app shell and handles updates |
| Charts | uPlot | Small and fast on phones |
| Validation | Zod | CSV import, sync payloads, LLM JSON |
| Tests | Vitest | Rules are pure functions |
| Backend (P2+) | Cloudflare Worker + D1 + Cron Triggers | Free tier, SQLite, scheduled jobs |
| Worker DB access | Drizzle (D1 driver) | Typed schema shared with the client types |

---

## 3. Repo layout

```
lock-in/
  src/
    core/                  # NO React, NO Dexie: pure TS, shared with the Worker
      model.ts             # entity types
      dates.ts             # week math (Mon–Sun, Europe/Helsinki)
      rules/
        lifting.ts         # rules 1–4
        bodycomp.ts        # rules 5–9
        running.ts         # rules 10–13
        recovery.ts        # rules 14–17
        nutrition.ts       # protein estimate, sodium watchlist
        *.test.ts
      coach/
        weekly-input.ts    # builds the compact JSON for the LLM
        guardrails.ts      # system prompt + constraint text
    db/
      schema.ts            # Dexie tables + versioned migrations
      repo/*.ts            # small data-access functions
      sync.ts              # P2: push/pull to the Worker
    seed/
      exercises.ts  program.ts  recipes.ts  ingredients.ts
    import/
      strong.ts  hevy.ts  generic-csv.ts
    features/
      today/  workout/  program-editor/  runs/  body/
      recovery/  meals/  coach/  settings/
    ui/                    # shared components (Stepper, SetRow, Sheet, Chart)
  worker/                  # P2+
    src/index.ts  routes/  integrations/withings.ts  integrations/oura.ts
    llm/{gemini,anthropic}.ts
    wrangler.toml          # secrets via `wrangler secret put`, never committed
  .github/workflows/deploy.yml
  PLAN.md
```

`src/core` imports nothing from the browser or the Worker. The rules run on the phone (live suggestions) and in the Worker (Sunday report) from the same code.

---

## 4. Data model

Every synced table gets `id` (ULID, generated on the client), `updatedAt` and `deletedAt` (soft delete), which makes sync a simple last-write-wins. With one user, conflicts are practically impossible.

```ts
Exercise        { id, name, muscleGroup, kind: 'compound'|'isolation',
                  loadType: 'barbell'|'dumbbell'|'machine'|'cable'|'bodyweight',
                  defaultRepMin, defaultRepMax, increment /* kg */, archived }

ProgramDay      { id, name, weekday /* 1=Mon */, order,
                  items: { exerciseId, sets, repMin, repMax /* null = AMRAP */,
                           optional, alternatives?: exerciseId[] }[] }

ProgramMeta     { startDate, deloadEvery: 6, recompWeeks: 12 }

WorkoutSession  { id, date, programDayId?, startedAt, endedAt, notes, isDeload }
SetLog          { id, sessionId, exerciseId, setNo, weight, reps, rir?, done,
                  plannedWeight?, plannedReps? }   // planned values kept for "hit as planned"

Run             { id, date, type: 'easy'|'intervals'|'benchmark'|'other',
                  distanceKm, durationSec, avgHr?, notes,
                  intervals?: { reps, workSec?, workM?, restSec } }
                  // pace is derived, never stored

BodyMetric      { id, date, weightKg?, waistCm?, bodyFatPct?, source: 'withings'|'manual' }
SleepRecovery   { id, date /* night ending */, sleepMin, bedtime, wakeTime,
                  restingHr, hrv, readiness, source }

Ingredient      { id, name, per100g: { kcal, protein, carbs, fat, sodiumMg },
                  sodiumWatch: boolean, finelId? }
Recipe          { id, name, servings, ingredients: { ingredientId, grams }[],
                  steps: string[], freezerFriendly, fridgeDays? }
                  // per-portion macros derived from ingredients, not hand-typed
MealPrepBatch   { id, recipeId, cookedOn, portionsMade, portionsFrozen,
                  portionsEaten }  // left = made − eaten
DailyIntake     { date, huel, schoolLunch, preGymSnack, dinnerBatchId?, skyr, notes }

CoachReport     { id, weekStart, ruleOutputs /* JSON */, summary, provider, createdAt }
Settings        { singleton: bodyweight source, proteinGPerKg: 1.5 (locked),
                  sodiumCeilingMg, fixedMealProtein: { huel, skyr, schoolLunch, snack },
                  aiProvider, workerUrl, syncToken }
ProgressPhoto   { id, date, blob }   // local only, never synced
```

Weights are stored in kg, distances in km, durations in seconds, and dates as local `YYYY-MM-DD` strings in Europe/Helsinki time.

---

## 5. Coaching rules: precise definitions

These are the definitions I'll implement and test. The spec leaves a few thresholds open, so **the bold numbers are my proposed defaults.** Every one of them is a constant in `core/rules`, easy to change.

### Lifting
1. **Double progression.** Look at the last session of the exercise and its working sets, excluding warm-ups. If *every* set has `reps ≥ repMax` at the same weight, suggest `weight + increment` with reps reset to `repMin`. Otherwise keep the weight, target last reps +1 on the first set that missed the top, and show "+1 rep somewhere".
   - AMRAP exercises (pull-ups): progress on total reps. Once every set reaches **12**, suggest adding load (a belt or dumbbell).
   - Mixed weights within a session use the heaviest weight that was used for every set.
2. **Stall.** Over the last 3 sessions of an exercise, no increase in top weight *and* no increase in total reps at that weight → flag the stall, with the advice order: check sleep and food → hold → swap variation. Sessions in deload weeks are skipped.
3. **Deload.** `weekIndex = floor((today − startDate) / 7) + 1`, and a week where `weekIndex % 6 === 0` is a deload. Pre-fill uses `ceil(sets / 2)` sets at **~90%** of the weight rounded to the increment. Intervals and the benchmark become easy runs.
4. **Pre-fill.** Opening a session creates its SetLogs ahead of time with `plannedWeight/plannedReps` from rule 1. "Hit as planned" copies the planned values and marks the set done.

### Body composition (weekly, Mon–Sun weeks)
5. `avg7(week)` = mean of the logged weights in that week, needing **≥ 4 weigh-ins**. Otherwise the rule reports "not enough data" instead of guessing.
6. `avg7(this week) − avg7(2 weeks ago) < −0.5 kg` → suggest **+1 carb portion at dinner (~+200 kcal)**.
7. Weight change over 4 weeks within **±0.5 kg**, waist change **≤ +0.5 cm** and lifts rising (more progressions than stalls) → "On track, change nothing."
8. Weight change over 4 weeks **> +0.5 kg** and waist change over 4 weeks **> +0.5 cm** → suggest trimming the dinner carb portion slightly (**~−150 kcal**).
9. A hard limit applies to every rule's output: no suggested deficit over 250 kcal/day and never "skip a meal". A test checks every rule's output against this.

### Running
10. Hard runs are intervals plus the benchmark. **Flag at ≥ 3 hard runs in a week** (the plan already has 2). Also report the easy/hard split by time.
11. Interval progression: if the last 2 weeks' interval sessions were completed at the current rep count, suggest +1 rep, capped at 8×400 m or 6×3 min.
12. Benchmark history: "consistent sub-20" = **3 of the last 4** benchmarks under 20:00, after which the target switches to sub-19.
13. Easy-run distance target goes linearly from 4.5 km in week 1 to 5.5–6 km in week 12. Suggest +0.25–0.5 km when the last 2 easy runs felt fine (no recovery flag).

### Recovery (Oura)
14. Baseline = mean and SD of resting HR and HRV over the **previous 14 days, excluding the current day**, with at least 10 days of data required.
15. Recovery is low when, for **3+ consecutive days**, `RHR > mean + max(1·SD, 2 bpm)` or `HRV < mean − 1·SD`. The suggestion is to make the next hard run easy.
16. Sleep flag: weekly mean sleep < 8 h, *or* the SD of bedtimes > 60 min (bedtimes after midnight are handled correctly). The target is lights out at 22:00 and waking at 06:30.
17. Burnout: the share of exercises dropping (lower weight×reps than 2 weeks earlier) is ≥ **30%** for 2 weeks in a row *and* any recovery flag is active → suggest an extra rest day and eating more.

### Fixed constraints (enforced in code, not only in the prompt)
- `proteinGPerKg = 1.5` and the sodium ceiling are set by you. No rule can output a change to them.
- A denylist check runs on every LLM response and rule string: salt, sodium increase, potassium chloride, Pansuola, "salt substitute", supplement or medication advice, skip meals, deficits > 250 kcal. A hit adds a visible warning to the response (the response isn't silently edited).

---

## 6. Phases

### Phase 1: Workout logger, progression rules, program editor, CSV import
**Ships to:** GitHub Pages, with no backend.

1. Scaffold Vite + React + TS + Tailwind + vite-plugin-pwa, the Pages deploy workflow, and dark theme tokens.
2. `core/rules/lifting.ts` with full Vitest coverage (rules 1–4, AMRAP and mixed-weight edge cases).
3. Dexie schema plus seed data (exercises and your 4 program days, Mon/Tue/Thu/Fri).
4. **Today screen:** today's program day and run from the schedule, a deload banner, and a "Start session" button.
5. **Workout logger:**
   - Each exercise card shows the suggestion ("↑ 62.5 kg" / "same weight, +1 rep").
   - Each set row shows the planned weight×reps, with a big **✓** button (one tap) and a tap to adjust (± stepper by the increment, reps ±1, optional RIR).
   - The rest timer starts automatically on ✓ and is based on timestamps.
   - Swap to an alternative exercise, add a set, skip optional exercises.
   - A session in progress survives app kills because it's saved on every tap.
6. **Program editor:** reorder days and exercises, change sets and rep ranges, swap exercises, create exercises and set their increments.
7. **CSV import:** Strong and Hevy parsers plus a generic CSV parser with column mapping, an exercise-name matching screen (map "Bench Press (Barbell)" → Bench press, remembered for next time) and a dry-run preview before writing. *(I'll check the exact column names against a real export file from you.)*
8. **Settings:** JSON/CSV export, JSON import (restore), a "last backup" reminder, and the program start date.

**Done when:** logging a full Upper A session takes about 21 taps (one per set), it works in airplane mode, every lifting rule has passing tests, and a Strong/Hevy export imports cleanly.

### Phase 2: Body metrics, Worker, sync, Withings
1. Worker scaffold: bearer auth, D1 schema (Drizzle), `/sync/push` and `/sync/pull?since=`.
2. Client sync: runs on app open, on regaining connection, and after a session ends. Settings shows the sync status. **After this, PC and phone share the same data.**
3. Withings OAuth (authorize → Worker callback → tokens encrypted with AES-GCM using a key from Worker secrets), refresh handling, a 30-day backfill, and a daily cron. Body fat % is shown with the "unreliable, watch long-term trend only" label.
4. Waist entry (weekly prompt), plus a weight chart with daily dots and a 7-day average line.
5. Rules 5–9 with tests, shown on Today/Body as flags.
6. Progress photo reminder every 4 weeks. Photos stay in IndexedDB only.

### Phase 3: Runs, Oura, recovery
1. Run quick-entry (type, distance, mm:ss) with auto pace, an interval builder and a benchmark chart with a 20:00 line.
2. Oura OAuth via the Worker, plus a daily cron and 30-day backfill. Resting HR, HRV, sleep times and readiness come from the sleep and daily-readiness endpoints. *(Check the current v2 docs first, since Oura has been changing its auth options.)*
3. Rules 10–17 with tests, plus a recovery screen showing baseline bands.
4. Manual entry for sleep and recovery as a fallback.

### Phase 4: Meal prep
1. Ingredient table seeded from **Fineli** open data (CC-BY 4.0; I'll take the ~60 ingredients the recipes need), editable in the app, with a sodium watchlist flag.
2. The 6 seed recipes. Per-portion kcal/protein/carbs/fat/**sodium** is computed from ingredients, and each recipe shows its sodium against your per-meal share of the ceiling.
3. Planner for Sunday and Wednesday: pick 2 recipes and portions, and get a combined shopping list grouped by store section.
4. Freezer inventory, oldest first, marked eaten from the DailyIntake dinner pick.
5. Daily intake checkboxes and an estimated protein bar compared with 1.5 g/kg × the 7-day average weight.

### Phase 5: AI coach
1. `LlmProvider` interface `{ generate(system, messages, { json?: schema }) }` with Gemini, Anthropic (Haiku) and Ollama backends. **Default provider is the Gemini free tier**, and it's the backend built first.
   - **Gemini and Claude run in the Worker.** Keys are stored as Worker secrets, never on the device.
   - **Ollama** is called from the browser on your PC (`localhost:11434`, which needs `OLLAMA_ORIGINS` set). The iPhone can't reach it because of HTTPS and LAN access, so reports made with Ollama are generated on the PC and sync to the phone.
2. `coach/weekly-input.ts` builds aggregated JSON only: weekly averages, PRs, stalls, run summary, weight and waist trend, sleep and recovery means, and the rule flags. It never sends raw daily logs.
3. The Sunday 20:00 cron generates the report, which is stored as a CoachReport.
4. Ask-the-coach chat, with 4 weekly aggregates plus the program as context.
5. A guardrail system prompt plus the code-level denylist check from §5. If the coach disagrees with a rule, it has to say so explicitly.
6. Settings shows a privacy note (the Gemini free tier may use inputs for training).

> **Gemini free tier notes:** the free tier has per-minute and per-day rate limits. One weekly report plus occasional chat stays well under them. The Worker retries on 429 and shows "try again in a minute" in the chat. Free-tier inputs may be used for training, which is why the coach only gets aggregated weekly data. Check the current model names and limits in Google AI Studio when Phase 5 starts.

---

## 7. Open questions (with the default I'll use if you don't answer)

1. **Program start date** for week counting (deloads, the 12-week recomp): *default = the Monday of the first logged session.*
2. **Rest timer lengths:** *default 2:30 for compounds, 1:30 for isolations, editable per exercise.*
3. **Pull-up progression** when you hit 12 reps on every set: add load, or keep going for reps? *default = suggest adding 2.5 kg.*
4. **Fixed meal protein values** (Huel serving, skyr/rahka pot, school lunch estimate): *you'll enter these in Settings.*
5. **Sodium ceiling** in mg/day, as set by your doctor or dietitian: *a required field in Settings, with no default.*
6. **Existing logs:** do you have a Strong/Hevy export? Sending one before Phase 1 step 7 lets me match the parser to the real file.

---

## 8. Next step
Phase 1, step 1: scaffold the repo, set up the Pages deploy workflow and get an empty installable PWA live on your iPhone. That checks the hosting and Add to Home Screen early, before any feature work.
