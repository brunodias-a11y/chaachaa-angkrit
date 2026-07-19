// Cloudflare Pages Function — GET /api/drive-oauth-start?uid=<supabase_uid>&username=<name>
//
// Issue #368 (sub-issue of #58, "backup automatico no Google Drive do professor").
// Step 1 of 2 in the OAuth handshake: builds Google's consent URL and 302s the
// browser there. The teacher is redirected back to Google, approves the
// drive.file scope (see ADR — #367 decided drive.file over full drive access
// to avoid Google's sensitive-scope verification process), then Google
// redirects to /api/drive-oauth-callback (this repo, see that file).
//
// Called directly by a plain link/button in Settings (no fetch + JS redirect
// needed) — Settings just renders:
//   <a href={`/api/drive-oauth-start?uid=${sbUser.id}&username=${encodeURIComponent(username)}`}>
//     Connect Google Drive
//   </a>
//
// Env vars required: GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_REDIRECT_URI,
// VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (see functions/_lib/googleDrive.js
// header comment for details on each).

import { buildAuthorizeUrl, issueOAuthNonce } from "../_lib/googleDrive.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const uid = url.searchParams.get("uid");
  const username = url.searchParams.get("username") || "";

  if (!uid) {
    return new Response("Missing uid — open this link from the Settings screen, not directly.", { status: 400 });
  }

  // Random nonce, not derived from anything guessable — the one-time-use
  // check in the callback (consumeOAuthNonce) is the actual CSRF guard, this
  // is just the value being guarded.
  const nonce = crypto.randomUUID();
  try {
    await issueOAuthNonce(env, nonce);
  } catch (e) {
    console.error("[drive-oauth-start] failed to issue nonce:", e);
    return new Response("Could not start the Google Drive connection (internal error). Please try again.", { status: 500 });
  }

  const authorizeUrl = buildAuthorizeUrl(env, { uid, username, nonce });
  return Response.redirect(authorizeUrl, 302);
}
