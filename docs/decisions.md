# Architecture Decision Records (ADR)

Key technical decisions, their rationale, and context. This is a living document — add new decisions as they happen.

---

## ADR-001: Multi-provider AI fallback chain (Gemini → Groq → Cloudflare)

**Date:** 2026-07-03
**Issues:** #5, #6, #9

### Decision
Use a 3-provider fallback chain for AI enrichment: Google Gemini 2.5 Flash (primary), Groq Llama 3.3 70B (1st fallback), Cloudflare Workers AI (2nd fallback). API keys are stored server-side in Cloudflare Pages env vars, not exposed to the client.

### Rationale
- Gemini has the best Thai language support among free-tier providers
- Groq provides OpenAI-compatible API with generous free tier
- Cloudflare Workers AI is already integrated (same platform as hosting)
- Server-side keys mean teachers don't need to configure their own — works out of the box
- If one provider is down/quota-limited, the next is tried automatically

### Consequences
- Teachers can still override with personal keys in Settings
- If all providers fail, enrichment falls back to AI reasoning from slide text alone

---

## ADR-002: thai-language.com as dictionary reference (replacing Longdo)

**Date:** 2026-07-03
**Issues:** #8

### Decision
Use thai-language.com as the ground-truth dictionary for AI enrichment, accessed via a server-side Cloudflare Function proxy (`thai-dict.js`).

### Rationale
- thai-language.com provides structured, grouped results with POS and English glosses
- Longdo (previously used) aggregates from multiple sources with inconsistent quality
- Server-side proxy needed because thai-language.com doesn't send CORS headers

### Consequences
- Proxy function (`/api/thai-dict`) adds latency to enrichment but improves accuracy
- If proxy fails, enrichment falls back to AI reasoning without dictionary reference

---

## ADR-003: ErrorBoundary + auto-report to GitHub Issues

**Date:** 2026-07-04
**Issues:** #30, #31

### Decision
Wrap the entire app in a React ErrorBoundary that catches unhandled errors, displays a friendly ErrorScreen, and auto-creates a GitHub Issue with error details via `/api/report-error`.

### Rationale
- Previous behavior: white screen with no indication of what went wrong
- Students (non-technical) cannot report bugs meaningfully
- Auto-reporting ensures every crash is tracked without manual intervention

### Consequences
- GitHub Issues may get noisy with low-signal crashes — acceptable trade-off for visibility
- Stack traces are sanitized but may contain some user context

---

## ADR-004: Level progression model (Pre-A1 through C2)

**Date:** 2026-07-04
**Issues:** #42, #86, #88, #90, #91, #92, #93

### Decision
Implement a level system based on CEFR (Pre-A1, A1, A2, B1, B2, C1, C2). Progress is measured as % of words mastered per level. Teachers configure expected ClassCodes per level and exam readiness threshold. Students see a progress bar and "Ready for exam" badge.

### Rationale
- CEFR is a recognized standard for language proficiency
- Per-level word mastery is a simple, measurable metric
- Teacher-configurable thresholds accommodate different teaching styles
- Visual indicators (progress bar, badge) motivate students

### Consequences
- Word level must be persisted on import (#75) — this was a prerequisite
- Exam readiness is a binary indicator based on threshold, not a continuous score

---

## ADR-005: STT feasibility spike before implementation

**Date:** 2026-07-04
**Issues:** #69, #78, #79, #81, #82, #83, #84

### Decision
Run a full cross-browser feasibility spike before committing to STT implementation. Test Chrome, Safari, Firefox, Edge, and Opera across desktop and mobile. Make a Go/No-Go decision (#81) based on results.

### Rationale
- Web Speech API support varies dramatically across browsers
- Thai (th-TH) language support is not guaranteed on all platforms
- Offline behavior conflicts with PWA promise — needs to be understood before promising it
- Better to know the constraints upfront than to build and discover blockers

### Key findings so far

| Platform | API | Avg Confidence | processLocally | Offline | Verdict |
|---|---|---|---|---|---|
| Chrome Android | `SpeechRecognition` | 93.5% | ✅ | ✅ | GO |
| Safari macOS | `webkitSpeechRecognition` | 69.5% | ❌ | ❌ | GO with caveats |
| Opera | (Chromium-based) | — | — | — | Needs getUserMedia fix, retest |

### Consequences
- Safari uses `webkitSpeechRecognition` (prefixed) — wrapper must handle both
- Safari has ~30s timeout — long sessions need recognition restart
- Opera needs explicit `getUserMedia()` call (not implicit from `SpeechRecognition.start()`)
- Confidence varies by word complexity — scorer may need per-word thresholds

---

## ADR-006: getUserMedia before SpeechRecognition.start()

**Date:** 2026-07-04
**Issues:** #95

### Decision
Always call `navigator.mediaDevices.getUserMedia({ audio: true })` before `SpeechRecognition.start()` to trigger the microphone permission prompt.

### Rationale
- Chrome triggers the permission prompt implicitly from `SpeechRecognition.start()`
- Opera (and possibly other Chromium-based browsers) does NOT trigger it implicitly
- Video chat apps (Meet, Zoom) all use `getUserMedia` explicitly — this is the cross-browser standard
- Calling `getUserMedia` first guarantees the prompt appears in all browsers

### Consequences
- Minor latency overhead (stream is opened and immediately stopped)
- If user denies permission, we can show a clear error before attempting recognition
- Works universally: Chrome, Safari, Firefox, Edge, Opera

---

## ADR-007: Cloudflare Pages Functions naming convention

**Date:** 2026-07-04
**Issues:** #96

### Decision
In Cloudflare Pages Functions, avoid variable names that collide with the standard function parameters (`request`, `env`, `params`, `next`). Use descriptive prefixes for local variables.

### Rationale
- `onRequestPost({ request, env })` — `env` contains Cloudflare environment variables
- Declaring `const env = ...` locally shadows the parameter, causing a Wrangler build error
- This is a subtle bug that only surfaces at deploy time, not during local dev

### Consequences
- Use `envData` instead of `env` for local environment data
- Document this in CONTRIBUTING.md for future contributors

---

## ADR-008: Dynamic maxOutputTokens for AI enrichment batches

**Date:** 2026-07-04
**Issues:** #104

### Decision
Calculate `maxOutputTokens` proportionally to the number of words being enriched in a single AI call, instead of hardcoding 2000. Formula: `Math.min(8192, 500 + wordCount * 350)`.

### Rationale
- Each word's JSON sense object (english/pos/category/emoji) consumes ~60-80 output tokens
- 18+ word batches need ~1500-1800 tokens of JSON data alone, plus array structure overhead
- Hardcoded 2000 was too small — responses got truncated mid-JSON, parsing failed silently, and teachers saw the "AI couldn't do its category pass" warning
- Gemini 2.5 Flash supports up to 8192 output tokens; Groq Llama 3.3 70B and CF Workers AI also support this
- The formula gives comfortable headroom for multi-sense splits (some words generate 2+ entries)

### Consequences
- Client-side (`callAIWithFallback`) and server-side (`ai-enrich.js`) both accept and propagate `maxTokens`
- Backward compatible: default 2000 when not specified (older callers still work)
- Server-side clamps to `[2000, 8192]` range for safety
- If batches grow beyond ~25 words and even 8192 is insufficient, consider batching (split into multiple API calls) as a follow-up

---

## ADR-009: STT tiered browser support + smoke-test feature detection

**Date:** 2026-07-04
**Issues:** #78, #79, #81, #84

### Decision
Ship pronunciation/STT with a tiered support strategy instead of an all-or-nothing gate: Chrome (Desktop +
Android) and Edge as **primary** (full scoring), Safari iOS/iPadOS as **secondary** (active, reduced-confidence
warning), Safari macOS as **tertiary** (active, more tolerant threshold), Opera and Firefox **degraded** to
text-only. Feature detection uses a 2-second smoke test (start recognition, check `onstart` fires) instead of
trusting `'SpeechRecognition' in window`.

### Rationale
- Full cross-browser matrix showed wildly different real-world behavior: Chrome/Edge 92-100% confidence,
  Safari 69.5-85.3%, Opera 0% (despite reporting the API as available), Firefox no support at all
- Opera is a **false positive** for interface detection — it inherits the Chromium `SpeechRecognition`
  interface but never implements the recognition backend (`onstart` never fires); confirmed via Opera's own
  support forum
- Gating the whole feature behind "works everywhere" would mean never shipping it; gating behind a single
  browser would exclude the majority of iOS users (they get Safari, not Chrome)

### Consequences
- `functions/api/stt-report.js` + `/stt-test.html` remain in the repo as permanent test tooling, not just
  spike scaffolding — useful whenever browsers change STT behavior
- Offline pronunciation is impossible on every browser tested (server-based recognition) — accepted as a
  known limitation, app core (flashcards/SRS/Sunday Test) stays 100% offline-capable regardless

---

## ADR-010: Avatar system — KV-based data model, no schema migration

**Date:** 2026-07-06
**Issues:** #161-#212 (Avatares para Alunos milestone)

### Decision
Store all avatar/coin state (`avatar`, `unlockedAvatars`, coin balance, pending gifts) as fields inside the
existing `profile` KV blob and dedicated shared-KV keys (`avatar-gift:<username>`, `coin-gift:<username>`,
`avatar-gift-budget:<username>`), rather than adding new Supabase tables/columns.

### Rationale
- The app already has a working KV storage layer (`storageGet`/`storageSet`, personal vs shared) used for
  `profile`, `roster`, class codes — reusing it means zero migrations, zero new RLS policies to reason about
- Teacher-initiated gifts (avatar or coins) can't write directly into a student's `personal_kv` (RLS blocks
  cross-user writes) — solved with a "pending record in shared_kv, student self-claims on next load/poll"
  pattern, first used for #176 (avatar gift) and reused as-is for #212 (coin gift)
- Avatar catalog itself lives as a static array in code (`AVATAR_CATALOG`), not a DB table — it changes
  rarely (new avatar art drops) and doesn't need per-row RLS/queries

### Consequences
- Adding a new avatar is a code change + asset upload, not a DB migration — fast to ship, but requires a
  deploy for every new avatar (accepted trade-off, matches how Monthly Cat art already ships)
- The self-claim pattern means a gift takes effect on the student's *next* load/poll, not instantly — no push
  infra needed, consistent with how ClassCode releases already work
- Coin balance (`COINS_KEY`) is a single mutable integer with no transaction log — `creditCoins()` is the only
  function allowed to touch it, keeping the invariant simple but making balance history unavailable for audit

---

## ADR-011: Coins economy rebalance + Gacha ticket system

**Date:** 2026-07-06
**Issues:** #198, #207, #208, #209, #210

### Decision
Halve all coin multipliers (Practice 0.6x, Sunday Test 1x, weekly-streak bonus 1.5x — new ceiling ~670
Meowtongs/week at 100% accuracy every day) and raise the price floor for Rare (2,750) and Epic (5,000)
avatars, financed by two new purchasable Gacha tickets (Rare 2,000 coins / Epic 3,500 coins) with
weighted, pool-exhaustion-aware draw tables and a mandatory odds-disclosure modal before every roll.

### Rationale
- Owner observed a 100%-dedicated student could farm ~1,340 Meowtongs/week under the old multipliers —
  the Store/Gacha aspirational avatars were reachable too fast, killing the "want it, save for it" loop
- Flat 500-coin pricing for every avatar regardless of rarity meant rarity was purely cosmetic — tying price
  to rarity (with tickets targeting the higher tiers specifically) gives Rare/Epic actual weight
- Pool-exhaustion-aware draw tables (the ticket's odds change once a rarity tier is fully collected) avoid
  the "why did I get a duplicate" frustration common in gacha systems, and the Epic ticket's jackpot-upgrades-
  to-Legendary-when-everything-is-owned rule guarantees the ticket is never a dead purchase
- Full odds transparency (shown before the player commits coins) was a deliberate trust decision — no hidden
  rates, consistent with the project's "documentation for UX clarity" standing instruction

### Consequences
- Existing owned-avatar counts needed no migration — the rebalance only changes go-forward pricing/rates,
  past unlocks are untouched
- Scenario tables (draw resolvers) live as top-level, unit-testable functions in `App.jsx`, independent of the
  Gacha tab UI — the UI just calls them and renders whatever they return
- Bespoke per-avatar pricing above the rarity floor is still an open question (currently every avatar in a
  tier uses the floor price uniformly) — flagged as a future follow-up, not blocking

---

## ADR-012: GitHub API requires an explicit User-Agent header from Workers

**Date:** 2026-07-04 (recurred through 2026-07-06 debugging)
**Issues:** #79, #81 (Edge test unblocked), stt-report/report-error infra

### Decision
Every server-side `fetch()` call to `api.github.com` from a Cloudflare Pages Function must set an explicit
`User-Agent` header.

### Rationale
- GitHub's API rejects requests with no `User-Agent` with a 403 "Request forbidden by administrative rules" —
  a generic-looking error that has nothing to do with token scope or permissions, which is what it's usually
  mistaken for
- This silently blocked `stt-report.js` submissions for a full test cycle before being traced past token
  permission checks to the missing header
- Cloudflare's `fetch()` (unlike a browser's) does not set a default `User-Agent`, so this is specific to
  Workers/Pages Functions, not something that shows up in local `curl` testing without care

### Consequences
- Both `report-error.js` and `stt-report.js` now set `User-Agent` explicitly — documented here so the next
  GitHub-calling function doesn't lose an hour to the same red herring
- Worth checking first, before touching PAT scopes/permissions, whenever a Cloudflare Function → GitHub API
  call returns 403

---

## ADR-013: React hooks must be declared before any early return

**Date:** 2026-07-06 (recurred across #55, #98, #201)
**Issues:** #55, #98, #201

### Decision
In any component with conditional early returns (loading states, feature-flag gates, etc.), all `useState`/
`useEffect`/other hooks must be declared at the top of the component, before any `if (...) return ...`.

### Rationale
- React's Rules of Hooks require the same hooks to run in the same order on every render — an early return
  placed before a hook call means that hook sometimes runs and sometimes doesn't, which either throws
  (React error #310, "hooks called after conditional early return") or silently desyncs state
- This exact bug pattern recurred at least three times independently (#55 notification hook violation, #98
  Teacher Home TDZ-adjacent crash, #201 celebration sequencing) — worth a standing rule rather than
  re-diagnosing it each time
- Cheap to check for: scan a component for `return` statements that appear above any `use*(` call

### Consequences
- No automated lint rule enforced yet (`eslint-plugin-react-hooks` would catch this) — worth adding as a
  follow-up if it recurs a 4th time
- Documented here as the fastest first-check whenever a component "sometimes" crashes or shows stale state

---

## ADR-014: `storageGetSafe` is mandatory for any read-modify-write on KV data

**Date:** 2026-07-07
**Issues:** #251, #282

### Decision
Any code path that reads a `personal_kv`/`shared_kv` value, mutates it, and writes it back (balances,
rosters, counters, etc.) must use `storageGetSafe(key, shared)` — which resolves to `null` on any read
failure — never the older `storageGet(key, shared) || fallback` pattern.

### Rationale
- `storageGet` silently returns its fallback value on *any* failure — network blip, expired session, an RLS
  hiccup — indistinguishable from "the key genuinely doesn't exist yet"
- `loadRoster()` (#251) and `creditCoins()` (#282) both hit this independently: a transient read failure
  looked identical to "empty/zero", so the write that followed overwrote real data with a fallback-derived
  value — in #282 a real coin balance was almost overwritten by just that single transaction's delta
- This is the same underlying bug shape recurring twice, which is exactly the kind of pattern ADR-013
  (hooks-before-early-return) was written to prevent for a different bug class — worth the same standing rule
  treatment here

### Consequences
- `storageGetSafe` exists alongside `storageGet` — the unsafe version is still fine for pure display reads
  where a stale/default value on failure is harmless (e.g. a UI preference toggle)
- No automated lint enforces this yet; call sites doing read-modify-write on KV data should be reviewed for
  this pattern specifically whenever touched
- There is still no transaction ledger for coins (`personal_kv` only stores the current balance) — corruption
  is now *prevented* going forward, but still not *auditable* after the fact if it recurs through a different
  path. Flagged as a possible future follow-up (a simple append-only coins ledger), not yet an issue.

---

## ADR-015: Web Speech API cannot be bound to a specific input device

**Date:** 2026-07-08
**Issues:** #268

### Decision
Accept that `SpeechRecognition` always listens through the browser/OS default microphone — there is no
supported way to pass it a `MediaStream` or `deviceId`. Any "choose your microphone" feature therefore has to
split into two independent checks: a real per-device input-level test (via `getUserMedia({ deviceId: exact
})` + `AnalyserNode`), and the actual STT recognition test, which unavoidably runs on the default device
regardless of what was picked.

### Rationale
- Confirmed by testing and cross-checked against the Web Speech API spec: `SpeechRecognition` takes no audio
  source parameter at all, unlike `MediaRecorder`/raw `getUserMedia` consumers
- Silently letting the student "select" a microphone for pronunciation exercises without disclosing this
  would be misleading — the selection would appear to do nothing during actual exercises
- The level-meter check is still genuinely useful on its own (confirms the physical device is captureable and
  producing signal) even though it can't fully validate the STT path end-to-end

### Consequences
- The calibration modal in Settings discloses this limitation directly in its copy, not just in code comments
- The chosen `deviceId` is persisted (`mic-device-pref`) for the day some feature records raw audio directly
  via `getUserMedia` (none currently does — STT is 100% through the Web Speech API)
- If a future STT provider is added that accepts a raw audio stream (e.g. a server-side model fed via
  `MediaRecorder`), this limitation goes away for that path specifically — worth revisiting then

---

## ADR-016: Power system — activity-scoped catalog instead of global power list

**Date:** 2026-07-07/08
**Issues:** #184, #214, #216, #220, #224, #286-289, #295

### Decision
Every entry in `POWER_CATALOG` carries an `appliesTo` array (e.g. `["practice", "sundayTest"]`), and
`PowerBar` takes an `activity` prop and only renders/considers powers relevant to that specific screen,
instead of showing every power an avatar has regardless of whether it does anything there.

### Rationale
- Early powers were built ad hoc per-screen; as soon as more than a couple of activities (Practice, Sunday
  Test, Exam) started reusing the same `PowerBar`, dead/irrelevant powers showed up where they had no effect
  (e.g. a countdown-timer power appearing on Sunday Test, which has no timer) — confusing without any nearby
  explanation
- Tagging the catalog entry once (`appliesTo`) instead of hardcoding per-screen filter lists means adding a
  new activity (e.g. `"exam"`, added in #307) or a new power that already fits multiple activities requires
  zero changes to `PowerBar` itself — it's fully data-driven
- Avatars now supporting 2 simultaneous passives (`passive` + `passive2`, #295) made an explicit relevance tag
  more important — showing both regardless of activity would double the noise

### Consequences
- A power with an empty/no-match `appliesTo` for the current activity is simply invisible there — this is
  also how the dead `sundaytest_countdown_25` power was caught and removed (#295), and how the Exam's
  `PreActivityFlow` gracefully shows an empty state (#307) instead of a broken one
- Follow-up power/activity combinations (e.g. an exam-specific coins bonus) are additive: just add the tag,
  no plumbing changes

---

## ADR-017: PreActivityFlow — one reusable pre-activity gate instead of per-screen buttons

**Date:** 2026-07-08
**Issues:** #266, #306, #307

### Decision
Extract a single `PreActivityFlow` component (avatar picker → power activation screen → CTA) used identically
by Practice Mode, Sunday Test, and the Proficiency Exam, replacing each screen's own ad hoc "Start" button
sitting next to a loose `PowerBar` widget.

### Rationale
- The avatar-equip mechanism and the `PowerBar` already existed independently; the missing piece was
  sequencing them into a deliberate two-step ritual ("who are you bringing today?" → "what are you
  activating?") before every activity, per the owner's spec (#266)
- Building it once as a parametrized component (`activity` prop) rather than three copies keeps the "does
  this avatar have anything relevant here" logic (`getActivePowersForActivity`) in one place, consistent with
  ADR-016's data-driven approach
- Mic-permission checks (#154) intentionally stay independent/untouched — they're a browser capability gate,
  not a gameplay ritual, and run before this flow regardless

### Consequences
- Adding pre-activity gating to a future activity (Berserk Mode, once #52 ships) is expected to be a thin
  integration, mirroring #307's exam integration, rather than new UI work
- The empty-state ("[Avatar] has no powers for this yet") is a first-class supported state, not an edge case —
  it's what every activity shows until its catalog gets `appliesTo` entries

---

## ADR-018: Calligraphy feature (Phase 10) restricted to touch devices — no desktop browser support

**Date:** 2026-07-08
**Issues:** #59, #60, #61, #62, #63 (Phase 10 — Thai Calligraphy Training)

### Decision
The entire Calligraphy feature set (guided stroke animation, interactive tracing canvas, Study Mode
integration) is scoped to tablets and smartphones only. Desktop/laptop browsers do not get an entry point
into the feature at all — not a degraded experience, no availability.

### Rationale
- The core interaction (#61 — tracing canvas with `perfect-freehand` + $1 Unistroke scoring) is fundamentally
  a finger/stylus drawing task. A mouse-driven "trace the character" exercise doesn't teach or validate stroke
  form the same way — precision, pressure-adjacent feel, and the natural pen-like motion that makes the
  exercise pedagogically meaningful are all touch/stylus-specific
- Rather than half-support desktop with a materially worse, potentially confusing experience (mouse tracing
  reading as "wrong" more often for reasons unrelated to the student's actual handwriting), the owner decided
  to gate the whole feature to touch devices and skip building/testing a desktop fallback entirely
- Matches how the rest of the app is used in practice — students overwhelmingly access chaachaathai from
  phones/tablets, so this isn't cutting off a primary usage path

### Consequences
- #62 (Study Mode entry point) must detect device type (touch capability, not just viewport width — a
  touch-enabled laptop should probably still be excluded per this ADR's spirit; screen size + coarse pointer
  media query, e.g. `(pointer: coarse)`, is the intended signal, not `navigator.userAgent` sniffing) and
  simply not render the "Practice writing" entry point on desktop
- No desktop-specific design/testing needed for #60/#61 — animation and tracing components can assume a touch
  or stylus input surface
- If this changes later (e.g. desktop stylus/tablet-PC support becomes a real ask), revisit as a new ADR
  rather than quietly expanding scope here

## ADR-019: Gacha pity thresholds — short, realistically-reachable, not Genshin-scale

**Date:** 2026-07-08 · **Issue:** #347

### Decision
Added a second, independent protection layer on top of the existing scenario system (#198): a
consecutive-rolls-without-jackpot counter per ticket kind, with **soft-pity starting at roll 6 (Rare) / 5
(Epic)** and **hard-pity (guaranteed jackpot) at roll 10 (Rare) / 8 (Epic)**.

### Rationale
- The existing worst case (Cenário A, 3% jackpot odds) implies an average of ~33 rolls to land a jackpot by
  pure chance — a real-money gacha's pity (Genshin: 74-90 rolls) is calibrated against that kind of volume
- But the realistic ceiling here is **~670 Meowtongs/week** for a 100%-dedicated student (#198.1) — a Rare
  Ticket (2,000 coins) costs ~3 weeks of full dedication, an Epic (3,500) ~5 weeks. A student spending 100%
  of their coins on tickets could realistically afford maybe a dozen Rare tickets or half that many Epics
  across an entire school year
- A Genshin-scale hard-pity would be mathematically real but **practically unreachable** — it would protect
  no one and would just be decorative. Pity only means something here if it's actually within reach of a
  motivated student within a reasonable number of tickets
- This is a pedagogical app, not a monetized gacha — there's no incentive to stretch out the "worth it" tail
  to encourage more real-money spend. Erring toward a shorter, generous pity better serves a kid who ground
  out weeks of study for their coins

### Consequences
- Soft-pity boosts the jackpot odds linearly from base (at the soft-pity roll) up to 100% (at hard-pity),
  reweighting every other outcome proportionally so percentages still sum to 100 — implemented in
  `applyPityBoost()`
- The "odds for this roll" modal (permanent probability-transparency rule) must always show the
  **pity-boosted** table once pity data is loaded, not the static base-scenario table — a stale unboosted
  display would now be actively misleading
- Pity only tracks the top-tier jackpot outcome for that ticket kind (`jackpot_rare` / `jackpot_epic`) — it
  does not protect against droughts of lower-tier avatars or coins-only outcomes
- The upcoming Special Banner system (#351) is expected to reuse this same pity infrastructure as its own
  independent `banner` track, once implemented

## ADR-020: $1 Unistroke Recognizer with rotation invariance deliberately disabled

**Date:** 2026-07-08 · **Issue:** #61

### Decision
The tracing canvas's stroke scorer implements the classic $1 Unistroke Recognizer (Wobbrock, Wilson & Li,
2007) — resample → scale-to-square → translate-to-origin → best-fit distance search — but **skips the
algorithm's standard "rotate to indicative angle" normalization step**, keeping only a ±45° search window in
the final distance comparison. Pass threshold set to a $1 score of **0.68**.

### Rationale
- The classic $1 pipeline's "rotate to indicative angle" step subtracts each stroke's own centroid→first-point
  angle before comparison. This is a *rigid* transform: rotating an entire point set by θ rotates its
  centroid→first-point vector by that exact same θ, for *any* shape, symmetric or not — so this step always
  perfectly cancels whatever rotation was applied to a copy of the same points, no matter how large. Verified
  empirically during implementation: a straight-line template rotated 180° scored a *perfect* 0.999 match
  against the unrotated original, because both got independently "rotated to zero" back into the exact same
  orientation before comparison
- That's the correct behavior for $1's original purpose (recognizing which of several candidate gestures a
  shape most resembles, regardless of how it was drawn) — but wrong for us. A Thai consonant stroke has a
  correct absolute drawing direction/orientation as part of proper calligraphy; a student who traces the
  right shape upside-down, mirrored, or rotated 90° should fail, not score a perfect match
- Removing that step and running the ±45° golden-section search directly on the (unrotated) scale/translate-
  normalized points keeps absolute orientation meaningful while still tolerating natural hand tilt — a stroke
  rotated ~20-30° (normal wrist variation while tracing) still scores 0.86-0.90+, but 90°+ rotation or a
  reversed drawing direction drops to ~0-0.5

### Calibration (synthetic, pre-launch)
Tested against a real curved stroke from `thaiStrokes.js` (not just synthetic straight lines): identical
redraw ≈0.998, light random jitter (±1-5 units, simulating imprecise finger tracing) stays in the 0.90-0.99
range, reversed stroke direction and 180° rotation both score ≈0.000, shapes rotated beyond the ±45° window
degrade smoothly (0.80 at 45°, 0.53 at 90°). **0.68** sits comfortably below realistic sloppy-but-correct
attempts and above genuinely wrong shape/direction/orientation — but this is calibrated against synthetic
data, not real student attempts; the threshold constant (`TRACE_PASS_THRESHOLD` in App.jsx) may need
adjustment once real usage data (kids' actual finger-tracing accuracy) comes in.

### Consequences
- `normalizeStroke()` in `src/utils/unistrokeRecognizer.js` intentionally omits the indicative-angle rotation
  step present in the textbook $1 algorithm — this is a deliberate deviation, not an oversight; the code
  comment there explains why in case anyone "fixes" it back to spec later
- Both the reference (ghost) stroke and the student's drawn stroke are resampled/normalized independently at
  scoring time from their own point arrays — the reference points come from sampling the actual rendered SVG
  ghost path via `getPointAtLength()`, keeping it in lockstep with whatever `buildSmoothStrokePathD` renders
- If a future need arises for genuine shape-only recognition (rotation-agnostic), that would need a separate
  scoring mode — don't silently restore the indicative-angle step in the shared utility, since that would
  regress stroke-order/orientation validation for calligraphy without an obvious signal that it broke

## ADR-021: Berserk Mode reuses `affectsProgress=false` instead of a parallel SRS-write path

**Date:** 2026-07-08 · **Issues:** #52, #321-#332

### Decision
Berserk Mode's timed session (`BerserkSession`) is a thin wrapper around the real `PracticeSession`
component — same timer/countdown-to-incorrect mechanic (#18), same exercise-mix logic (flip/Recognition,
#265) — running with `affectsProgress=false` (the same flag #318 added to `PracticeSession` for the Preview
Exercises tool) so a Berserk attempt never writes to a student's real `srsInterval`/streak/mastery data.

### Rationale
- The owner's spec for #52 was explicit: Berserk is a standalone timed challenge, not a second way to
  progress through the word bank — a student shouldn't be able to grind Berserk instead of Daily Practice to
  advance SRS intervals
- `PracticeSession` already had every mechanic Berserk needed (timer, flip/Recognition rendering, results
  tracking); building a parallel session component would have duplicated all of that for no benefit
- Reusing the exact flag #318 already introduced for a different reason (QA previews) meant zero new plumbing
  in `PracticeSession` itself — the "does this run affect real progress" concept only needed to exist once

### Consequences
- Berserk star/cooldown/attempt-count state all live in their own dedicated `personal_kv` keys
  (`BERSERK_STARS_KEY`, `berserk:cooldown:<tier>`, `berserk-attempts`) — completely separate from `progMap`
- Because Berserk never touches `progMap`, it also never hits the app's one `updateSharedStats` call site for
  free — #57 (teacher notification) had to explicitly extend `updateSharedStats` with an optional `extra`
  payload just to mirror a freshly-cleared Berserk star into shared stats
- Any future activity that needs a "doesn't count toward real progress" mode (e.g. a future timed
  mini-game) should reuse `affectsProgress` rather than inventing a new flag

---

## ADR-022: Solstice Banner — M-2 featured cat + time-locked banner-exclusive avatars

**Date:** 2026-07-09 · **Issues:** #351, #377-#386

### Decision
The Solstice Banner (Phase 19) features a past "Gatinho do Mês" from **2 months before** the current month
(M-2), not M-1, alongside 2 dedicated banner-exclusive Rare avatars and (on select banners) a banner-exclusive
Legendary. Any avatar debuting via a banner gets a `lockedUntilMonthKey` field keeping it out of the general
Rare/Epic Gacha draw pools until 2 months after its debut banner closes.

### Rationale
- M-1 was the original spec (#351), but the owner corrected it during implementation (#386): the monthly cat
  from the immediately preceding month is still "fresh" from its own Gatinho do Mês challenge — re-featuring
  it right away on a banner feels repetitive rather than a genuine "catch-up" opportunity. M-2 gives enough
  distance for it to feel like a real second chance
- Debut banner-exclusive avatars (Meowlin, Don Thong, Kila Meowter) need to stay genuinely exclusive to the
  banner for a while, or the banner has no draw beyond convenience — `runMonthlyCatEngine` only checks the
  *current* month, so without an explicit lock a banner-exclusive Legendary could otherwise be earned
  retroactively through the regular monthly-cat mechanic, undermining the "you had to be there" appeal
- Teacher gifting deliberately ignores the lock (`AvatarGiftModal` reads the catalog directly) — the lock is
  about the random draw pools specifically, not about a teacher's ability to reward a student

### Consequences
- `getFeaturedBannerKeyForMonthCat` computes M-2 directly from the active banner's month, no hardcoded dates
- `isAvatarLocked()` is now a general-purpose check (also reused by #391/#392 for teacher-authored custom
  cats with their own "Locked until" field) — locking isn't a Solstice-only concept anymore
- The Solstice `banner` pity track (#379) is fully independent from the Rare/Epic tracks (#347/ADR-019) —
  a student's banner luck doesn't affect or get affected by their regular ticket pity
- `ManageBannerModal` gives the teacher manual control over which Rares/Legendary are featured per banner —
  this was always the intended design (#351) but had no UI until #386 actually built it

---

## ADR-024: `noSuspense` flag — Gacha reveal animation only for actual Gacha rolls

**Date:** 2026-07-11 · **Issues:** #440, #441

### Decision
`CoinsUnlockMoment` accepts a `noSuspense` boolean on its `event` data. When `true`, it passes `skip: true`
to `useGachaRevealSequence`, going directly to the revealed state (value screen + coin-fly animation) without
the `GachaSuspenseBox` suspense sequence. The flag is set to `true` for every coin-earning event that is **not**
a direct result of a Gacha ticket roll.

Events with `noSuspense: true` (skip animation):
- **Coin gifts** from the teacher (`pushCelebrations` in the gift-claim flow)
- **Session/LP rewards** — coins accumulated via `pendingCoinEventsRef` (Practice Mode, Sunday Test, Proficiency Exam, Lesson Path section completion)
- **Achievements** — coins credited when a new achievement unlocks (4 call sites)
- **Gacha cashback** — coins given when every avatar the Epic ticket could draw is already owned

Events with `noSuspense: false` / omitted (keep animation):
- Rare ticket roll → coins result
- Epic ticket roll → coins result
- Solstice (banner) ticket roll → coins result

### Rationale
- The `GachaSuspenseBox` sequence (blue → yellow → flash, ~2s) is thematically tied to the tension of a Gacha
  roll. Showing it for an achievement reward or a section-complete bonus creates a false expectation — the
  student mentally prepares for a roll reveal and gets a coin count instead
- The coin-fly animation (particles from the card to the avatar) already gives the delivery its own satisfying
  moment; the suspense layer adds friction without matching the emotional context
- For actual Gacha roll coins (a ticket was opened and the outcome was coins, not an avatar), the animation
  makes sense: the student just opened a ticket, they're already in that mental state
- Keeping the flag data-side (on the event object, not a component prop) means `CoinsUnlockMoment` remains
  a single reusable component — the caller decides context, not a prop API

### Consequences
- Any future coin-earning event added to `pushCelebrations` must explicitly set `noSuspense: true` if it is
  not the direct result of a ticket roll — the default (omitted/`false`) keeps the animation, which is safe
  only in a Gacha roll context
- #441 (needs-spec: full cinematic Gacha animation) will eventually replace `GachaSuspenseBox` entirely for
  the `noSuspense: false` path; this ADR's flag ensures that future replacement is also scoped to roll events
  only and doesn't accidentally apply to coin gifts or achievement payouts

---

## ADR-025: Bilingual UI message library — `desc` (Thai) + `descEn` (English) + `getDesc` helper

**Date:** 2026-07-21

### Problem

Several shared data arrays (`CHALLENGE_POOL`, `MONTHLY_CHALLENGE_POOL`, `ACHIEVEMENTS`, `MILESTONES_DEF`) are
consumed by both student-facing UI and teacher-facing admin panels. After translating `desc` fields to Thai for
student comfort, the teacher's challenge configuration dropdowns and previews began showing Thai text — which
breaks teacher UX since the admin area must stay in English.

### Decision

Every shared data array that carries user-visible description text must have **two description fields**:

| Field | Language | Audience |
|-------|----------|----------|
| `desc` | Thai | Students |
| `descEn` | English | Teachers / admin panels |

A single helper function mediates access at every render site:

```js
// ADR-025 — i18n helper for shared data arrays (challenges, achievements, milestones).
// Pass isTeacher=true in teacher-only render sites to get the English description.
function getDesc(item, isTeacher = false) {
  return isTeacher ? (item.descEn ?? item.desc) : item.desc;
}
```

**Render-site rules:**
- **Student-facing UI** (Events tab, Achievements gallery, Milestones panel): call `getDesc(item)` or `getDesc(item, false)` — returns `desc` (Thai).
- **Teacher/admin UI** (challenge scheduler dropdowns, challenge slot previews): call `getDesc(item, true)` — returns `descEn`, falling back to `desc` if `descEn` is missing.

**Arrays covered by this ADR:**
- `CHALLENGE_POOL` — weekly challenge definitions
- `MONTHLY_CHALLENGE_POOL` — monthly challenge definitions
- `ACHIEVEMENTS` — achievement definitions
- `MILESTONES_DEF` — milestone definitions

### Rationale

- The teacher area must stay in English (admin context, shared with non-Thai speakers).
- Students benefit from reading challenge and achievement descriptions in Thai for comprehension and motivation.
- A single `getDesc` helper keeps the branching logic in one place; render sites stay declarative.
- The `?? item.desc` fallback in `getDesc` means that any new entry added without `descEn` degrades gracefully to Thai rather than crashing.

### Consequences

- **Any new entry** added to the arrays above must include both `desc` (Thai) and `descEn` (English).
- **Any new teacher render site** that displays description text from a shared array must call `getDesc(item, true)`.
- **Student render sites** that already call `.desc` directly should be migrated to `getDesc(item)` opportunistically — both produce the same result, but `getDesc` makes the intent explicit and makes future language changes easier.
- If a third language is ever needed, add a `descLang` field and extend `getDesc` with a `lang` parameter rather than adding more boolean flags.

---

## ADR-026: Consolation pity — garantia por sequência de avatares (Genshin-style)

**Date:** 2026-07-22

### Decision

Adicionar uma segunda camada de proteção sobre o jackpot pity existente (ADR-019): um consolation pity que garante ao menos um avatar antes que uma sequência longa de rolls sem nenhum avatar se acumule. Dois novos contadores por tipo de ticket são persistidos em `gacha-pity`:

- **`{kind}Avatar`** — rolls consecutivos sem qualquer avatar (reseta ao receber qualquer avatar).
- **`{kind}Lifetime`** — total acumulado de rolls do tipo (nunca reseta).

**Regras por ticket:**

| Ticket | Garantia nos primeiros N rolls (lifetime) | Consolação a cada M sem avatar |
|--------|-------------------------------------------|-------------------------------|
| Rare (Moonrise) | lifetime ≤ 5 → Uncommon ou melhor | a cada 7 → Uncommon, Common ou coins > 1.500 |
| Epic (Starlight) | lifetime ≤ 7 → Uncommon ou melhor | a cada 5 → qualquer avatar (remove coins) |
| Solstice (Banner) | lifetime ≤ 5 → avatar featured (jackpot ou `featured_rare`) | a cada 7 → qualquer avatar (remove coins) |
| Dawn (Hearthbound) | lifetime ≤ 5 → qualquer avatar (remove coins) | a cada 5 (pré-softStart) → Rare ou inferior; a cada 5 (pós-softStart) → Epic ou inferior |

### Rationale

- Genshin garante 1 personagem 4★ a cada 10 wishes — protege o jogador contra runs longas de estrelas 3★. Analogamente, um aluno pode abrir vários tickets Rare e receber só coins: frustrante quando moedas custam semanas de estudo.
- A garantia dos primeiros N rolls (`lifetime`) é um "boas-vindas" — o aluno que está abrindo seu primeiro Rare ticket tem expectativa alta. Uma sequência de coins do início quebra a motivação antes de ela se consolidar.
- A consolation (a cada M sem avatar) cobre sessões de azar avançadas — impede que alguém com muitas coletas continue meses sem ver um avatar.
- Jackpot pity (`hardCap`) tem prioridade absoluta — consolation só filtra a tabela quando `hardCap` ainda não foi atingido, evitando conflito entre as duas garantias.
- Consolation counter reseta apenas em avatar real (Genshin logic); cashback de featured já possuído **não** reseta (`cashback` é coins/ticket, não avatar).

### Consequences

- `updateGachaPity(kind, hitJackpot, gotAvatar)` recebe 3º parâmetro; todos os call sites passam `gotAvatar = !!avatar` (`true` para avatar real, `false` para coins ou cashback).
- `filterAndNormalize(table, keepSet)` — helper que filtra e renormaliza pesos para 100.
- Quatro funções `apply*Consolation` encapsulam a lógica por tipo, chamadas após `applyPityBoost`.
- `simulate: true` (preview do professor) bypassa todos os contadores — nem lê nem escreve.
- **Contadores retroativos:** alunos existentes começam com `{kind}Avatar = 0` e `{kind}Lifetime = 0` (os campos simplesmente não existem no KV; padrão `0` é aplicado no código). A garantia dos primeiros N rolls não se aplica retroativamente — correto, pois esses alunos já passaram dessa fase.

---

## ADR-023: Portal-based `<ModalOverlay>` instead of per-modal inline overlay divs

**Date:** 2026-07-09 · **Issues:** #400, #400.1, #400.2, #403

### Decision
Replace every modal's own `<div className="modal-overlay" onClick={onClose}>...</div>` wrapper with a
single shared `<ModalOverlay onClose closeOnBackdrop>` component that renders via `createPortal` directly
into `document.body`.

### Rationale
- Root cause of #400: `position: fixed` resolves against the nearest positioned/transformed ancestor, not
  always the viewport — several modals opened while a scrollable/clipped ancestor (e.g. a scrolled admin
  list) was in a particular state rendered mispositioned or clipped. This is a CSS containment issue, not a
  z-index issue, so no amount of z-index tweaking on the existing inline-div pattern would have fixed it
  reliably across every call site
- A portal sidesteps the problem entirely: the modal DOM node is always a direct child of `<body>`,
  regardless of where in the component tree it was rendered from
- Building it once as a shared component (with a `closeOnBackdrop` boolean escape hatch for modals with a
  custom close condition, like `ImportPPTModal`'s "can't dismiss mid-import" rule) meant the ~9 existing
  modals could be migrated as a mechanical swap rather than each getting a bespoke fix

### Consequences
- New modals should use `<ModalOverlay>` from the start rather than reintroducing the old inline-div pattern
- Migration was intentionally split into small batches (#403 foundation + 1 smoke test, #400.1 the 7 teacher
  admin/CRUD modals, #400.2 AddWordModal + ImportPPTModal) so each could be verified independently before
  moving on to the next
- `closeOnBackdrop` takes a plain boolean rather than always wiring backdrop-click to `onClose` — this is the
  one meaningful behavior knob the shared component exposes; anything more custom than "always/never/depends
  on phase" would need a different approach
