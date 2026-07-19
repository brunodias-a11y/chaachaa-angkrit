// Cloudflare Pages Function — POST /api/send-weekly-report
//
// Issue #335 (sub-issue of #54, "relatório semanal do professor"). Takes the
// JSON from #334's aggregation (imported directly, no HTTP round-trip),
// renders a simple HTML email (v1 scope: text + numbers, not a pretty
// template) and sends it via Resend to TEACHER_NOTIFICATION_MAIL. Does NOT
// run on a schedule — that's #336, which will just POST to this endpoint
// (not to /api/weekly-report) since this is the one that actually delivers.
//
// Environment variables (Cloudflare Pages → Settings → Environment variables):
//   (everything #334 already needs: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
//   WEEKLY_REPORT_SECRET      — reused as-is from #334, same `X-Report-Secret`
//                                header gate (this endpoint fires a real email,
//                                so it needs the same protection, not less).
//   RESEND_API_KEY            — NEW. From resend.com/api-keys after Bruno
//                                creates a Resend account (free tier: 3,000
//                                emails/month, 100/day — plenty for 1x/week).
//   TEACHER_NOTIFICATION_MAIL — already configured (used elsewhere too) —
//                                the recipient.
//   RESEND_FROM_ADDRESS        — optional, defaults to Resend's shared test
//                                address `onboarding@resend.dev`. IMPORTANT
//                                caveat documented below.
//
// Resend's `onboarding@resend.dev` sandbox address can ONLY deliver to the
// email address the Resend account itself was signed up with — sending to
// any other address 403s (this is a Resend restriction, not a bug here). So
// v1 only works out of the box if TEACHER_NOTIFICATION_MAIL is the same
// email Bruno used to sign up for Resend. Once he verifies his own sending
// domain in the Resend dashboard, set RESEND_FROM_ADDRESS (e.g.
// "reports@yourdomain.com") to send to any teacher email — no code change
// needed, just the env var.
//
// Request: POST, empty body, header `X-Report-Secret: <WEEKLY_REPORT_SECRET>`
// Response: { ok: true, emailId } or { ok: false, error }

import { getPreviousWeekRange, fetchReportRows, computeWeeklyReport } from './weekly-report.js';

const corsHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Report-Secret',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function listOrNone(arr, formatter = x => esc(x)) {
  if (!arr || arr.length === 0) return '<em>None 🎉</em>';
  return arr.map(formatter).join(', ');
}

// Plain, readable HTML — deliberately not fancy (v1 scope per #335). Inline
// styles only, since email clients strip <style> blocks unpredictably.
export function renderReportEmailHtml(data) {
  const rowStyle = 'padding:4px 0;';
  const h2Style = 'margin:20px 0 8px;font-size:16px;color:#333;';
  return `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:600px;">
  <h1 style="font-size:20px;margin-bottom:4px;">📊 Chaa Chaa Thai — Weekly Report</h1>
  <p style="color:#666;margin-top:0;">${esc(data.weekStart)} – ${esc(data.weekEnd)}</p>

  <h2 style="${h2Style}">Engagement</h2>
  <p style="${rowStyle}">${data.engagement.activeThisWeek} / ${data.engagement.totalStudents} students active this week</p>
  <p style="${rowStyle}">${data.newlyMasteredCount} words newly mastered this week</p>
  <p style="${rowStyle}">${data.dbHealth.newWordsThisWeek} new words added to the word bank this week</p>

  <h2 style="${h2Style}">⚠️ Alerts</h2>
  <p style="${rowStyle}"><b>Inactive 7+ days:</b> ${listOrNone(data.alerts.inactiveSevenPlusDays)}</p>
  <p style="${rowStyle}"><b>Streak currently broken:</b> ${listOrNone(data.alerts.brokenStreaks)}</p>
  <p style="${rowStyle}"><b>Missed Sunday Test this week:</b> ${listOrNone(data.alerts.missedSundayTest)}</p>

  <h2 style="${h2Style}">🏆 Highlights</h2>
  <p style="${rowStyle}">${data.highlights.highestStreak ? `Longest streak: <b>${esc(data.highlights.highestStreak.username)}</b> (${data.highlights.highestStreak.streak} days)` : 'No streaks yet'}</p>
  <p style="${rowStyle}">${data.highlights.highestBerserk ? `Berserk Mode leader: <b>${esc(data.highlights.highestBerserk.username)}</b> (${data.highlights.highestBerserk.tiersCleared}/3 tiers cleared)` : 'No Berserk Mode clears yet'}</p>

  <h2 style="${h2Style}">😾 Berserk Mode this week</h2>
  <p style="${rowStyle}"><b>Tiers cleared:</b> ${listOrNone(data.berserk.tiersClearedThisWeek, t => `${esc(t.username)} (${esc(t.tier)})`)}</p>
  <p style="${rowStyle}"><b>Achievements unlocked:</b> ${listOrNone(data.berserk.achievementsUnlockedThisWeek, a => `${esc(a.username)} — ${esc(a.title)}`)}</p>
  <p style="${rowStyle}">${data.berserk.attemptsThisWeek > 0 ? `${data.berserk.attemptsThisWeek} attempts, ${data.berserk.clearsThisWeek} cleared (${data.berserk.successRatePct}% success rate)` : '<em>No attempts this week</em>'}</p>

  <h2 style="${h2Style}">🔤 Top 10 hardest words this week (most "don't recall")</h2>
  ${data.topDontRecallWords.length === 0 ? '<p><em>No data yet</em></p>' : `
  <table style="border-collapse:collapse;width:100%;">
    <tr style="text-align:left;border-bottom:1px solid #ddd;">
      <th style="padding:4px 8px 4px 0;">Thai</th><th style="padding:4px 8px 4px 0;">English</th><th style="padding:4px 0;">Missed</th>
    </tr>
    ${data.topDontRecallWords.map(w => `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:4px 8px 4px 0;">${esc(w.thai)}</td>
      <td style="padding:4px 8px 4px 0;">${esc(w.english)}</td>
      <td style="padding:4px 0;">${w.dontRecallCount}</td>
    </tr>`).join('')}
  </table>`}

  <h2 style="${h2Style}">🗂️ Thinnest categories</h2>
  <p style="${rowStyle}">${listOrNone(data.dbHealth.thinnestCategories, c => `${esc(c.category)} (${c.count})`)}</p>

  <p style="color:#999;font-size:12px;margin-top:24px;">Automated weekly report — chaachaathai</p>
</div>`.trim();
}

async function sendViaResend(env, html, weekLabel) {
  const from = env.RESEND_FROM_ADDRESS || 'onboarding@resend.dev';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: env.TEACHER_NOTIFICATION_MAIL,
      subject: `Chaa Chaa Thai — Weekly Report (${weekLabel})`,
      html,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${body.message || JSON.stringify(body)}`);
  }
  return body;
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
  if (!env.RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Server not configured (missing RESEND_API_KEY)' }),
      { status: 200, headers: corsHeaders }
    );
  }
  if (!env.TEACHER_NOTIFICATION_MAIL) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Server not configured (missing TEACHER_NOTIFICATION_MAIL)' }),
      { status: 200, headers: corsHeaders }
    );
  }

  const range = getPreviousWeekRange();

  try {
    const rows = await fetchReportRows(env);
    const data = computeWeeklyReport(rows, range);
    const html = renderReportEmailHtml(data);
    const weekLabel = `${data.weekStart} – ${data.weekEnd}`;
    const sent = await sendViaResend(env, html, weekLabel);
    return new Response(JSON.stringify({ ok: true, emailId: sent.id || null, data }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message || String(e) }), { status: 200, headers: corsHeaders });
  }
}
