# ช้าช้าไทย — Chaa Chaa Thai

Thai vocabulary learning app. Study, practice, and master Thai words — one sip at a time.

---

## Project status

Private project. The app is used by the owner's Thai language students.
Not licensed for public use, distribution, or modification.

---

## Project structure

```
chaachaathai/
├── public/
│   ├── manifest.json       PWA manifest
│   ├── sw.js               Service worker (offline cache)
│   ├── _redirects          Cloudflare Pages SPA routing
│   └── icons/              App icons (Phase 8 — TBD)
├── src/
│   ├── main.jsx            Vite entry point
│   └── App.jsx             Full app (rename from thai-vocab-phase7.jsx)
├── index.html              PWA HTML shell with iOS meta tags
├── vite.config.js
├── package.json
├── .env.example            → copy to .env.local for local dev
├── CONTRIBUTING.md         Commit conventions, issue rules, labels
├── CHANGELOG.md            Full history of changes by phase
└── docs/
    ├── decisions.md            Architecture Decision Records (ADRs)
    ├── functions.md            Cloudflare Pages Functions reference
    ├── avatars-milestone.md    Avatar/coins/Gacha system design & status
    └── stt-test-results.md     Cross-browser STT feasibility results
```

---

## Documentation

| Document | Description |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Commit conventions, issue rules, labels, and branching |
| [CHANGELOG.md](CHANGELOG.md) | Full history of changes by phase |
| [docs/decisions.md](docs/decisions.md) | Architecture Decision Records (ADRs) |
| [docs/functions.md](docs/functions.md) | Cloudflare Pages Functions reference |
| [docs/avatars-milestone.md](docs/avatars-milestone.md) | Avatar/coins/Gacha system — design & implementation status |
| [docs/stt-test-results.md](docs/stt-test-results.md) | Cross-browser STT (pronunciation) feasibility test results |

---

## Local development

```bash
# Install dependencies
npm install

# Copy env file and fill in values
cp .env.example .env.local

# Start dev server
npm run dev
# → http://localhost:5173
```

---

## Deploy to Cloudflare Pages

### 1 — Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USER/chaachaathai.git
git push -u origin main
```

### 2 — Create Cloudflare Pages project

1. Go to **dash.cloudflare.com** → Workers & Pages → Create application → Pages
2. Connect to GitHub → select `chaachaathai` repository
3. Set build settings:
   - **Framework preset**: None (or Vite)
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/` (leave blank)

### 3 — Set environment variables

In Cloudflare Pages → Settings → Environment variables → **Production**:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://ydsxoavrcrlsjhshscav.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` (your anon key) |
| `VITE_USE_SUPABASE` | `true` |
| `GEMINI_API_KEY` | Google AI Studio key (free, no credit card) |
| `GROQ_API_KEY` | Groq console key (free, no credit card) |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (sidebar) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (Workers AI template) |
| `GITHUB_TOKEN` | Fine-grained PAT with Issues: Write on this repo |
| `GITHUB_REPO_OWNER` | `brunodias-a11y` |
| `GITHUB_REPO_NAME` | `chaachaathai` |
| `GOOGLE_TTS_API_KEY` | Optional — classic Cloud TTS Neural2 fallback (primary TTS reuses `GEMINI_API_KEY`) |

> See [docs/functions.md](docs/functions.md) for which functions use each variable.

### 4 — Connect custom domain

Pages → Custom domains → Set up a custom domain → enter your domain → follow DNS instructions.

Domain is registered via Cloudflare Registrar → DNS is added automatically.

### 5 — Deploy

Click **Save and Deploy**. First build takes ~2 minutes.
Every `git push` to `main` triggers an automatic redeploy.

---

## Supabase setup (if not done)

1. Create project at **supabase.com** → region: Southeast Asia (Singapore)
2. SQL Editor → paste `supabase-schema.sql` → Run
3. SQL Editor → paste `sprint12_teacher_rbac.sql` → Run (adds the real,
   server-enforced teacher role — see comments at the top of that file)
4. Authentication → Providers → Email → make sure **Email** is enabled and
   turn **Confirm email OFF**. Required: student/teacher accounts use a
   `<name>@chaachaathai-app.com` placeholder address (never a real mailbox,
   just needs to not be a reserved TLD like `.local`/`.test`/`.example` —
   Supabase rejects those) — if confirmation is required, nobody will ever
   be able to click the link and login will be stuck forever.
5. Copy Project URL + anon key → add to Cloudflare env vars above

> Notes:
> - The old **Anonymous** provider is no longer used (Sprint 11 — real
>   name + PIN accounts replaced it) and can stay disabled.
> - The teacher access code defaults to `TEACHER2025` after running
>   `sprint12_teacher_rbac.sql` — change it any time from the app's
>   Settings screen (as a teacher).

---

## AI enrichment — Thai-English dictionary cross-reference

When a teacher imports a PowerPoint, each word is sent through the multi-provider
AI fallback chain (`callAIWithFallback` — Gemini → Groq → Cloudflare Workers AI,
see ADR-001, not OpenRouter anymore since ADR-001/#5/#6) to auto-fill category +
part of speech, correct mistranslations, and split genuinely unrelated meanings
into separate flashcards (e.g. ตา = "eye" AND, unrelated, "maternal grandfather").
`maxOutputTokens` is calculated dynamically based on batch size (ADR-008) so
larger imports don't get silently truncated.

To make that more accurate, `functions/api/thai-dict.js` is a small
Cloudflare Pages Function that looks up each word against **NECTEC
Lexitron-2** (via the free, no-API-key [Longdo Dictionary](https://dict.longdo.com)
endpoint) and hands the AI that dictionary's real senses as a reference
before it decides on a translation/category/split. It's a proxy rather than
a direct browser call because Longdo's endpoint doesn't send CORS headers.

This is a nice-to-have, not a hard dependency — if the lookup fails (offline,
rate-limited, or running `npm run dev` locally without `wrangler pages dev`,
so the Function isn't served), enrichment just falls back to the AI reasoning
from the slide's own text alone, same as before. No extra deploy step is
needed on Cloudflare Pages — Pages auto-detects the `/functions` directory.

> Note: Longdo's dictionary is free for this kind of use, but if the app ever
> charges for the import feature specifically, it's worth re-checking Longdo's
> terms for commercial use at scale (see their [API page](https://dict.longdo.com/page/api)).

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 |
| Styling | CSS-in-JS (template literal styles) |
| Database | Supabase (PostgreSQL, Singapore region) — plus a KV layer (`storageGet`/`storageSet`, personal + shared) used for profile, roster, gifts, and the avatar/coins system, no extra migrations needed |
| Auth | Supabase Auth (email/password, name+PIN per student) |
| AI (text) | Multi-provider fallback — Google Gemini 2.5 Flash (primary) → Groq Llama 3.3 70B → Cloudflare Workers AI Llama 3.3 70B (see ADR-001) |
| AI (speech, pronunciation) | Web Speech API, tiered browser support — Chrome/Edge primary, Safari secondary/tertiary, Opera/Firefox degraded to text-only (see ADR-009) |
| AI (text-to-speech) | Gemini 2.5 Flash TTS (primary) → Google Cloud TTS Neural2 (optional) → browser `SpeechSynthesis` (last resort) |
| Hosting | Cloudflare Pages (unlimited bandwidth, global CDN) + Pages Functions for server-side proxies |
| Domain | Cloudflare Registrar |
| PWA | Web App Manifest + Service Worker |

### Feature areas (as of 2026-07-09)
- Vocabulary study/practice/Sunday Test with SRS, spelling, typing, image-matching, pronunciation and
  EN→TH recognition question types (6 exercise types across Study/Practice/Sunday Test/Exam/Berserk Mode)
- Level progression (Pre-A1 → C2) with automatic level-up, level-specific achievements, an exam retry gate,
  a teacher notification feed, and a weekly email report to the teacher (engagement, alerts, highlights,
  DB health) sent by a GitHub Actions cron — Phase 11 fully closed
- Berserk Mode: 3-tier timed challenge (100+ active words required) standalone from SRS progress, with its
  own cooldown, achievements, and pre-activity flow (Phase 13)
- Avatar collection, coins economy (Meowtongs) with a full transaction ledger, Rare/Epic Gacha tickets,
  Monthly Cat challenges, a rotating "Solstice" special banner (Phase 19) with its own independent pity
  track, and special avatar powers (consumable + up to 2 simultaneous passives, filtered by activity) — see
  [docs/avatars-milestone.md](docs/avatars-milestone.md)
- Achievements/challenges economy: Meowtongs rewards scaled by difficulty, weekly/monthly bonus payouts,
  secret achievements, teacher-authored custom challenges (Phase 16)
- Pre-activity flow: pick an avatar and activate its powers before Practice Mode, Sunday Test, the
  Proficiency Exam, or Berserk Mode — all 4 activities covered (Phase 18, fully closed)
- Thai Calligraphy Training (mobile/tablet only, ADR-018): guided stroke animation, interactive tracing
  canvas with $1 Unistroke scoring, its own achievement category (in progress — Phase 10)
- Automatic word-bank backup to the teacher's Google Drive (OAuth handshake + weekly cron)
- Microphone selection + calibration test in Settings, and STT disabled on browsers where it silently doesn't
  work (Opera, Opera GX, Firefox)
- Teacher panel: 5x2 action grid with illustrated mascots, roster, class code release, exam unlock, account
  reset, avatar/coin gifting, a Preview Exercises QA tool, and manual Solstice banner curation
- Auto client-error reporting to GitHub Issues; STT test tooling with direct-to-GitHub result submission
