// Cloudflare Pages Function — POST /api/reset-pin
//
// feat(#518) — Self-service PIN recovery via security question.
//
// Verifies the student's security answer hash against what is stored in
// shared_kv, then resets their Supabase password to the new PIN — all
// without teacher intervention and without exposing plaintext answers.
//
// Environment variables (Cloudflare Pages → Settings → Environment variables):
//   VITE_SUPABASE_URL         — already configured for the client
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (bypasses RLS, admin auth)
//
// Request body: { username: string, answerHash: string, newPin: string (4 digits) }
// Response: { ok: true } or { ok: false, reason: string }
//
// Security notes:
//   - answerHash must be SHA-256(answer.trim().toLowerCase()), computed client-side
//   - The stored hash in shared_kv was also computed the same way at setup time
//   - Rate limiting is NOT implemented here; Cloudflare's built-in limits apply
//   - newPin is validated to be exactly 4 digits before any Supabase call

const corsHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

const PIN_PASSWORD_PREFIX = "chaa-pin-";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function onRequestPost({ request, env }) {
  const supabaseUrl     = env.VITE_SUPABASE_URL;
  const serviceRoleKey  = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, reason: "server-misconfigured" }, 500);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, reason: "invalid-request" }, 400);
  }

  const { username, answerHash, newPin } = body || {};

  if (!username || typeof username !== "string" || username.trim().length === 0) {
    return json({ ok: false, reason: "missing-username" }, 400);
  }
  if (!answerHash || typeof answerHash !== "string" || answerHash.length !== 64) {
    return json({ ok: false, reason: "invalid-hash" }, 400);
  }
  if (!newPin || !/^\d{4}$/.test(newPin)) {
    return json({ ok: false, reason: "invalid-pin" }, 400);
  }

  const slug = username.trim().toLowerCase();

  // 1. Fetch stored security question + hash from shared_kv
  const kvKey = `security-question:${slug}`;
  const kvRes = await supabaseFetch(supabaseUrl, serviceRoleKey,
    `/rest/v1/shared_kv?key=eq.${encodeURIComponent(kvKey)}&select=value`
  );

  if (!kvRes.ok) return json({ ok: false, reason: "server-error" }, 500);

  const kvRows = await kvRes.json();
  if (!Array.isArray(kvRows) || kvRows.length === 0) {
    return json({ ok: false, reason: "no-recovery-question" });
  }

  let stored;
  try { stored = typeof kvRows[0].value === "string" ? JSON.parse(kvRows[0].value) : kvRows[0].value; }
  catch { return json({ ok: false, reason: "server-error" }, 500); }

  if (!stored?.answerHash) return json({ ok: false, reason: "no-recovery-question" });

  // 2. Compare hashes (constant-time not strictly necessary here — both are hex digests)
  if (stored.answerHash !== answerHash) {
    return json({ ok: false, reason: "wrong-answer" });
  }

  // 3. Look up the user's Supabase auth id by email (we store email as username@chaa.app)
  const email = `${slug}@chaachaathai-app.com`;
  const userRes = await supabaseFetch(supabaseUrl, serviceRoleKey,
    `/auth/v1/admin/users?email=${encodeURIComponent(email)}`
  );
  if (!userRes.ok) return json({ ok: false, reason: "server-error" }, 500);

  const userBody = await userRes.json();
  const user = userBody?.users?.[0];
  if (!user?.id) return json({ ok: false, reason: "user-not-found" });

  // 4. Reset the password via the admin API
  const patchRes = await supabaseFetch(supabaseUrl, serviceRoleKey,
    `/auth/v1/admin/users/${user.id}`,
    "PUT",
    { password: `${PIN_PASSWORD_PREFIX}${newPin}` }
  );
  if (!patchRes.ok) return json({ ok: false, reason: "reset-failed" }, 500);

  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function supabaseFetch(baseUrl, serviceKey, path, method = "GET", body = null) {
  const url = `${baseUrl}${path}`;
  const init = {
    method,
    headers: {
      "apikey":        serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type":  "application/json",
      "Prefer":        "return=minimal",
    },
  };
  if (body) init.body = JSON.stringify(body);
  return fetch(url, init);
}
