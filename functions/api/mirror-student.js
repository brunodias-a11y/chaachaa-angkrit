// Cloudflare Pages Function — POST /api/mirror-student
//
// feat(#749) — Full personal_kv mirror so the teacher can read any student
// data field without needing a dedicated endpoint per field.
//
// Reads ALL rows from personal_kv for the given student (via service role key,
// bypassing RLS) and writes them as a flat { key: value } object into
// student-data:<username> in shared_kv.
//
// The StudentDetailModal calls this on open, then reads student-data:<username>
// once to get everything: wallet, calligraphy progress, sessions, streak, etc.
//
// Environment variables (Cloudflare Pages → Settings → Environment variables):
//   VITE_SUPABASE_URL         — already configured for the client
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (bypasses RLS, admin auth)
//
// Request body: { username: string }
// Response: { ok: true, count: number } or { ok: false, reason: string }

const CORS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};


export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  const supabaseUrl    = env.VITE_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, reason: "server-misconfigured" }, 500);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, reason: "invalid-request" }, 400);
  }

  const username = (body?.username ?? "").trim().toLowerCase();
  if (!username) return json({ ok: false, reason: "missing-username" }, 400);

  // 1. Resolve user_id directly from personal_kv (service role bypasses RLS).
  // The GoTrue admin users endpoint does not support filtering by email, so we
  // query personal_kv.username instead — no Admin API needed.
  const userRes = await sbFetch(supabaseUrl, serviceRoleKey,
    `/rest/v1/personal_kv?username=ilike.${encodeURIComponent(username)}&key=eq.profile&select=user_id&limit=1`);
  if (!userRes.ok) return json({ ok: false, reason: "server-error" }, 500);

  const userRows = await userRes.json();
  const userId   = userRows?.[0]?.user_id;
  if (!userId) return json({ ok: false, reason: "user-not-found" }, 404);

  // 2. Read ALL personal_kv rows for this user (paginate in 1000-row chunks)
  const data = {};
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const res = await sbFetch(supabaseUrl, serviceRoleKey,
      `/rest/v1/personal_kv?user_id=eq.${userId}&select=key,value&limit=${PAGE}&offset=${offset}`);
    if (!res.ok) return json({ ok: false, reason: "server-error" }, 500);

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      data[row.key] = parseVal(row.value);
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  // 3. Upsert the full blob to shared_kv as student-data:<username>
  const mirrorKey = `student-data:${username}`;
  const blob      = { ...data, _mirroredAt: Date.now() };

  const upsertRes = await sbFetch(supabaseUrl, serviceRoleKey,
    `/rest/v1/shared_kv?on_conflict=key`,
    "POST",
    { key: mirrorKey, value: JSON.stringify(blob), updated_at: new Date().toISOString() },
    { Prefer: "resolution=merge-duplicates,return=minimal" });

  if (!upsertRes.ok) {
    const errText = await upsertRes.text().catch(() => "");
    console.error("[mirror-student] upsert failed:", upsertRes.status, errText);
    return json({ ok: false, reason: "upsert-failed" }, 500);
  }

  return json({ ok: true, count: Object.keys(data).length });
}

// ---------------------------------------------------------------------------

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function parseVal(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

async function sbFetch(baseUrl, serviceKey, path, method = "GET", body = null, extraHeaders = {}) {
  const init = {
    method,
    headers: {
      "apikey":        serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type":  "application/json",
      "Prefer":        "return=minimal",
      ...extraHeaders,
    },
  };
  if (body) init.body = JSON.stringify(body);
  return fetch(`${baseUrl}${path}`, init);
}
