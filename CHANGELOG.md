# Changelog

All notable changes to Chaa Chaa Thai are documented here.
Each entry references the issue number(s) where the full context lives.

_Last full review: 2026-07-11 (#442). Previous reviews: 2026-07-11 (#441), 2026-07-09 (#385), 2026-07-08 (#347), 2026-07-06 (#213), 2026-07-04 (#97)._

## Early Sprints (Pre-Phase 10) — 2026-07-03 / 2026-07-04

### Core App
- **#1** — Fix React error #310: hooks called after conditional early return
- **#2** — Add logout / switch student to Settings
- **#3** — AI category/POS suggestion for PowerPoint import
- **#4** — Add more parts of speech + fix category combobox dark styling
- **#5** — Migrate AI service from OpenRouter to Google Gemini 2.5 Flash
- **#6** — Multi-provider AI fallback: Gemini → Groq → Cloudflare Workers AI
- **#7** — Sense-specific emoji for split cards + update .env.example
- **#8** — Card exclusion in import preview + switch dictionary to thai-language.com
- **#9** — Server-side AI key proxy: no more manual key entry for teachers

### Bug Fixes
- **#10** — PowerPoint import fails with NO_KEY despite correct server env vars
- **#11** — Imported cards keep PowerPoint slide's original emoji instead of AI-generated
- **#12** — Blank page for teacher when clicking a word card — ReferenceError: emoji is not defined
- **#13** — Practice tab allows re-answering last card after lesson completion
- **#23** — White screen on Study tab — ReferenceError: Cannot access before initialization
- **#25** — Custom teacher categories not showing on Study/Practice/Sunday card tags
- **#32** — Teacher tab blank white page — enabledClassCodes undefined crashes .includes()
- **#33** — get_teacher_code RPC returns 400 — session expired but profile cached in localStorage
- **#34** — Login fails with "User already registered" — account marker desync in shared_kv
- **#35/#36** — Teacher login corrupted by browser autofill — wrap login fields in `<form>`
- **#65/#66** — Reconstruct App.jsx from clean commit — undo df8f9ba regressions
- **#67/#68** — Remove redundant streakPenalty from prioScore (conflicted with SRS)

### UI Enhancements
- **#14** — Remove word review/verification step and Shared/Private visibility selector
- **#15** — Category tag as pastel flag/badge on Study/Practice cards
- **#16** — Increase Thai word font size on card back
- **#17** — More pedagogical Thai font for Pre-A1 / A1 / A2 levels
- **#18** — Level-scaled countdown timer in Practice — auto-mark "don't recall" on timeout
- **#19** — Category filter chips scrollable on desktop + sort by word count
- **#20** — Enlarge category flag on cards + increase Thai word on card back
- **#21** — Thai spelling breakdown (การสะกดคำ) on Study card back for beginners
- **#22** — Crying cat mascot for empty categories
- **#24/#26** — Visual association on card backs — Wikimedia Commons images
- **#27** — Fix การสะกดคำ format + multi-syllable support
- **#28/#29** — Fix card images: less restrictive queries + POS-aware source ordering

### Error Handling
- **#30** — ErrorBoundary + ErrorScreen — no more white pages
- **#31** — Auto-report client-side errors to GitHub Issues via ErrorBoundary

### Teacher Workflow
- **#37/#38** — Classes default to locked (not unlocked) for vocabulary attribution
- **#39/#40** — Group students by level, sort alphabetically on Teacher panel
- **#41** — Release Class Codes to all students of the same level at once
- **#48** — Teacher Home: show word bank, student count & active-streak stats
- **#49** — Teacher Home: remove "Start today's practice" button for teachers
- **#50** — Teacher Home: "Release Classes" button opens Class Codes popup
- **#51** — Teacher Home: "Go to Word Bank" becomes shortcut to Import PPT
- **#53** — Backup word bank: export CSV/JSON (professor)

### Import Fixes
- **#76** — Fuzzy dedupe for word import (catches synonyms with slight translation differences)
- **#77** — PPTX import: individual VOCABULARY slides garble Thai spelling on newer vowel-shorthand decks

---

## Phase 10 — Thai Calligraphy Training

### Completed
- **#46** — Feasibility study
- **#47** — Scope definition & sprint planning
- **#59** — Stroke path dataset for the 44 Thai consonants (`src/data/thaiStrokes.js`). Auto-extracted skeleton from Sarabun as a starting point, then manually reviewed/redrawn for all 44 via a purpose-built canvas authoring tool. Corrected the original assumption of 4 multi-stroke exceptions to 5: ฐ, ญ, ษ, ศ, ส.
- **#60** — `StrokeAnimation` component: SVG playback of guided stroke animation (stroke-dasharray/dashoffset + moving pen-tip dot), smoothing raw points into a natural curve. Multi-stroke consonants animate sub-strokes in sequence. Play/Replay + Normal/Slow speed controls. Exposed via a teacher-only "Preview Calligraphy" entry on Home (same pattern as Preview Gacha/Exercises) so it's testable ahead of #62.

### In Progress
- **#61** — Interactive tracing canvas + $1 Unistroke scoring
- **#62** — Study Mode entry point + calligraphyProgMap + prioritization
- **#63** — Vowels/tone marks + multi-stroke exceptions

---

## Phase 11 — Level Progression & Proficiency Exam

### Completed
- **#42** — Level progression design (parent issue, split into sub-issues)
- **#75** — Persist word level on import (prerequisite)
- **#86** — Level progress bar (Pre-A1 to C2 visual indicator)
- **#88** — Config: total expected ClassCodes per level (teacher setting)
- **#90** — Threshold setting: when student is ready for exam
- **#91** — Progress metric: % words mastered per level (pure logic)
- **#92** — Exam readiness indicator ("Ready for exam" badge)
- **#93** — Level Settings: ClassCodes expected + exam readiness threshold (teacher config)
- **#150** — Level Progress: remove redundant warning, show current/next level at bar ends
- **#183** — Auto-release next ClassCode on day-change after a qualifying streak session (>= 60%)

### Completed (cont'd, 2026-07-08)
- **#43** — Proficiency exam engine
- **#44** — AI-generated feedback (reuses `callAIWithFallback`, the same multi-provider fallback used by word enrichment)
- **#45** — Level advancement & achievements — split into 3 sub-issues, all shipped:
  - **#298** — Core mechanic: `handleLevelPassed` now advances `profile.level` to the next CEFR tier (was
    previously only drawing 2 avatars, since #165), new `LevelUpMoment` celebration, generic "Level Completed"
    achievement
  - **#299** — Pre-A1→A1-specific achievements: "Mr. Smartpants" (pass on 1st attempt) and "ไม่เป็นไรลูก Mai
    Bpen Rai Luuk" (encouragement on a 1st-attempt fail), derived from `examHistory`
  - **#300** — Exam retry gate: after failing an exam, the student must complete 2 consecutive Sunday Tests
    >75% (same level) before the exam unlocks again — derived state via `getExamRetryGate()`, no new persisted
    flag; teacher/power override (`examForced`) always takes priority
- **#304** — Teacher notification on student level-up (follow-up explicitly deferred by #45): new
  `teacher-levelup-feed` shared-KV key, Teacher tab badge + "🎉 Recent level-ups" list

### In Progress
- **#54** — Weekly automated activity report for the teacher — **channel decided: email**, sent by a native
  cron job (Cloudflare Worker Cron Trigger + Resend), independent of agent credits/connection (see comment
  thread on #54). Needs a new `dontRecallCount` incremental field in `progMap` for the "top 10 hardest words"
  section before implementation.

---

## Phase 12 — Speaking Practice (Pronunciation Recognition) ✅ CLOSED

### Feasibility spike (#69) — concluded with a GO decision
- **#78** — Safari (iOS + macOS) support matrix — iPadOS 85.3%, macOS 69.5%
- **#79** — Firefox + Edge + Opera support matrix — Edge 100% confidence, Opera confirmed false-positive
  (interface present, recognition backend not implemented), Firefox unsupported
- **#81** — **Go/No-Go decision: GO.** Tiered support — Chrome/Edge primary, Safari secondary/tertiary,
  Opera/Firefox degraded to text-only. Full matrix and rationale in `docs/stt-test-results.md` and ADR-009.
- **#82** — PWA installed vs browser tab: microphone permission on iOS
- **#83** — Offline impact: pronunciation is server-based on every browser tested, never works offline —
  accepted, core app stays 100% offline-capable regardless
- **#84** — Chrome (Desktop + Android) support matrix — 92-93.5% confidence, 100% match rate

### Implementation
- **#85** — Teacher Home: "Speech Recognition Test" button to access `/stt-test.html`
- **#70** — Design: pronunciation exercise (scoring, UX, integration with Practice/Study)
- **#71** — Core STT engine: SpeechRecognition wrapper + pronunciation scorer
- **#72** — UI: recording/pronunciation exercise in Practice/Study
- **#73** — Graceful degradation for browsers without th-TH STT support
- **#101** — Pronunciation question type folded into the Sunday Test mix engine (Phase 14)
- **#153/#154** — Pronunciation Tool UX: card-flip/result-accumulation fixes, mic-permission-ahead-of-test flow

### Infrastructure (Hotfixes)
- **#94** — Missing comma in lucide-react import (build broken) — fixed in `03c7f18`
- **#95** — getUserMedia explicit call for Opera microphone permission — fixed in `91afb55`
- **#96** — `env` variable name collision in stt-report.js (Wrangler build fail) — fixed in `7e601c1`
- GitHub API 403 on `stt-report.js` submissions — missing `User-Agent` header, fixed in `51335c1` (ADR-012)

### Not pursued
- **#74** — (stretch) Pronunciation progress: weakest sounds + per-sound tracking — left in backlog, not
  blocking; no issue movement since the spike concluded

---

## Phase 13 — Berserk Mode ✅ CLOSED — 2026-07-08

3-tier timed challenge for students with 100+ active words, standalone from SRS/progress (`affectsProgress=false`,
same flag #318 added for the Preview Exercises tool). Delivered as 6 sequential sub-issues, all shipped same day.

- **#55** — Push notification to teacher: Daily Practice completed (30s polling interval) — foundational
  piece reused by #57 below
- **#321** — Word-selection engine + timed session component: `BERSERK_TIERS` (Easy/Medium/Hard —
  20/30/50 words, fixed 12s/8s/5s countdown per card, not level-scaled like regular Practice),
  `buildBerserkPool`/`buildBerserkLesson` (reuses the existing `prioScore` ranking, mutually exclusive
  word pools across tiers via an `excludeIds` list — 20+30+50=100 matches the unlock threshold exactly),
  `isBerserkTierCleared` (100% accuracy gate, no partial credit). `BerserkSession` reuses the real
  `PracticeSession` component/timer as-is
- **#322** — Entry point + tier selection UI: `BERSERK_STARS_KEY` (personal_kv) tracks cleared tiers;
  Easy always playable, Medium/Hard unlock progressively and never re-lock; new CTA on the Daily
  Practice completion screen, gated on 100+ unlocked words
- **#323** — 3-hour cooldown after a failed (non-100%) attempt, per tier — a cleared tier never
  triggers cooldown. Two independent lock reasons per tier (progression vs. cooldown) can apply at once
- **#324** — 4 new achievements ("Going Berserk", "Smart Cat", "Word-aholic", "Khun Phra!" — one per
  tier + a first-attempt one), new `berserk-attempts` counter, wired into the same achievement/coins
  celebration pipeline as every other category
- **#329** — Gets the `PreActivityFlow` (avatar + powers screen) — the last piece of Phase 18 (see below)
- **#265** — Gets the EN→TH Recognition exercise (Phase 17's last sub-issue, see below)
- **#57** — Teacher push notification when a student clears a Berserk tier, reusing #55's real-time
  polling mechanism; required extending `updateSharedStats` with an optional `extra` payload so Berserk's
  standalone state (which never touches `progMap`) can still mirror into shared stats
- **#56** — Weekly report includes Berserk Mode data (see Phase 54 below)

---

## Phase 14 — Sunday Test Engine Expansion ✅ CLOSED

- **#103** — Reestruturar mix engine: spelling e typing promovidos a tipos próprios (esbuild, re-weighting,
  migração de dados históricos)
- **#101** — Sunday Test: pronunciation (STT) question type added to the mix
- **#102** — Sunday Test: match between the Thai word and images
- **#104** — Fixed a token-limit bug where large PowerPoint imports (18+ words in one AI batch) silently
  failed — hardcoded `maxOutputTokens: 2000` was too small. Now calculated dynamically:
  `Math.min(8192, 500 + wordCount * 350)` (ADR-008)

---

## Avatares para Alunos ✅ Implemented (32/32 issues closed)

Full milestone — avatar collection, coins economy, Gacha ticket system, and special powers. See
`docs/avatars-milestone.md` for the complete breakdown and `docs/decisions.md` (ADR-010, ADR-011, ADR-014) for
the architecture/economy decisions.

### Foundation & unlocks
- **#161** — Foundation: `avatar`/`unlockedAvatars` fields, catalog, `grantRandomPrizeAvatar`
- **#162** — Phase 1 unlock criteria (4 achievements → random avatar draw)
- **#163** — Avatar selector in Settings
- **#164** — Header redesign (70x70 avatar + divider)
- **#165** — Level-completion unlock: draws **2** avatars, locks retakes per level
- **#166** — 50-words-mastered unlock: draws 1 avatar
- **#170** — Fix: correct sorteio-pool vs. shop-exclusive classification
- **#172** — +9 new avatars added to the catalog

### Coins & Store
- **#167** — Coins economy (Meowtongs)
- **#168** — Avatar store (buy with coins)
- **#176** — Teacher can gift a Store/Monthly Cat avatar for free (1 per level budget)
- **#212** — Teacher can gift coins directly (same shared-KV/self-claim architecture as #176)

### Gacha & collection UX
- **#177** — Gacha-style unlock draw animation
- **#178** — Collection progress counter ("X/N collected")
- **#179** — Fallback when the draw pool is exhausted
- **#180** — "Collector" achievement for completing the sorteável pool
- **#181** — "Gatinho do Mês" monthly challenge series (Duolingo-badge style)
- **#182** — Coins toast/animation
- **#198** (+ sub-issues #207-#210) — Rare/Epic Gacha tickets, economy rebalance, dedicated Gacha tab —
  see ADR-011 for the full rationale

### Store UI/UX & celebration polish
- **#203** — Teacher's own avatar always shows the current month's Gatinho do Mês
- **#204** — Rarity ring colors on avatar circle + store cards
- **#205/#206** — Store screen redesign (hero + Collection/Shop/Gacha segments)
- **#201/#202** — Celebration sequencing fix + restored coin-shower animation

### Teacher tab
- **#197** (+ sub-issues #211-#212) — Unified 4-button action row (Unlock Exam / Reset Access / Give
  avatar / Give coins)

### Still open
- **#184** — Avatars with special powers — backlog, blocked on 4 open design decisions (owner input needed)

---

### Special powers (#184 + sub-issues) ✅ CLOSED — 2026-07-07/08
- **#184** — Original ask: avatars with special powers (consumable/passive), closed via the sub-issues below
- **#214** — [Poderes 1/3] Power catalog + data model (`POWER_CATALOG`, `AVATAR_POWERS_CONFIG`, simple/special/passive mechanics)
- **#216** — [Poderes 2/3] Teacher screen: assign powers to avatars + edit store price
- **#220** — [Poderes 3/3] Wire power effects into actual gameplay (Practice/Sunday Test)
- **#222** — Avatar detail modal (Collection/Shop) — rarity, stars, abilities, contextual action
- **#223** (+ sub-issues **#227**, **#228**) — Teacher can add new avatars via UI (dynamic catalog data layer +
  manage-cats screen), instead of code-only `AVATAR_CATALOG` edits
- **#224** — Rare+/Epic/Legendary avatars can carry more than one power/ability simultaneously
- **#225** — Repo-wide pass replacing Portuguese UI strings leaking into the end-user interface with English

### PowerBar overhaul + polish (feeds into Phase 18) ✅ CLOSED — 2026-07-07/08
- **#286-289** — PowerBar cleanup: readable power names, safe on-tap tooltip (`PowerInfoTip`), activity-relevant
  filtering (`appliesTo`), equipped-avatar image shown alongside the chips; time-window powers renamed with
  descriptive names + "night" window reactivated
- **#291** — All 14 powers renamed with an emoji + creative name (PT/EN/TH), no mechanic changes
- **#293** — PowerBar gained a title ("[Avatar] is helping you:") and a footer link to switch avatars
- **#295** — Removed the dead `sundaytest_countdown_25` power (Sunday Test/Exam have no timer, so it never did
  anything); added negative passive "😾Not today" (-25% countdown, Practice); avatars now support 2 simultaneous
  passives (`passive`+`passive2`)

---

## Phase 16 — Economia de Achievements & Challenges ✅ CLOSED

Full milestone (7/7 issues closed, 2026-07-07). Expands the achievement/challenge system into a proper
reward economy layered on top of the existing coins/Gacha system from the Avatares milestone.

- **#231** — Achievements now pay Meowtongs, scaled by difficulty
- **#232** — Weekly Challenge: +1,000 coin bonus for completing all 3 weekly tasks
- **#233** — Monthly Challenge: +1 Rare Gacha ticket on top of the existing Gatinho do Mês reward
- **#234** — Teacher can override an achievement's reward value (with an automatic difficulty-based suggestion)
- **#235** — Teacher can create custom weekly/monthly challenges from existing criteria, with anti-duplicate
  validation and system-suggested possibilities
- **#236** — "Secret" achievement category — hidden until unlocked
- **#237** — 4 new achievements: Exam Ace, Flawless Exam, Golden Tongue, Phoenix/First Fortune

---

## Phase 17 — EN→TH Recognition Exercise ✅ CLOSED — 2026-07-08

New 5th exercise type — reversed direction from the existing image-match (#102): given the English word,
recognize/select the correct Thai word (multiple choice, type "R"). Delivered across all 4 activities.

- **#261** — Spec: EN→TH recognition exercise design
- **#262** — Sunday Test: integrated into the mix engine
- **#263** — Proficiency Exam: integrated
- **#264** — Practice Mode: integrated (4-option MC), reuses `PRACTICE_RECOGNITION_RATE` — an occasional
  check layered on top of the main drill, only on words already at SRS Mastery, distinct from Sunday
  Test's ~1/7 equal-rotation-of-every-type framing
- **#265** — Berserk Mode: integrated once Berserk Mode itself shipped (#52/Phase 13) — `buildBerserkLesson`
  now assigns exercise types the same way Practice Mode does (Berserk's timed run literally *is*
  `PracticeSession` under the hood, so it inherits Practice's exercise-mix philosophy, not Sunday Test's)

---

## Phase 18 — Tela de Seleção de Avatar e Poderes (pré-atividade) ✅ CLOSED — 2026-07-08

Before any activity (Practice, Sunday Test, Berserk Mode, Exam), the student picks which avatar to bring and
activates its available powers, on two sequential screens, instead of the PowerBar floating loosely on each
activity's home screen. All 4 activities now covered.

- **#286-289, #291, #293, #295** — PowerBar groundwork, see the Avatares section above (same work, feeds directly into this phase)
- **#306** — New `PreActivityFlow` component (avatar picker → powers screen → CTA), wired into Practice Mode and
  Sunday Test; extracted `getActivePowersForActivity()` to avoid duplicating the "does this avatar have anything
  relevant for this activity" logic
- **#307** — `PreActivityFlow` wired into the Proficiency Exam (`activity="exam"`) — no catalog power lists
  `"exam"` in `appliesTo` yet, so the powers screen shows its built-in empty state until one does
- **#329** — `PreActivityFlow` wired into Berserk Mode (`activity="berserk"`), inserted between tier
  selection and the timed run — zero new component code, mirrors the Exam integration exactly. Closes
  #266 and, with it, this phase: all 4 activities now share the same avatar+powers ritual

---

## Phase 54 — Weekly Teacher Report ✅ CLOSED — 2026-07-08

- **#333** — `dontRecallCount` metric on word progress
- **#338** — `masteredAt` + `lastSundayTestDate` tracking
- **#334** — `/api/weekly-report` Cloudflare Function: data aggregation engine
- **#335** — `/api/send-weekly-report` — email delivery via Resend API, verified live in production
- **#336** — `.github/workflows/weekly-report.yml` — cron (Mon 06:00 GMT+7) + `workflow_dispatch`, `WEEKLY_REPORT_SECRET`
- **#342** — Fixed `addedAt` creation dates for 102 words (S1C1-S2C2) in Supabase — prerequisite for accurate
  "new words this week" metric
- **#56** — Berserk Mode weekly stats in the report — required switching `berserkStars` from booleans to
  per-tier timestamps, plus new `berserkAttemptLog`/`berserkAchievementUnlocks` history arrays in `shared_kv`.
  Along the way, found and fixed the same overwrite-without-read bug class as #251/#282 in `updateSharedStats`
  (App.jsx) — now does proper read-modify-write via `storageGetSafe`.

## Coins Ledger & History UIs — 2026-07-08

- **#313** — `coins-ledger:<username>` append-only audit trail in Supabase (`{ delta, reason, balanceAfter, at }`,
  capped at 200 entries) behind every coin credit/debit — safety net for balance reconstruction, not the
  source of truth
- **#346** ✅ CLOSED — "Transactions" tab in the Shop, exposing the #313 ledger to students: grouped by day
  (Today/Yesterday/date), newest first, colored +/- delta, resulting balance. Lazy-loaded on tab open. Shipped
  against the existing 200-entry cap as-is (revisit separately if it turns out too short in practice).
- **#347** ✅ CLOSED — Gacha "Wish History" + pity system:
  - `gacha-pull-history` (personal_kv, append-only, capped 100) — one entry per ticket opened (jackpot or not),
    consumed by a new "📜 Wish History" modal on the Gacha tab (grouped by day, same list pattern as #346)
  - `gacha-pity` (personal_kv, `{ rare, epic }`) — consecutive opens without that ticket's top-tier jackpot,
    reset on hit. Soft-pity climbs the jackpot odds starting at roll 6 (Rare) / 5 (Epic); hard-pity guarantees
    it at roll 10 (Rare) / 8 (Epic) — deliberately much shorter than a real-money gacha's pity, since the
    realistic max income (~670 Meowtongs/week) means a student could only ever afford a handful of tickets a
    year; a Genshin-scale 74-90 roll pity would never actually be reached
  - The existing "odds for this roll" display (permanent probability-transparency rule) now reflects the
    pity-boosted table live, plus a "✨ Pity boost active" hint once soft-pity kicks in — so the odds shown
    are never stale once pity starts influencing the roll

## Phase 19 — Gacha Special Banners ("Solstice Ticket") ✅ SHIPPED — 2026-07-09 — see #351

Rotating "catch-up" banner re-featuring a past Gatinho do Mês (M-2, see below) alongside 2 featured Rare
avatars, timed around "magic dates" (dd/mm where day=month). Launched with the Banner de Agosto
(06/08–10/08/2026). Reuses #347's pity/history infra as its own fully independent `banner` pity track.

- **#377** — Banner schedule + featured-config foundation (`getActiveBanner`, `setBannerFeaturedRares`/
  `setBannerFeaturedLegendary`), ticket art
- **#378** — Solstice Ticket catalog, inventory + window-gated purchase (only buyable while a banner is active)
- **#379** — Draw engine + persistent `banner` pity track (independent from Rare/Epic)
- **#380** — Convert a stalled (window-closed, unopened) Solstice Ticket into 1 Epic Ticket (700-coin fee) or
  cash back as 1 Rare Ticket + 400 coins — straight inventory/coins swap, no roll, doesn't touch the pity track
- **#381** — Wish History gets a 3rd pity tile for the Solstice track; hard-pity guarantee note shown once the
  banner window closes with pity capped and no jackpot landed (the "already own everything featured" edge case)
- **#386** — M-2 banner rule correction (Aug 2026 features the **June** cat, not July's — owner decision,
  keeps the featured cat from being one that just finished its own monthly challenge at M-1); new
  banner-exclusive Legendary (Meowlin) + 2 new banner Rares (Don Thong, Kila Meowter); new
  `lockedUntilMonthKey` avatar field keeping brand-new banner Rares out of the general Rare/Epic draw pools
  for 2 months after their debut banner closes (teacher gifting stays unaffected); new `ManageBannerModal`
  admin screen — the manual banner-curation UI #351/#377 always specced but hadn't been built until now

### UI polish that shipped alongside (2026-07-09)
- **#391/#392** — Teacher can set a "Locked until" month on custom cats in `ManageCatsModal`; fixed a bug
  where `shopExclusive` + locked cats could show up for purchase before their unlock date
- **#393/#394/#398** — Gacha ticket grid is now a proper 1x3 (Solstice ticket no longer breaks to its own
  row); Solstice banner strip shown above the ticket grid whenever a banner window is active; Shop sorted
  Owned-first, then Rare before Epic, then A-Z
- **#395/#397/#399/#401** — Wish History gets an All/Rare/Epic/Solstice filter; rarity-ring pulse animation
  scoped off inside history/pity tiles; avatar detail images enlarged 75→125px; power-chip description text
  left-aligned
- **#382** — Fixed coins/gacha-ticket balance display getting stuck at 0 on a cold-reload session race
- **#383** — `MonthlyCatDetailModal` now shows rarity tag, abilities + countdown instead of a duplicated
  progress bar
- **#384** — Power-chip ability description now expands inline instead of a clipped floating tooltip
- **#396/#402** — Contrast fixes on the gacha history button and Transactions tab text (was near-unreadable
  on the dark card background)

## Phase 10 — Thai Calligraphy Training (in progress, mobile/tablet only — ADR-018)

- **#46/#47** — Feasibility study + scope/sprint planning
- **#59** — Stroke path dataset for the 44 Thai consonants (`src/data/thaiStrokes.js`), incl. 5 multi-stroke
  exceptions (ญ, ฐ, ศ, ษ, ส)
- **#60** — `StrokeAnimation` component: SVG playback of guided stroke animation, multi-stroke sequencing,
  play/replay + speed controls. Teacher-only "Preview Calligraphy" entry on Home.
- **#61** — `TracingCanvas` component: student draws over the reference glyph with `perfect-freehand`
  (ink rendering) and each sub-stroke is scored against the reference path with a $1 Unistroke Recognizer
  (`src/utils/unistrokeRecognizer.js`) — rotation invariance deliberately disabled so upside-down/mirrored
  strokes fail (ADR-020). Strokes must pass in order before the next one unlocks. Pass/fail visual feedback
  (ink flash, mascots) + a "watch again" nudge after 3 fails on the same stroke. Wired into "Preview
  Calligraphy" via a Watch/Trace toggle for QA ahead of #62's real Study Mode entry point.
- **#62** — Study Mode entry point + `calligraphyProgMap` + prioritization — real students can now reach the
  feature (was preview-only via the teacher tool until this)
- **#357** — Starting-point per-character trace thresholds for the 5 multi-stroke exceptions
- **#358** — New "calligrapher" achievement category (First Strokes / Complete Alphabet)
- **#360/#362** — "Beta Test" badge, scoped to just the Calligraphy lesson (not the whole app — it's the one
  feature still actively in flux)
- **#362** — Removed the misaligned dotted trace guide (hand-authored stroke coordinates don't perfectly
  match the font-rendered glyph outline — no Thai equivalent of KanjiVG exists to source real path data
  from); students now free-draw over the background glyph only, scoring logic unchanged
- **#361** — Fixed a prod crash (`calligraphyProg` referenced but never declared at the App level)
- **#363** — Fixed several Build the Word / Type the Word / Pick the Spelling / Word Bank elements stuck on
  the wrong font instead of the level-appropriate `thaiFont`
- **#366** — Teacher can upload a cat image from their computer in Manage Cats (auto-fills the image URL via
  Supabase Storage), instead of pasting an already-hosted URL only
- **#63** — still pending (vowels/tone marks + remaining stretch goals)

### Related fixes shipped alongside
- **#364** — Fixed a `PowerBar` crash when equipping an avatar with a consumable power (missing
  `assignment` destructure) + minor Gacha UI tweaks
- **#365** — Translated the one remaining leftover Portuguese string found in a full JSX sweep (PreActivityFlow header)

## Teacher QA Tooling — Preview Exercises — 2026-07-08

- **#318/#319** — "Preview Exercises" card on the teacher Home screen (same pattern as "Preview Gacha", #240):
  teacher picks any exercise type + any real word (or "random word") and it renders the EXACT real
  student-facing component for that type, with zero side effects — new `affectsProgress` prop on
  `PracticeSession` (mirroring the one `SundaySession` already had via #43) ensures a preview answer never
  writes to real SRS/streak/mastery data
- **#320** — Dedicated mascot icon for the Preview Exercises card

## UI Infrastructure — ModalOverlay Refactor — 2026-07-09

Root-caused and fixed #400: modals nested under a scrolling/clipped ancestor rendered mispositioned, since
`position: fixed` resolves against the nearest positioned/transformed ancestor, not always the viewport,
depending on the call site.

- **#403** — New shared `<ModalOverlay>` component, `createPortal`'d into `document.body`, with a
  `closeOnBackdrop` boolean prop (covers modals with a custom close condition, e.g. mid-import wizards).
  `DifficultyModal` migrated as the smoke test
- **#400.1** — Migrated the 7 teacher admin/CRUD modals (ReleaseClasses, LevelSettings, AvatarPowers,
  ManageBanner, ManageCats, AchievementRewards, ManageChallenges) — mechanical swap, no behavior change
- **#400.2** — Migrated `AddWordModal` + `ImportPPTModal` (the latter using `closeOnBackdrop` to keep its
  "can't dismiss mid-import" rule intact)

## Navigation Restructure — 2026-07-09

- **#371** — Removed the "Bank" tab from the bottom navbar (both roles). Teacher's Home shortcut still opens
  Word Bank + auto-opens Import PPT as before; students get a relabeled "Let's Study" card instead; Settings
  gained a teacher-only "Go to Word Bank" button as the tab's remaining navbar-free entry point
- **#372** — Removed the "Sunday" tab from the bottom navbar. Replaced with a 3rd conditional button on the
  student Home screen, shown only when `isSunday()` — so the entry point only appears when the test is
  actually available, instead of a tab that's blocked most of the week

## Phase 21 — Lesson Path (in progress) — 2026-07-10/11

- **#417–#424** — Epic Lesson Path foundation + sub-issues LP1-LP7: `LessonPathFeature`, `LessonPathScreen`, `LessonPlayerModal`, `ManageLessonsModal`, lesson data model, section rewards, roster mirroring
- **#431** — `speakText` (TTS) added to Listening and Tip steps in the Lesson Player
- **#432/#433** — `classCode` field sync on the lesson form + S`<n>`C`<n>` format validation in the New Lesson dialog
- **#434** — Contrast fix on `lp-step-card` in dark theme
- **#435** — `speakText` in remaining Lesson Player step types (follow-up to #431)
- **#439** ✅ — Passive abilities were not applied when entering activities from the Lesson Path + 4 UX gaps in the ability panel

---

## Phase 20 — UX/UI de Lançamento Beta (in progress) — 2026-07-10/11

- **#436/#437** — Horizontal/vertical banner orientations for the Gacha tab hero art, with automatic device-based orientation selection (portrait mobile → vertical, landscape/desktop → horizontal); teacher uploads both variants in ManageBannerModal
- **#438** ✅ — Low contrast on every `<select>`/combobox across the app — explicit `color` and `background` via theme CSS variables instead of relying on browser defaults (was white text on white in light theme)
- **#440** ✅ (commit `ab2ee13`) — Gacha discount flag wired from active player powers (`gachaTicketDiscount`) into the Rare/Epic ticket purchase price in the Gacha tab; discounted prices displayed in real time
- **#440** ✅ (commit `3ac36d2`) — `CoinsUnlockMoment` no longer shows the `GachaSuspenseBox` reveal animation for non-Gacha Meowtong events (cashback "tudo owned", achievements, session/LP rewards, coin gifts). Flag `noSuspense: true` added to those coin celebration events; actual Gacha rolls that produce coins keep the animation. See ADR-024.

- **#442** ✅ — Full-screen cinematic Gacha reveal for all rarities (commits `24082ee` → `5b64b8e`):
  - **Suspense uniforme:** todos os tickets abrem identicamente — orbe prata-azulado (`#8899bb`, fora de qualquer paleta de prêmio) + 16 partículas em velocidade base + 3 anéis giratórios de "vento" (arcos de borda CSS, performáticos em mobile). O aluno não sabe o que vai ganhar até o colorStage.
  - **ColorStage revela o valor pelo comportamento:** rare/epic/legendary e coins ≥ 1250 → partículas aceleram (`--fast`, 0.65 s/volta); common/uncommon e coins < 1250 → partículas desaceleram (`--slow` / `--fade`). A cor do orbe transita do neutro para a cor da raridade.
  - **Common/uncommon:** partículas desvanecem durante colorStage enquanto a silhueta desfocada do avatar aparece (`filter: blur(20px) brightness(0.5)`); flash → reveal com estrelas, badge de raridade e habilidades.
  - **Rare/epic/legendary:** partículas rápidas em cor da raridade → flash → reveal com estrelas, badge e habilidades (comportamento anterior mantido e estendido a todas as raras+).
  - **Coins gacha:** orbit dourado, partículas rápidas (≥ 1250) ou lentas (< 1250) → reveal com imagem da moeda, valor e breakdown → coin shower no dismiss.
  - **Cashback / noSuspense:** card compacto sem animação (tickets Epic cujo pool está completo, recompensas de sessão, etc.) — `noSuspense: true` mantido.
  - `CoinsUnlockMoment` refatorado em 2 caminhos (noSuspense → compact; padrão → cinematic). `AvatarUnlockMoment` unificado: todos os avatares usam o cinematic overlay (removida a bifurcação rare/epic/legendary vs compact).

### Needs-spec (Phase 19)
- **#441** — [needs-spec] Versão completa do cinematic Gacha: animação do "desejo sendo feito" antes do reveal, respostas distintas por raridade além da velocidade/cor, SFX dedicados. A versão provisória (#442) já está em produção.

---

## Unassigned to Milestone

### Enhancements
- **#58** — Automatic word bank backup to teacher's Google Drive (see #368-#370 below)
- **#368** — Google Drive OAuth handshake (`drive-oauth-start.js` / `drive-oauth-callback.js`) for automatic
  word-bank backup
- **#369** — Backup engine: word-bank snapshot + upload (`drive-backup.js`, `functions/_lib/googleDrive.js`,
  `functions/_lib/wordBankSnapshot.js`)
- **#370** — Settings UI to connect/disconnect Google Drive backup + weekly GitHub Actions cron
- **#374/#375/#376** — Numeric progress readout added to word-count/mastery cards (`wc-card`/`mc-card`);
  the "Cat of the Month" tile is now always shown in its full color when clickable (was desaturated until
  an unrelated state changed)

### Misc bug fixes & UX polish (#98-#200, no milestone)

**Word Bank / AI Helper**
- **#105** — AI Helper on the edit-word screen: suggest category + part-of-speech
- **#120** — AI Helper: split cards with multiple unrelated meanings
- **#123** — Fix: AI Helper creating words without user interaction
- **#124** — Allow word deletion from the edit-word screen
- **#125** — Reject word creation without a class code
- **#126** — Fix: `ReferenceError: teacherData is not defined` when editing a word
- **#106** — Word Bank pagination (batches of 15/20/25 instead of infinite scroll)
- **#137** — Fix: emojis registered instead of romanization on lesson import

**Text-to-Speech**
- **#107** — TTS button on the card front (Study/Practice)
- **#130** — Fix: TTS voice didn't sound native — see `tts.js` / ADR (Gemini TTS as primary provider)
- **#139** — Configure `GOOGLE_TTS_API_KEY` (secondary TTS fallback, was never actually set)
- **#138** — Show part-of-speech on the card front, under the TTS button

**Practice / Sunday Test crashes & bugs**
- **#128** — Fix: `ReferenceError: SttUnsupportedNotice and PronunciationPractice not defined`
- **#132** — Fix: `ReferenceError: allCategories is not defined` (Practice completion) + Pollinations 429 rate limit
- **#134** — Fix: next word loaded before the flip-back animation completed
- **#136** — Flipped card back-face layout — better visual distribution (was all centered)
- **#146** — Fix: `ReferenceError: allCategories is not defined` — Sunday Test crash on session start
- **#152** — Fix: overlapping items on the left side of Practice Mode (Chrome)
- **#148** — Student wasn't notified / screen didn't refresh when the teacher released a ClassCode

**Mascot icon consistency pass**
- **#140/#142** — Fix Teacher Home "Release Classes" icon (wrong size, 22x22 instead of 68x68)
- **#143** — Speech Recognition Test: microphone icon → gatinho-microfone mascot
- **#144** — Level Settings: gear icon → gatinho-settings mascot
- **#157** — Sunday Test empty state: mailbox icon → surprised gatinho mascot
- **#159** — Header: replace "ช้าช้าไทย" text with the logomark

**Auth / account bugs**
- **#193** — Fix: `handleLogin()` reset level/avatar/unlockedAvatars (and the roster level) on every
  manual re-login — made ClassCodes look revoked
- **#195** — Fix: legacy pre-PIN account stuck in an unrecoverable "already registered, unknown PIN" trap
  (Teacher tab "Reset Access" button, #211's action row)

**General UI bugs**
- **#98** — Fix: Teacher Home `ReferenceError: Cannot access F before initialization` (TDZ bug, white screen)
- **#99** — Fix: white border around the app broke the dark theme
- **#100** — Fix: Teacher Panel "Release S1C1" bulk-release-by-level button did nothing
- **#185** — My Progress: Current/Personal Best/Meowtongs cards didn't fit on one line
- **#187** — Fix: Portuguese strings leaking into the end-user UI (Sunday Test pronunciation + Progress screen)
- **#189** — Hide Monthly Cat Challenge avatars from student Settings until actually obtained
- **#191** — Fix: low-contrast dark text on Teacher tab roster cards
- **#199** — Fix: Study Mode pronunciation panel overlapped nav arrows on mobile
- **#200** — Fix: topbar logo not responsive on narrow phones (squeezed avatar/streak/settings)

**Gacha reveal sound & preview (continued polish, 2026-07-07)**
- **#240** — Teacher-only "Preview Gacha" — test Rare/Epic ticket animations without consuming/crediting anything real
- **#243** — Gacha reveal sound, timing and glow scaled by rarity (avatar + coins)
- **#245** — Replaced synthesized gacha reveal sound with real audio clips (Mixkit magic + wind)
- **#248** — Fixed inaudible gacha start sound + unconvincing synthesized coin sound

**Flashcard back-face layout (Study/Practice, 2026-07-07)**
- **#250** — Fixed English text block stuck to the top with dead space below, on card backs
- **#255** — Fixed 15%/70%/15% ratio (category/content/English) on the card back
- **#257** — Study Mode: image sized to match the text block + 2-column bottom layout (POS/English)
- **#259** — 12px breathing room between image and divider line, mirrored in Practice Mode

**Critical bug fixes (2026-07-07)**
- **#251** — Teacher Panel showed "No students yet" with an empty roster despite students existing — root
  cause was a silent failure in `loadRoster()` masking real fetch errors; refactored to surface errors instead
  of swallowing them
- **#282** — Coins balance could zero out/corrupt when switching browser tabs — root cause: `creditCoins()`
  did `storageGet(...) || 0`, so a silently-failed read (network/session/RLS) would overwrite the real balance
  with just that credit's delta. Same bug class as #251. Fixed by switching to `storageGetSafe` (returns `null`
  instead of a lying default on failure) — see ADR-013-adjacent standing rule documented in memory: **any
  read-modify-write over `personal_kv`/`shared_kv` must use `storageGetSafe`, never `storageGet(...) || fallback`**

**Teacher Home redesign (2026-07-07)**
- **#269** — Reorganized into a compact 5x2 button grid
- **#272** — Top-bar avatar+name now matches the student pattern (without opening the store)
- **#274/#276** — Fixed oversized grid icons — switched from `height: 45%` (fighting aspect-ratio-driven
  height) to a fixed px height
- **#278** — Replaced generic lucide icons in the grid with illustrated mascots

**Layout & mobile polish**
- **#280** — Fixed `tabbar-main` scrolling with the page on screens without a fixed height (Home, Settings,
  Teacher, Word Bank, Study, Store, Progress)
- **#284** — Exercise card (Study/Practice/Berserk/Sunday Test/Proficiency Test) was too cramped on phone screens

**Speech recognition & microphone**
- **#267** — Disabled the pronunciation (STT) button for Opera, Opera GX and Firefox — feature-detection was a
  false positive there (see `isSTTBlockedBrowser()`); forced off via user-agent sniffing regardless of what
  `SpeechRecognition in window` reports
- **#268** — Microphone selection + calibration test: pick a device, get a live input-level meter on that exact
  device, and a "say ชา" recognition test (33% threshold) reusing the existing `listenThai()`/`pronunciationScore()`
  pipeline — see ADR-015 for the Web Speech API device-binding limitation this ran into
