# Lock-In

Personal training log + coach. Workouts with automatic progression, runs, body metrics, sleep/recovery, food logging with photo estimates, AI-generated low-sodium recipes that learn from your feedback, meal prep with shopping lists and freezer inventory, and a weekly coach report.

- **Installable app** (PWA) hosted on GitHub Pages. Works offline; data lives on your phone (IndexedDB).
- **Coaching rules are plain code** (`src/core/rules`, 17 rules, unit-tested). The AI only writes summaries, answers questions, reads food labels and writes recipes.
- **Medical constraints are enforced in code**: fixed 1.5 g/kg protein, low-sodium. Salt substitutes and added salt are stripped from AI recipes; coach replies are scanned and flagged.
- **Optional Cloudflare Worker** (`worker/`) for phone ↔ PC sync and daily Withings + Oura pulls.

## 1. Put it on your phone (≈10 min)

1. Create a **public** GitHub repo named `lock-in` and push this folder to it (`main` branch).
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` runs the tests, builds and deploys. When it's green, the app is at `https://<your-username>.github.io/lock-in/`.
4. On the iPhone, open that URL in **Safari → Share → Add to Home Screen**.

Your logs never go into the repo. Only the code and seed data (program, recipes, ingredient table) are public.

## 2. First-time setup in the app

Settings (gear icon on Today):

- **Sodium ceiling**: the mg/day number from your doctor or dietitian.
- **AI coach → Gemini API key**: create one at <https://aistudio.google.com/apikey>. The key is stored only on the device. In Google Cloud Console → Credentials, restrict the key to **HTTP referrers** `https://<your-username>.github.io/*` so it's useless anywhere else.
- **Taste preferences** for recipes.
- **Food → Library → Quick meals**: edit Huel / school lunch / pre-gym snack / rahka to match your real portions and labels.
- Program start date is set automatically on your first workout (Monday of that week); change it under Program.

Ingredient values in the seed table are approximate. Check the ones you use against <https://fineli.fi> and edit them in Food → Library.

**Backups:** until you set up sync, the phone holds the only copy. Settings → *Export full backup* once a week (the Today screen reminds you).

## 3. Optional: sync + Withings + Oura (Cloudflare Worker, free tier)

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create lock-in        # copy the database_id into wrangler.toml
npm run db:init
```

Edit `worker/wrangler.toml`: replace `<you>` in `ALLOWED_ORIGIN` and `PUBLIC_URL`. Then set secrets (each command asks for the value):

```bash
npx wrangler secret put SYNC_TOKEN       # long random string, e.g. from: openssl rand -hex 32
npx wrangler secret put TOKEN_KEY        # another long random string
npm run deploy
```

In the app: Settings → Sync → paste the Worker URL and the same `SYNC_TOKEN`. Do this on the phone and the PC.

**Withings:** create an app at <https://developer.withings.com/> with callback URL `https://lock-in-api.<you>.workers.dev/oauth/withings/callback`, then `npx wrangler secret put WITHINGS_CLIENT_ID` and `WITHINGS_CLIENT_SECRET`.

**Oura:** create an app at <https://cloud.ouraring.com/oauth/applications> with redirect URI `https://lock-in-api.<you>.workers.dev/oauth/oura/callback`, then set `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET`.

Then tap **Connect Withings** / **Connect Oura** in Settings. The first connect backfills 30 days; after that a cron pulls daily. Both providers change their APIs from time to time. If a sync errors, the message is shown in Settings and everything can still be entered by hand.

## 4. Ollama (optional, PC only)

```bash
OLLAMA_ORIGINS=https://<your-username>.github.io ollama serve
```

Pick *Ollama* in Settings on the PC. Food photo scanning needs a vision model (e.g. `llama3.2-vision`). Reports written on the PC sync to the phone.

## Development

```bash
npm install
npm run dev          # http://localhost:5173/lock-in/
npm test             # rule + import + AI-task tests
npm run build
```

Layout:

```
src/core/        pure TypeScript: model, dates, rules (+ tests), weekly aggregation, taste profile
src/ai/          provider interface (Gemini / Claude / Ollama) and the four AI tasks
src/db/          Dexie schema, seed data, write helpers, sync client
src/pages/       screens: Today, Train, Workout, Program, Runs, Food, Recipe, Progress, Coach, Settings, Import
worker/          Cloudflare Worker: sync, OAuth, Withings + Oura
```
