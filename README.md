# Lock-In

Training log + coach for you and the people you invite. Workouts with automatic progression, runs, body metrics, sleep/recovery, food logging with photo estimates, AI-generated low-sodium recipes that learn from your feedback, meal prep with shopping lists and freezer inventory, and a weekly coach report.

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

Settings (gear icon on Today) and your profile:

- **Profile → Salt limit**: the g/day number from your doctor or dietitian (if you were given sodium in mg, divide by 400).
- **AI coach**: pick a provider and paste its free API key (stored only on the device):
  - **Gemini**: <https://aistudio.google.com/apikey>. Good quality, but the free tier is often busy.
  - **Groq**: <https://console.groq.com/keys>. Very fast, generous free tier, reads food photos with its vision model.
  - **Other**: any OpenAI-compatible API (OpenRouter, Cerebras, Mistral…) via base URL + key.
  - Set a **fallback**: when the main provider is busy or failing, the app retries once and then switches to it. Gemini + Groq fallback is a good free combination.
- **Taste preferences** for recipes.
- **Food → Library → Quick meals**: edit Huel / school lunch / pre-gym snack / rahka to match your real portions and labels.
- Program start date is set automatically on your first workout (Monday of that week); change it under Program.

Ingredient values in the seed table are approximate. Check the ones you use against <https://fineli.fi> and edit them in Food → Library.

**Backups:** until you set up sync, the phone holds the only copy. Settings → *Export full backup* once a week (the Today screen reminds you).

## 3. Accounts, sync, Withings + Oura (Cloudflare Worker, free tier)

The server in `worker/` adds **accounts**: each person signs in with a username and password, their data syncs between their own devices, and nobody else can see it. Sign-up is **invite-only**.

First-time server setup:

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create lock-in        # copy the database_id into wrangler.toml
npm run db:migrate
npx wrangler secret put SYNC_TOKEN    # long random string (openssl rand -hex 32): setup code for the first account
npx wrangler secret put TOKEN_KEY     # another long random string: encrypts Withings/Oura logins
npm run deploy
```

If your GitHub username isn't `zaHighwayman`, change `ALLOWED_ORIGIN` in `worker/wrangler.toml` first.

**Updating the server** after code changes: `npm run db:migrate` (only does anything when there's a new migration), then `npm run deploy`.

**First account (admin):** in the app, Settings → Account → *Sign in or create account*. Enter the server address; the app sees the server has no accounts yet and asks for the setup code (your `SYNC_TOKEN`). Tick *Move the data on this device into this account* so your existing logs come along.

**Inviting someone:** Settings → *Users (admin)* → *Create invite code* → *Copy invite message* and send it. Codes are single-use and expire after 14 days. The new person opens the app link, taps *I already have an account*, switches to *Create account*, and fills in the server address and code. Each person sets up their own profile (goal, protein target, optional low-sodium mode, diet notes) and adds their own free Gemini key.

To skip typing the server address on every device, add a repo variable `SERVER_URL` (GitHub → Settings → Secrets and variables → Actions → Variables) with the Worker URL. The next deploy pre-fills it.

**Privacy:** other users never see each other's data, in the app or on a shared device (each account has its own database on the device). Whoever owns the Cloudflare account can technically read the server database. Sign out with *remove data from this device* on shared computers.

**Withings:** create an app at <https://developer.withings.com/> with callback URL `https://lock-in-api.<your-subdomain>.workers.dev/oauth/withings/callback`, then `npx wrangler secret put WITHINGS_CLIENT_ID` and `WITHINGS_CLIENT_SECRET`.

**Oura:** create an app at <https://cloud.ouraring.com/oauth/applications> with redirect URI `https://lock-in-api.<your-subdomain>.workers.dev/oauth/oura/callback`, then set `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET`.

Each person then taps **Connect Withings** / **Connect Oura** in their own Settings. The first connect backfills 30 days; after that a cron pulls daily for everyone who connected. If a sync errors, the message shows in Settings and everything can still be entered by hand.

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
