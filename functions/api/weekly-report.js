// Cloudflare Pages Function — POST /api/weekly-report
//
// Issue #334 (sub-issue of #54, "relatório semanal do professor"). This is
// only the AGGREGATION ENGINE — it computes every number for the previous
// week (Monday..Sunday) and returns JSON. It does NOT send an email (#335)
// and does NOT run on a schedule (#336) — those are separate sub-issues on
// purpose, so each piece can be tested independently.
//
// Environment variables (Cloudflare Pages → Settings → Environment variables):
//   VITE_SUPABASE_URL          — already configured for the client; Cloudflare
//                                 exposes every env var (regardless of the
//                                 VITE_ prefix) to Functions too, so this is
//                                 reused as-is, no duplicate var needed.
//   SUPABASE_SERVICE_ROLE_KEY  — NEW. Supabase dashboard → Settings → API →
//                                 service_role key (secret, bypasses RLS).
//                                 Needed because this reads EVERY student's
//                                 data in one shot, not just the caller's own
//                                 row like the app's anon-key queries do.
//   WEEKLY_REPORT_SECRET       — NEW. Any random string you choose. Required
//                                 as the `x-report-secret` request header —
//                                 this endpoint returns aggregate data for
//                                 the whole class, so it must not be
//                                 triggerable by anyone who just finds the
//                                 URL.
//
// Request: POST, empty body, header `X-Report-Secret: <WEEKLY_REPORT_SECRET>`
// Response: { ok: true, data: {...} } or { ok: false, error }

const corsHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Report-Secret',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function pad2(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }

// The week that just ended: previous Monday 00:00 UTC .. previous Sunday
// 23:59:59.999 UTC. Using UTC boundaries (not the teacher's local timezone)
// keeps this deterministic regardless of where the Cron Trigger in #336
// ends up running from — a report is a weekly digest, not a precise ledger,
// so a few hours of boundary fuzz doesn't matter.
export function getPreviousWeekRange(now = new Date()) {
  const day = now.getUTCDay(); // 0=Sun..6=Sat
  const diffToMonday = (day + 6) % 7; // days since the most recent Monday
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
  const prevMonday = new Date(thisMonday.getTime());
  prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
  const prevSundayEnd = new Date(thisMonday.getTime() - 1); // 1ms before this Monday
  return {
    start: prevMonday,
    end: prevSundayEnd,
    startStr: toDateStr(prevMonday),
    endStr: toDateStr(prevSundayEnd),
  };
}

async function pgrest(env, table, query) {
  const url = `${env.VITE_SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`${table} query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

// Issue #335 — extracted so send-weekly-report.js can reuse the exact same
// fetch (roster + stats + progress + words) without an extra HTTP round-trip
// to this endpoint; it just imports this + computeWeeklyReport directly.
export async function fetchReportRows(env) {
  const [rosterRows, statsRows, progRows, wordRows] = await Promise.all([
    pgrest(env, 'shared_kv', 'key=like.roster:*&select=key,value'),
    pgrest(env, 'shared_kv', 'key=like.student-stats:*&select=key,value'),
    pgrest(env, 'personal_kv', 'key=like.p:*&select=username,key,value'),
    // Only shared (class) words are pooled here — private/personal words
    // belong to one student/teacher and aren't meant to feed a class-wide
    // "top missed words" list.
    pgrest(env, 'shared_kv', 'key=like.word:*&select=key,value'),
  ]);
  const roster = rosterRows.map(r => safeParse(r.value)).filter(Boolean);
  return { roster, statsRows, progRows, wordRows };
}

// Exported so the standalone test harness can feed it fixture rows without
// re-implementing the whole PostgREST fetch/auth dance.
export function computeWeeklyReport({ roster, statsRows, progRows, wordRows }, range) {
  const statsByUsername = {};
  for (const r of statsRows) {
    const v = safeParse(r.value);
    if (v && v.username) statsByUsername[v.username] = v;
  }

  const wordById = {};
  for (const r of wordRows) {
    const v = safeParse(r.value);
    if (v && v.id) wordById[v.id] = v;
  }

  const totalStudents = roster.length;
  const activeThisWeek = roster.filter(s => {
    const st = statsByUsername[s.username];
    return st && st.lastActive && st.lastActive >= range.start.getTime();
  }).length;

  // Words newly mastered this week (#338's masteredAt) + top dontRecallCount
  // words (#333), both derived from the SAME single personal_kv scan.
  let newlyMasteredCount = 0;
  const dontRecallTotals = {};
  for (const row of progRows) {
    const v = safeParse(row.value);
    if (!v) continue;
    if (v.masteredAt && v.masteredAt >= range.startStr && v.masteredAt <= range.endStr) newlyMasteredCount++;
    if (v.dontRecallCount > 0) {
      const wordId = row.key.slice(2); // "p:<id>" -> "<id>"
      dontRecallTotals[wordId] = (dontRecallTotals[wordId] || 0) + v.dontRecallCount;
    }
  }
  const topDontRecallWords = Object.entries(dontRecallTotals)
    .map(([wordId, count]) => ({
      wordId,
      thai: wordById[wordId]?.thai || null,
      english: wordById[wordId]?.english || null,
      dontRecallCount: count,
    }))
    .sort((a, b) => b.dontRecallCount - a.dontRecallCount)
    .slice(0, 10);

  // Alerts
  const inactiveSevenPlusDays = roster
    .filter(s => {
      const st = statsByUsername[s.username];
      if (!st || !st.lastActive) return true; // registered but never once active
      return (range.end.getTime() - st.lastActive) >= 7 * 24 * 60 * 60 * 1000;
    })
    .map(s => s.username);

  // Approximation (documented in #338/#334): there is no persisted "streak
  // broke on date X" event, only the CURRENT streak count. A student is
  // flagged here if they've genuinely engaged before (wordsAttempted > 0)
  // but their streak is 0 right now — a useful weekly nudge, even if it
  // isn't perfectly "broke exactly during this week".
  const brokenStreaks = roster
    .filter(s => {
      const st = statsByUsername[s.username];
      return st && st.wordsAttempted > 0 && (st.streak || 0) === 0;
    })
    .map(s => s.username);

  const missedSundayTest = roster
    .filter(s => {
      const st = statsByUsername[s.username];
      if (!st || !st.lastSundayTestDate) return true;
      return st.lastSundayTestDate < range.startStr;
    })
    .map(s => s.username);

  // Highlights
  const highestStreak = roster
    .map(s => ({ username: s.username, streak: statsByUsername[s.username]?.streak || 0 }))
    .sort((a, b) => b.streak - a.streak)[0] || null;

  const highestBerserk = roster
    .map(s => {
      const bs = statsByUsername[s.username]?.berserkStars || {};
      const tiersCleared = ['easy', 'medium', 'hard'].filter(t => bs[t]).length;
      return { username: s.username, tiersCleared };
    })
    .filter(x => x.tiersCleared > 0)
    .sort((a, b) => b.tiersCleared - a.tiersCleared)[0] || null;

  // Issue #56 — Berserk Mode weekly deltas (who advanced a tier / unlocked an
  // achievement THIS WEEK, plus this week's overall attempts + success rate),
  // as opposed to `highestBerserk` above which is current overall state.
  // Sourced from the same statsRows already fetched — #57 mirrors
  // berserkStars (now clear TIMESTAMPS, not booleans, since #56's App.jsx
  // change) plus two new mirrored fields, berserkAchievementUnlocks and
  // berserkAttemptLog (see updateSharedStats/appendSharedBerserkAttempt/
  // appendSharedBerserkAchievements in App.jsx).
  const BERSERK_ACHIEVEMENT_TITLES = {
    berserk_start: 'Going Berserk',
    berserk_easy: 'Smart Cat',
    berserk_medium: 'Word-aholic',
    berserk_hard: 'Khun Phra!',
  };
  const tiersClearedThisWeek = [];
  const achievementsUnlockedThisWeek = [];
  let berserkAttemptsThisWeek = 0;
  let berserkClearsThisWeek = 0;
  for (const s of roster) {
    const st = statsByUsername[s.username];
    if (!st) continue;

    const bs = st.berserkStars || {};
    for (const tier of ['easy', 'medium', 'hard']) {
      const clearedAt = bs[tier];
      if (typeof clearedAt === 'number' && clearedAt >= range.start.getTime() && clearedAt <= range.end.getTime()) {
        tiersClearedThisWeek.push({ username: s.username, tier, clearedAt });
      }
    }

    const achMap = st.berserkAchievementUnlocks || {};
    for (const [achId, unlockedAt] of Object.entries(achMap)) {
      if (typeof unlockedAt === 'number' && unlockedAt >= range.start.getTime() && unlockedAt <= range.end.getTime()) {
        achievementsUnlockedThisWeek.push({ username: s.username, achievementId: achId, title: BERSERK_ACHIEVEMENT_TITLES[achId] || achId, unlockedAt });
      }
    }

    const log = Array.isArray(st.berserkAttemptLog) ? st.berserkAttemptLog : [];
    for (const entry of log) {
      if (typeof entry?.ts === 'number' && entry.ts >= range.start.getTime() && entry.ts <= range.end.getTime()) {
        berserkAttemptsThisWeek++;
        if (entry.cleared) berserkClearsThisWeek++;
      }
    }
  }
  const berserkSuccessRatePct = berserkAttemptsThisWeek > 0
    ? Math.round((berserkClearsThisWeek / berserkAttemptsThisWeek) * 100)
    : null;

  // DB health
  const newWordsThisWeek = Object.values(wordById).filter(
    w => typeof w.addedAt === 'number' && w.addedAt >= range.start.getTime() && w.addedAt <= range.end.getTime()
  ).length;

  const categoryWordCount = {};
  for (const w of Object.values(wordById)) {
    const cat = w.category || 'uncategorized';
    categoryWordCount[cat] = (categoryWordCount[cat] || 0) + 1;
  }
  const thinnestCategories = Object.entries(categoryWordCount)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.count - b.count)
    .slice(0, 5);

  return {
    weekStart: range.startStr,
    weekEnd: range.endStr,
    engagement: { totalStudents, activeThisWeek },
    newlyMasteredCount,
    topDontRecallWords,
    alerts: { inactiveSevenPlusDays, brokenStreaks, missedSundayTest },
    highlights: { highestStreak, highestBerserk },
    berserk: {
      tiersClearedThisWeek,
      achievementsUnlockedThisWeek,
      attemptsThisWeek: berserkAttemptsThisWeek,
      clearsThisWeek: berserkClearsThisWeek,
      successRatePct: berserkSuccessRatePct,
    },
    dbHealth: { newWordsThisWeek, thinnestCategories },
  };
}

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.VITE_SUPABASE_URL) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Server not configured (missing Supabase env vars)' }),
      { status: 200, headers: corsHeaders }
    );
  }
  if (!env.WEEKLY_REPORT_SECRET || request.headers.get('x-report-secret') !== env.WEEKLY_REPORT_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const range = getPreviousWeekRange();

  try {
    const rows = await fetchReportRows(env);
    const data = computeWeeklyReport(rows, range);
    return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), { status: 200, headers: corsHeaders });
  }
}
