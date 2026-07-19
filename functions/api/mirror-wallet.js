// Cloudflare Pages Function — POST /api/mirror-wallet
//
// feat(#746) — Server-side wallet mirror so the teacher can see a student's
// current coins and tickets without waiting for the student to log in.
//
// The student's wallet lives in personal_kv (RLS-protected by auth.uid).
// The teacher cannot read it directly. This function runs with the service
// role key, which bypasses RLS, reads the three wallet keys from personal_kv,
// and writes the result to shared_kv as student-wallet:<username> — the same
// format that mirrorStudentWallet() writes client-side (#739).
//
// Environment variables (Cloudflare Pages → Settings → Environment variables):
//   VITE_SUPABASE_URL         — already configured for the client
//   SUPABASE_SERVICE_ROLE_KEY — service_role key (bypasses RLS, admin auth)
//
// Request body: { username: string }
// Response: { ok: true, wallet: { coins, tickets, hearthboundTickets } }
//        or { ok: false, reason: string }

const CORS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};


const COINS_KEY          = "coins-balance";
const GACHA_TICKETS_KEY  = "gacha-tickets";
const HB_TICKETS_KEY     = "hearthbound-tickets";

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
  const userId = userRows?.[0]?.user_id;
  if (!userId) return json({ ok: false, reason: "user-not-found" }, 404);

  // 2. Read the three wallet keys from personal_kv (service role bypasses RLS)
  const keys = [COINS_KEY, GACHA_TICKETS_KEY, HB_TICKETS_KEY];
  const kvRes = await sbFetch(supabaseUrl, serviceRoleKey,
    `/rest/v1/personal_kv?user_id=eq.${userId}&key=in.(${keys.map(encodeURIComponent).join(",")})&select=key,value`);
  if (!kvRes.ok) return json({ ok: false, reason: "server-error" }, 500);

  const rows = await kvRes.json();
  const byKey = Object.fromEntries((rows || []).map(r => [r.key, r.value]));

  const coins             = parseVal(byKey[COINS_KEY], 0);
  const tickets           = parseVal(byKey[GACHA_TICKETS_KEY], { rare: 0, epic: 0, banner: 0 });
  const hearthboundTickets = parseVal(byKey[HB_TICKETS_KEY], 0);

  const wallet = { coins, tickets, hearthboundTickets, mirroredAt: Date.now() };

  // 3. Upsert mirror to shared_kv
  const mirrorKey  = `student-wallet:${username}`;
  const upsertRes  = await sbFetch(supabaseUrl, serviceRoleKey,
    `/rest/v1/shared_kv?on_conflict=key`,
    "POST",
    { key: mirrorKey, value: JSON.stringify(wallet), updated_at: new Date().toISOString() },
    { Prefer: "resolution=merge-duplicates,return=minimal" });

  if (!upsertRes.ok) {
    const errText = await upsertRes.text().catch(() => "");
    console.error("[mirror-wallet] upsert failed:", upsertRes.status, errText);
  }

  return json({ ok: true, wallet });
}

// ---------------------------------------------------------------------------

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function parseVal(raw, fallback) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return fallback; }
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
