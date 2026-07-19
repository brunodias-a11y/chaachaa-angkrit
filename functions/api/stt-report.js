// Cloudflare Pages Function — POST /api/stt-report
//
// Receives STT test results from /stt-test.html and posts them as a comment
// on the specified GitHub issue, so test data flows directly into the
// feasibility spike sub-issues (#84, #78, #79, #83, #82) without manual
// copy-paste.
//
// Environment variables (same as report-error.js, already configured):
//   GITHUB_TOKEN        — fine-grained PAT with "Issues: Write" on the repo
//   GITHUB_REPO_OWNER   — e.g. "brunodias-a11y"
//   GITHUB_REPO_NAME    — e.g. "chaachaathai"
//
// Request body: {
//   issueNumber: number,   // target sub-issue (e.g. 84 for Chrome)
//   results: { ... }        // the full JSON export from the test page
// }
//
// Response: { ok: true, commentUrl } or { ok: false, error }

const corsHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const token = env.GITHUB_TOKEN;
  const owner = env.GITHUB_REPO_OWNER;
  const repo  = env.GITHUB_REPO_NAME;

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

  const { issueNumber, results } = body;

  if (!issueNumber || !results) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Missing issueNumber or results' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const ghApi = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'chaachaathai-stt-report',
  };

  // Build the comment body from the test results
  const envData = results.environment || {};
  const metrics = results.metrics || {};
  const offline = results.offlineTest || {};
  const config = results.testConfig || {};
  const testResults = results.results || [];
  const logEntries = results.log || [];

  const browserLine = `${envData.browser || '?'} / ${env.os || '?'}`;
  const pwaLine = envData.pwa ? 'PWA installed' : 'Browser tab';
  const srLine = envData.speechRecognition ? 'SpeechRecognition' : (envData.webkitSpeechRecognition ? 'webkitSpeechRecognition' : 'none');
  const plLine = envData.processLocallySupport ? 'supported' : 'not supported';

  // Summarize results
  const resultLines = testResults.length > 0
    ? testResults.map((r, i) => {
        const transcript = (r.transcript || '').replace(/^"|"$/g, '');
        const meta = r.meta || '';
        return `| ${i + 1} | ${transcript} | ${meta.includes('MATCH') ? '✅' : meta.includes('NO MATCH') ? '❌' : '—'} |`;
      }).join('\n')
    : '| — | — | — |';

  const logSnippet = logEntries.slice(-15).join('\n');

  const commentBody = [
    `### STT Test Results — ${results.timestamp || new Date().toISOString()}`,
    '',
    `| Field | Value |`,
    `|---|---|`,
    `| Browser / OS | ${browserLine} |`,
    `| PWA mode | ${pwaLine} |`,
    `| Online | ${envData.online ? 'yes' : 'no'} |`,
    `| API | ${srLine} |`,
    `| processLocally | ${plLine} |`,
    `| Config | lang=${config.lang || 'th-TH'}, continuous=${config.continuous ?? '?'}, interim=${config.interimResults ?? '?'}, processLocally=${config.processLocally ?? false} |`,
    '',
    `#### Metrics`,
    '',
    `| Metric | Value |`,
    `|---|---|`,
    `| Total duration | ${metrics.totalDuration || '—'} |`,
    `| Time to first result | ${metrics.timeToFirstResult || '—'} |`,
    `| Time to final result | ${metrics.timeToFinalResult || '—'} |`,
    `| Result count | ${metrics.resultCount ?? 0} |`,
    `| Average confidence | ${metrics.averageConfidence || '—'} |`,
    `| Errors | ${metrics.errorCount ?? 0} |`,
    '',
    `#### Results`,
    '',
    `| # | Transcript | Match |`,
    `|---|---|---|`,
    resultLines,
    '',
    `#### Offline test`,
    '',
    `- Network status during test: ${offline.networkStatus || '—'}`,
    `- STT worked offline: ${offline.workedOffline ? '✅ yes' : '❌ no'}`,
    '',
    '<details><summary>Event log (last 15 entries)</summary>',
    '',
    '```',
    logSnippet,
    '```',
    '',
    '</details>',
    '',
    '<details><summary>Raw JSON</summary>',
    '',
    '```json',
    JSON.stringify(results, null, 2),
    '```',
    '',
    '</details>',
    '',
    '---',
    '*Posted automatically by /stt-test.html via /api/stt-report*',
  ].join('\n');

  try {
    const res = await fetch(`${ghApi}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: commentBody }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let errMsg = 'unknown';
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson.message || errJson.error || errText.substring(0, 200);
      } catch {
        errMsg = errText.substring(0, 200) || 'unknown';
      }
      // Include response status and key headers for debugging
      const debugInfo = `GitHub API ${res.status}: ${errMsg}`;
      return new Response(
        JSON.stringify({ ok: false, error: debugInfo, ghStatus: res.status, ghBody: errMsg.substring(0, 300) }),
        { status: 200, headers: corsHeaders }
      );
    }

    const comment = await res.json();
    return new Response(
      JSON.stringify({ ok: true, commentUrl: comment.html_url }),
      { status: 200, headers: corsHeaders }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message || 'Failed to post comment' }),
      { status: 200, headers: corsHeaders }
    );
  }
}
