# STT Feasibility Test Results

Cross-browser Speech Recognition (STT) test results for Thai (th-TH).
Part of the Phase 12 feasibility spike (#69) — **concluded, decision: GO** (see #81).

Test page: `/stt-test.html` (accessible via Teacher Home → "Speech Recognition Test")

---

## Final Compatibility Matrix (2026-07-04)

| Browser | OS | API | Confidence | Match Rate | Errors | Offline | Issue |
|---|---|---|---|---|---|---|---|
| **Chrome Desktop** | Windows | `SpeechRecognition` | **92.0%** | 15/15 (100%) | 0 | ❌ | #84 |
| **Chrome Android** | Android | `SpeechRecognition` | **93.5%** | — | 7 | ❌ | #84 |
| **Edge Desktop** | Windows | `SpeechRecognition` | **100%** | 13/13 (100%) | 0 | ❌ | #79 |
| Safari iOS/iPadOS | iPadOS | `webkitSpeechRecognition` | 85.3% | 7/7 (100%) | 0 | ❌ | #78 |
| Safari macOS | macOS | `webkitSpeechRecognition` | 69.5% | — | 0 | ❌ | #78 |
| Opera | Windows | false positive* | — n/a — | — | — | — | #79 |
| Firefox | — | not supported | — | — | — | — | #79 |

\* Opera reports `'SpeechRecognition' in window === true` (inherited Chromium interface) but the recognition
backend isn't implemented — `onstart` never fires, `onend` fires immediately. Confirmed against Opera's own
support forum. This is why feature detection can't rely on interface presence alone (see ADR-009).

**Note on Safari iOS/iPadOS:** reports `Macintosh` in the userAgent (known iPadOS 13+ behavior) — identified
via the performance delta against the earlier macOS test and local test timestamp.

---

## Decision: ✅ GO (#81, 2026-07-04)

Phase 12 approved with a tiered support strategy:

| Tier | Browsers | Strategy |
|---|---|---|
| **Primary** | Chrome (Desktop + Android), Edge | Full STT with pronunciation scoring |
| **Secondary** | Safari iOS/iPadOS | STT active, reduced-confidence warning shown |
| **Tertiary** | Safari macOS | STT active, more tolerant scoring threshold |
| **Degraded** | Opera, Firefox | Text-only mode, no pronunciation — "Your browser doesn't support voice recognition" |

- **Offline:** Web Speech API is server-based on every browser tested — pronunciation never works offline.
  This is an accepted limitation; pronunciation is an optional feature layered on top of a still-100%-offline
  flashcard/SRS/Sunday Test core.
- **Feature detection:** a naive `'SpeechRecognition' in window` check is not reliable (Opera false-positive).
  Use a smoke test instead — start recognition, 2s timeout, no `onstart` fired = treat as unsupported.

## What shipped after the decision

- **#71** — Core STT engine (SpeechRecognition wrapper + pronunciation scorer)
- **#72** — Recording/pronunciation exercise UI in Practice/Study
- **#73** — Graceful degradation for unsupported browsers
- **#95** — `getUserMedia()` called explicitly before `.start()` (fixes Opera/cross-browser permission prompt — kept even though Opera itself remains unsupported, since other Chromium forks benefit)
- **#101** — Sunday Test: pronunciation (STT) question type added to the mix engine (Phase 14)
- **#153/#154** — Pronunciation Tool UX polish (card flip / mic permission flow ahead of Sunday Test)

## Known infra gotchas hit during the spike

- **GitHub API 403 on `stt-report.js`** — Cloudflare Workers' `fetch()` to the GitHub API needs an explicit
  `User-Agent` header or GitHub returns "Request forbidden by administrative rules" regardless of token
  scope. Fixed in commit `51335c1`. See ADR-012.
- **`env` variable name collision** in `stt-report.js` broke the Wrangler build (#96) — see ADR-007.

## Post-launch follow-ups (2026-07-08)

- **#267** — The smoke-test feature detection above still wasn't catching everything: Opera/Opera GX and
  Firefox both expose a `SpeechRecognition`-shaped object but never work reliably in practice. Rather than
  trust feature detection at all for these, `isSTTBlockedBrowser()` now sniffs `navigator.userAgent`
  (`"OPR/"`, `"Firefox/"` excluding SeaMonkey) and forces STT off unconditionally on those browsers.
- **#268** — Added microphone device selection + a calibration test (say "ชา", 33% threshold) in Settings.
  Ran into a related, previously undocumented platform limitation: `SpeechRecognition` cannot be bound to a
  specific `MediaStream`/device — it always uses the browser/OS default input, regardless of what's picked in
  a device dropdown. See ADR-015 for the full decision and how the calibration UI handles it honestly (split
  into a real per-device level-meter check + a recognition test that's necessarily device-agnostic).
