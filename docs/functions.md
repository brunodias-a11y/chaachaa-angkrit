# Cloudflare Pages Functions

All server-side functions live in `functions/api/` and are automatically deployed by Cloudflare Pages.

## Functions Overview

| Function | Path | Method | Purpose |
|---|---|---|---|
| `ai-enrich.js` | `/api/ai-enrich` | POST | Server-side AI proxy for word enrichment |
| `thai-dict.js` | `/api/thai-dict` | GET | Thai dictionary lookup proxy |
| `report-error.js` | `/api/report-error` | POST | Auto-report client errors to GitHub Issues |
| `stt-report.js` | `/api/stt-report` | POST | Submit STT test results to GitHub Issues |
| `tts.js` | `/api/tts` | POST | Server-side Text-to-Speech proxy (native Thai voice) |
| `weekly-report.js` | `/api/weekly-report` | POST | Computes weekly teacher-report metrics (#334) |
| `send-weekly-report.js` | `/api/send-weekly-report` | POST | Sends the weekly report email via Resend (#335) |
| `drive-oauth-start.js` | `/api/drive-oauth-start` | GET | Starts the Google Drive OAuth handshake (#368) |
| `drive-oauth-callback.js` | `/api/drive-oauth-callback` | GET | Completes the OAuth handshake, stores the refresh token (#368) |
| `drive-backup.js` | `/api/drive-backup` | POST | Backs up the shared word bank to a teacher's Google Drive (#369) |

---

## ai-enrich.js — `/api/ai-enrich`

Server-side AI proxy that holds provider API keys as server-side environment variables (not exposed to the client bundle). Enables out-of-the-box AI enrichment without teachers manually entering keys.

### Request
```json
{
  "systemPrompt": "string",
  "userMessage": "string"
}
```

### Response
```json
{ "text": "AI response", "provider": "gemini" }
```

### Environment Variables
| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key (primary provider) |
| `GROQ_API_KEY` | Groq console key (1st fallback) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID (2nd fallback) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token (2nd fallback) |

### Fallback Chain
1. **Google Gemini 2.5 Flash** — primary, best Thai support
2. **Groq Llama 3.3 70B** — 1st fallback, OpenAI-compatible
3. **Cloudflare Workers AI** — 2nd fallback, Llama 3.3 70B

If a provider has no key, it is skipped. If a provider fails (quota, network), the next is tried.

### Related Issues
#5, #6, #9

---

## thai-dict.js — `/api/thai-dict`

Server-side proxy for thai-language.com dictionary search. Needed because thai-language.com doesn't send CORS headers, so direct client-side fetch would be blocked.

Used by the PowerPoint import's AI enrichment step as a ground-truth reference before asking the AI to translate/classify/split a word.

### Request
```
GET /api/thai-dict?word=<thai text>
```

### Response
```json
{
  "word": "Thai word",
  "senses": [
    { "pos": "noun", "english": "eye" },
    { "pos": "noun", "english": "maternal grandfather" }
  ]
}
```

### Environment Variables
None required.

### Related Issues
#8

---

## report-error.js — `/api/report-error`

Receives error details from the client-side ErrorBoundary and creates a GitHub issue automatically, so crashes are tracked without manual reporting.

### Request
```json
{
  "message": "Error message",
  "stack": "Error stack trace (sanitized)",
  "componentStack": "React component stack",
  "tab": "Which tab crashed",
  "userId": "User ID (if available)"
}
```

### Response
```json
{ "ok": true, "issueUrl": "https://github.com/..." }
```

### Environment Variables
| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | Fine-grained PAT with Issues: Write on the repo |
| `GITHUB_REPO_OWNER` | Repository owner (e.g., `brunodias-a11y`) |
| `GITHUB_REPO_NAME` | Repository name (e.g., `chaachaathai`) |

### Related Issues
#30, #31

---

## stt-report.js — `/api/stt-report`

Receives STT test results from `/stt-test.html` and posts them as a comment on the specified GitHub issue. Used for the STT feasibility spike to collect cross-browser test data.

### Request
```json
{
  "issueNumber": 78,
  "results": {
    "timestamp": "...",
    "environment": { "browser": "Safari", "os": "macOS", ... },
    "metrics": { "totalDuration": "29.66s", "averageConfidence": "69.5%", ... },
    "results": [ { "transcript": "...", "meta": "..." } ],
    "log": [ "..." ]
  }
}
```

### Response
```json
{ "ok": true, "commentUrl": "https://github.com/.../issues/78#issuecomment-..." }
```

### Environment Variables
Same as `report-error.js`: `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`.

### Related Issues
#69, #78, #79, #82, #84, #96

---

## tts.js — `/api/tts`

Server-side Text-to-Speech proxy so word audio sounds like a native Thai speaker instead of the browser's
default `SpeechSynthesis` voice (issue #130 — old voice didn't sound native; #139 — TTS key was never
configured).

### Request
```json
{ "text": "สวัสดี" }
```

### Response
```json
{ "audio": "data:audio/wav;base64,...", "provider": "gemini" }
```

### Provider chain
1. **Gemini 2.5 Flash TTS** (`gemini-2.5-flash-preview-tts`, voice `Kore`) — primary. Reuses the same
   `GEMINI_API_KEY` already configured for `ai-enrich.js` — no separate Google Cloud project or billing setup.
   Returns raw PCM, which the function wraps in a minimal WAV header before responding (browsers can't play
   raw PCM directly).
2. **Google Cloud TTS Neural2** (`th-TH-Neural2-C`) — optional secondary, only used if `GOOGLE_TTS_API_KEY`
   is also set (kept for backward compatibility).
3. **Browser `SpeechSynthesis`** — last-resort client-side fallback if both server providers fail.

### Environment Variables
| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Same key as `ai-enrich.js` — primary TTS provider |
| `GOOGLE_TTS_API_KEY` | Optional, classic Cloud TTS Neural2 — secondary fallback |

### Related Issues
#107, #130, #139

---

## weekly-report.js — `/api/weekly-report`

Aggregation engine for the weekly teacher report (issue #54, broken into sub-issues
#333/#338/#334/#335/#336). Computes every number for the previous week (Monday..Sunday,
UTC boundaries) and returns JSON — does not send an email (#335) and does not run on a
schedule (#336), on purpose, so each piece is independently testable.

### Request
```
POST /api/weekly-report
Header: X-Report-Secret: <WEEKLY_REPORT_SECRET>
```
(empty body)

### Response
```json
{
  "ok": true,
  "data": {
    "weekStart": "2026-06-29",
    "weekEnd": "2026-07-05",
    "engagement": { "totalStudents": 5, "activeThisWeek": 4 },
    "newlyMasteredCount": 0,
    "topDontRecallWords": [ { "wordId": "...", "thai": "...", "english": "...", "dontRecallCount": 3 } ],
    "alerts": {
      "inactiveSevenPlusDays": ["Mj"],
      "brokenStreaks": [],
      "missedSundayTest": ["Lance", "Aluno", "Mj", "JamesJames", "Rome"]
    },
    "highlights": {
      "highestStreak": { "username": "Lance", "streak": 2 },
      "highestBerserk": { "username": "...", "tiersCleared": 2 }
    },
    "dbHealth": {
      "newWordsThisWeek": 102,
      "thinnestCategories": [ { "category": "numbers", "count": 2 } ]
    }
  }
}
```

### Data sources (all read with the service_role key, bypassing RLS — this is the
first function that needs cross-student data, unlike the other 5 which are stateless)
- `shared_kv` keys `roster:*` — the class roster
- `shared_kv` keys `student-stats:*` — per-student summary (streak, wordsMastered,
  lastActive, `berserkStars` mirror from #57, `lastSundayTestDate` mirror from #338)
- `personal_kv` keys `p:*` (all students at once, filtered by the `username` column) —
  per-word progress, source of `masteredAt` (#338) and `dontRecallCount` (#333)
- `shared_kv` keys `word:*` — the shared word bank, source of `addedAt` (new words this
  week) and `category` (thinnest categories). Private/personal words are intentionally
  excluded — they belong to one student/teacher, not the whole class.

### Known limitation
`brokenStreaks` is an approximation: there's no persisted "streak broke on date X"
event, only the *current* streak count. A student is flagged if they've genuinely
engaged before (`wordsAttempted > 0`) but their streak is 0 right now — useful for a
weekly nudge, not a precise "broke exactly this week" claim.

### Environment Variables
| Variable | Description |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (Supabase dashboard → Settings → API) — bypasses RLS |
| `WEEKLY_REPORT_SECRET` | Any random string; required as the `X-Report-Secret` header so this can't be triggered by anyone who finds the URL |

Also reuses `VITE_SUPABASE_URL` (already configured for the client — Cloudflare exposes
it to Functions too regardless of the `VITE_` prefix).

### Related Issues
#54, #333, #334, #338

---

## send-weekly-report.js — `/api/send-weekly-report`

Issue #335 (sub-issue of #54). Reuses #334's `fetchReportRows`/`computeWeeklyReport`
directly (no HTTP round-trip — same Cloudflare Function bundle), renders a plain HTML
email (v1 scope: readable, not fancy), and sends it via Resend to
`TEACHER_NOTIFICATION_MAIL`. Does not run on a schedule — #336's Cron Trigger will POST
to *this* endpoint (not `/api/weekly-report`) since this is the one that delivers.

### Request
```
POST /api/send-weekly-report
Header: X-Report-Secret: <WEEKLY_REPORT_SECRET>
```
(empty body — same secret as #334)

### Response
```json
{ "ok": true, "emailId": "...", "data": { /* same shape as #334's response */ } }
```

### ⚠️ Resend sandbox domain caveat
`onboarding@resend.dev` (the default `from` if `RESEND_FROM_ADDRESS` isn't set) can
**only** deliver to the email address the Resend account itself was signed up with —
Resend blocks sending to any other recipient from that shared domain (their restriction,
not a bug here). So v1 only works out of the box if `TEACHER_NOTIFICATION_MAIL` matches
the email used to create the Resend account. To send to any address, verify a real
sending domain in the Resend dashboard and set `RESEND_FROM_ADDRESS` (e.g.
`reports@yourdomain.com`) — no code change needed.

### Environment Variables
| Variable | Description |
|---|---|
| `RESEND_API_KEY` | From resend.com/api-keys. Free tier: 3,000 emails/month, 100/day |
| `RESEND_FROM_ADDRESS` | Optional. Defaults to `onboarding@resend.dev` (see caveat above) |

Also reuses `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `WEEKLY_REPORT_SECRET`
(all from #334) and the already-configured `TEACHER_NOTIFICATION_MAIL`.

### Related Issues
#54, #334, #335

---

## drive-oauth-start.js / drive-oauth-callback.js — Google Drive connection (#58 -> #367-#370)

Two-step OAuth handshake so a teacher can connect their own Google Drive account for automatic word-bank
backups. Shared helpers live in `functions/_lib/googleDrive.js` (leading underscore = ignored for Pages
Functions routing, plain importable module).

### Flow
1. Settings screen renders a plain link: `/api/drive-oauth-start?uid=<supabase_uid>&username=<name>`
2. `drive-oauth-start.js` issues a one-time nonce (stored in `shared_kv`, 10 min TTL) and 302-redirects to
   Google's consent screen, requesting the **`drive.file`** scope only (see #367 — deliberately not full
   Drive access, to avoid Google's sensitive-scope app verification process)
3. Teacher approves (or cancels) on Google's screen
4. Google redirects to `drive-oauth-callback.js` with `code` + `state`
5. The callback verifies the nonce (one-time use), exchanges `code` for tokens, and stores the
   `refresh_token` in `personal_kv` under the `driveAuth` key — written via `SUPABASE_SERVICE_ROLE_KEY`
   since the Function has no Supabase session for that teacher (same reasoning as `weekly-report.js`
   reading every student's data in one shot)
6. Browser is redirected back to `APP_BASE_URL/?driveBackup=connected|denied|error` for the Settings
   screen to show a toast

### Why no Buffer
Cloudflare Pages Functions run on `workerd`, not Node.js — no global `Buffer`. The `state` parameter uses a
hand-rolled UTF-8-safe base64url encode/decode (`btoa`/`atob`, same primitives already used by `tts.js` for
PCM audio), not `Buffer.from(...).toString("base64url")`.

### Environment Variables
| Variable | Description |
|---|---|
| `GOOGLE_DRIVE_CLIENT_ID` | OAuth 2.0 Client ID (Web application) — see #367 for Google Cloud Console setup |
| `GOOGLE_DRIVE_CLIENT_SECRET` | OAuth 2.0 Client Secret |
| `GOOGLE_DRIVE_REDIRECT_URI` | Must exactly match the Authorized redirect URI configured in Google Cloud Console |
| `APP_BASE_URL` | Production domain — where the callback redirects the browser back to |
| `SUPABASE_SERVICE_ROLE_KEY` | Shared with `weekly-report.js` — bypasses RLS to write on behalf of the teacher |

### Related Issues
#58, #367, #368 (this). #369 (snapshot generator + upload) and #370 (scheduling + Settings UI) build on
top of this — not implemented yet.

---

## drive-backup.js — `/api/drive-backup` (#58 -> #369)

The actual backup engine, built on top of #368's stored `refresh_token`s. Word-bank fetching lives in
`functions/_lib/wordBankSnapshot.js` (duplicates the `KEYS.sharedIndex`/`KEYS.word`/`WORD_EXPORT_COLUMNS`
constants from `src/App.jsx` rather than importing across the src/functions boundary — same convention as
`weekly-report.js`'s own aggregation). Drive API v3 calls (find/create folder, multipart upload) live in
`functions/_lib/googleDrive.js` alongside the OAuth helpers.

### Scope decision
Backs up the **shared word bank** (`shared_kv`) only — the whole class's vocabulary, which is the actual
asset #58 is protecting — not each teacher's private word-index. A teacher's own private additions are
already covered by the manual export (#53) whenever they're at their own computer.

### Request
```json
{ "uid": "<teacher_supabase_uid>" }
```
or, to back up every connected teacher in one call (what #370's scheduled trigger will call):
```json
{ "all": true }
```
Header: `X-Backup-Secret: <DRIVE_BACKUP_SECRET>`

### What it does per teacher
1. Refresh the stored `refresh_token` for a short-lived `access_token`
2. Find (or create, on first run) a `"Chaa Chaa Thai Backups"` folder in that teacher's Drive — safe to
   search by name because the `drive.file` scope only ever exposes files/folders this app created
3. Upload `wordbank-<today>.json` and `wordbank-<today>.csv` into that folder (simple multipart upload —
   the word bank is small, no need for Google's resumable upload protocol)
4. Stamp `lastBackupAt`/`lastBackupOk`/`lastBackupError` back onto that teacher's `driveAuth` row in
   `personal_kv`

One teacher's failure (expired/revoked grant, network blip) is caught and recorded on their own row —
it does not abort the run for other teachers when called with `{ "all": true }`.

### Response
```json
{ "ok": true, "results": [{ "userId": "...", "ok": true, "wordCount": 214 }] }
```

### Environment Variables
| Variable | Description |
|---|---|
| `DRIVE_BACKUP_SECRET` | Required `X-Backup-Secret` header value — kept separate from `WEEKLY_REPORT_SECRET` on purpose (least privilege) |
| *(plus everything `drive-oauth-*.js` already needs — see above)* | |

### Related Issues
#58, #368 (this depends on it). #370 (scheduling + a "Backup now" / status button in Settings) is next —
not implemented yet; this endpoint already supports being called by a cron via `{ "all": true }`.

---

## Environment Variables Summary

All env vars are set in **Cloudflare Pages → Settings → Environment variables → Production**.

| Variable | Scope | Used by |
|---|---|---|
| `VITE_SUPABASE_URL` | Client | App (Supabase connection) |
| `VITE_SUPABASE_ANON_KEY` | Client | App (Supabase auth) |
| `VITE_USE_SUPABASE` | Client | App (enable Supabase mode) |
| `GEMINI_API_KEY` | Server | `ai-enrich.js` |
| `GROQ_API_KEY` | Server | `ai-enrich.js` |
| `CLOUDFLARE_ACCOUNT_ID` | Server | `ai-enrich.js` |
| `CLOUDFLARE_API_TOKEN` | Server | `ai-enrich.js` |
| `GITHUB_TOKEN` | Server | `report-error.js`, `stt-report.js` |
| `GITHUB_REPO_OWNER` | Server | `report-error.js`, `stt-report.js` |
| `GITHUB_REPO_NAME` | Server | `report-error.js`, `stt-report.js` |
| `GOOGLE_TTS_API_KEY` | Server | `tts.js` (optional secondary provider) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | `weekly-report.js`, `send-weekly-report.js`, `drive-oauth-start.js`, `drive-oauth-callback.js` |
| `WEEKLY_REPORT_SECRET` | Server | `weekly-report.js`, `send-weekly-report.js` |
| `RESEND_API_KEY` | Server | `send-weekly-report.js` |
| `RESEND_FROM_ADDRESS` | Server | `send-weekly-report.js` (optional) |
| `TEACHER_NOTIFICATION_MAIL` | Server | `weekly-report.js` (consumed by #335, already configured) |
| `GOOGLE_DRIVE_CLIENT_ID` | Server | `drive-oauth-start.js`, `drive-oauth-callback.js` |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Server | `drive-oauth-callback.js` |
| `GOOGLE_DRIVE_REDIRECT_URI` | Server | `drive-oauth-start.js`, `drive-oauth-callback.js` |
| `APP_BASE_URL` | Server | `drive-oauth-callback.js` |
| `DRIVE_BACKUP_SECRET` | Server | `drive-backup.js` |

`VITE_` prefixed vars are embedded in the client bundle (visible to users). Non-prefixed vars are server-only — safe for secrets.
