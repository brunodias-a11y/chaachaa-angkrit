# Chá Chá Angkrit (chaachaa-angrueit)

Learn English slowly, one word at a time — a language learning app for Thai students.

Forked from [chaachaathai](https://github.com/brunodias-a11y/chaachaathai) with the direction reversed: Thai students learning English instead of English speakers learning Thai.

## Tech Stack
- **Frontend:** React + Vite, deployed on Cloudflare Pages
- **Backend:** Supabase (Auth + PostgreSQL)
- **Functions:** Cloudflare Pages Functions (TTS, AI enrichment, dictionary, reports)
- **TTS:** Gemini 2.5 Flash / Google Cloud TTS (en-US)
- **STT:** Web Speech API (en-US)

## Architecture
The gamification engine (gacha, coins, tickets, streaks, challenges, avatars, teacher panel) is language-agnostic and carried over from the original app. Language-specific components (TTS, STT, word bank, dictionary, calligraphy) have been swapped to English.

## Setup
```bash
npm install
npm run dev    # local dev
npm run build  # production build
```

Environment variables needed (see `.env.example`):
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`
- `GITHUB_TOKEN` (for automated issue tracking)
