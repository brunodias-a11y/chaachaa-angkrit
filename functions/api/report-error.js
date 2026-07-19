// Cloudflare Pages Function — POST /api/report-error
//
// Receives error details from the client-side ErrorBoundary and creates a
// GitHub issue automatically, so crashes are tracked without manual reporting.
//
// Environment variables (set in Cloudflare Pages → Settings → Environment variables):
//   GITHUB_TOKEN        — a fine-grained PAT with "Issues: Write" on the repo
//   GITHUB_REPO_OWNER   — e.g. "brunodias-a11y"
//   GITHUB_REPO_NAME    — e.g. "chaachaathai"
//
// Request body: {
//   message:        string,         // error.message
//   stack:          string | null,  // error.stack (sanitized)
//   componentStack: string | null,  // React componentStack
//   tab:            string,         // which tab crashed
//   userAgent:      string,         // navigator.userAgent
//   url:            string,         // window.location.href
//   timestamp:      string,         // ISO string
//   appVersion:     string | null   // build hash or version if available
// }
//
// Response: { ok: true, issueNumber, issueUrl } or { ok: false, error }
//
// Deduplication: a fingerprint hash of message+tab is used as a GitHub label.
// If an open issue with the same fingerprint already exists, a comment is
// appended with the new occurrence instead of creating a duplicate.

const corsHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return 'err_' + Math.abs(h).toString(36);
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '\n…(truncated)' : str;
}

export async function onRequestPost({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const token     = env.GITHUB_TOKEN;
  const owner     = env.GITHUB_REPO_OWNER;
  const repo      = env.GITHUB_REPO_NAME;
  const milestone = env.GITHUB_MILESTONE ? parseInt(env.GITHUB_MILESTONE, 10) : 12;

  if (!token || !owner || !repo) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Server not configured for GitHub issue reporting' }),
      { status: 200, headers: corsHeaders }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid JSON' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const { message, stack, componentStack, tab, userType, screen, breadcrumbs, viewport, userAgent, url, timestamp, appVersion } = body;

  if (!message) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Missing error message' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const fingerprint = simpleHash((message || '') + '|' + (tab || 'unknown'));
  const shortMsg = truncate(message, 200);
  const ghApi = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'chaachaathai-error-reporter/1.0',
  };

  // 1. Search for an existing open issue with the same fingerprint label
  let existingIssue = null;
  try {
    const searchRes = await fetch(
      `https://api.github.com/search/issues?q=repo:${owner}/${repo}+label:${fingerprint}+is:open+is:issue`,
      { headers }
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.total_count > 0) {
        existingIssue = searchData.items[0];
      }
    }
  } catch { /* search failed — proceed to create a new issue */ }

  const occurrenceTime = timestamp || new Date().toISOString();

  const breadcrumbLines = Array.isArray(breadcrumbs) && breadcrumbs.length > 0
    ? breadcrumbs.map(b => `  ${b.ts ? b.ts.slice(11, 19) : '??:??:??'} — ${b.action}`).join('\n')
    : '  (none)';

  if (existingIssue) {
    // 2a. Post a comment on the existing issue with this new occurrence
    const commentBody = [
      `### Recurrence — ${occurrenceTime}`,
      '',
      `**User type:** ${userType || 'unknown'} | **Screen:** ${screen || tab || 'unknown'} | **Viewport:** ${viewport || 'unknown'}`,
      `**URL:** ${truncate(url || '', 200)}`,
      `**User-Agent:** ${truncate(userAgent || '', 300)}`,
      appVersion ? `**App version:** ${appVersion}` : '',
      '',
      '<details><summary>Breadcrumbs (last actions before crash)</summary>',
      '',
      '```',
      breadcrumbLines,
      '```',
      '',
      '</details>',
      '',
      '<details><summary>Error stack</summary>',
      '',
      '```',
      truncate(stack || '(no stack)', 3000),
      '```',
      '',
      '</details>',
      '',
      '<details><summary>Component stack</summary>',
      '',
      '```',
      truncate(componentStack || '(no component stack)', 3000),
      '```',
      '',
      '</details>',
    ].filter(Boolean).join('\n');

    try {
      await fetch(`${ghApi}/issues/${existingIssue.number}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: commentBody }),
      });
      return new Response(
        JSON.stringify({ ok: true, issueNumber: existingIssue.number, issueUrl: existingIssue.html_url, deduplicated: true }),
        { status: 200, headers: corsHeaders }
      );
    } catch (e) {
      // Fall through to creating a new issue
    }
  }

  // 2b. Create a new issue
  const issueTitle = `[Auto-reported] ${shortMsg}`;
  const issueBody = [
    `### Client-side error auto-reported by ErrorBoundary`,
    '',
    `**First seen:** ${occurrenceTime}`,
    `**User type:** ${userType || 'unknown'} | **Screen:** ${screen || tab || 'unknown'} | **Viewport:** ${viewport || 'unknown'}`,
    `**URL:** ${truncate(url || '', 200)}`,
    `**User-Agent:** ${truncate(userAgent || '', 300)}`,
    appVersion ? `**App version:** ${appVersion}` : '',
    '',
    '---',
    '',
    '### Breadcrumbs (last actions before crash)',
    '',
    '```',
    breadcrumbLines,
    '```',
    '',
    '---',
    '',
    '### Error',
    '',
    '```',
    truncate(message, 1000),
    '```',
    '',
    '<details><summary>Stack trace</summary>',
    '',
    '```',
    truncate(stack || '(no stack)', 4000),
    '```',
    '',
    '</details>',
    '',
    '<details><summary>Component stack</summary>',
    '',
    '```',
    truncate(componentStack || '(no component stack)', 4000),
    '```',
    '',
    '</details>',
    '',
    '---',
    '*This issue was created automatically by the ErrorBoundary. Additional occurrences will be added as comments.*',
  ].filter(Boolean).join('\n');

  try {
    const createRes = await fetch(`${ghApi}/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: issueTitle,
        body: issueBody,
        labels: ['bug', 'auto-reported', fingerprint],
        milestone,
      }),
    });

    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ ok: false, error: `GitHub API ${createRes.status}: ${errData.message || 'unknown'}` }),
        { status: 200, headers: corsHeaders }
      );
    }

    const issue = await createRes.json();
    return new Response(
      JSON.stringify({ ok: true, issueNumber: issue.number, issueUrl: issue.html_url }),
      { status: 200, headers: corsHeaders }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message || 'Failed to create issue' }),
      { status: 200, headers: corsHeaders }
    );
  }
}
