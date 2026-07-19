// Cloudflare Pages Function — GET /api/drive-oauth-callback?code=...&state=...
//
// Issue #368 (sub-issue of #58). Step 2 of 2 in the OAuth handshake: Google
// redirects here after the teacher approves (or denies) the drive.file
// consent screen started by /api/drive-oauth-start.js.
//
// On success: exchanges the authorization `code` for tokens, stores the
// refresh_token in personal_kv under the DRIVE_AUTH_KEY key (written via the
// Supabase service role key, since this Function has no Supabase session/JWT
// for the teacher — see functions/_lib/googleDrive.js header comment), then
// redirects the browser back into the app with a query flag the Settings
// screen can read to show a success/error toast.
//
// Env vars: same as drive-oauth-start.js, see functions/_lib/googleDrive.js.

import {
  decodeState,
  consumeOAuthNonce,
  exchangeCodeForTokens,
  upsertPersonalKV,
  DRIVE_AUTH_KEY,
} from "../_lib/googleDrive.js";

// Where to send the browser back to after the flow finishes, success or not.
// Kept as an env var (not hardcoded) since the production domain isn't
// committed anywhere else in this repo either (custom domain is configured
// directly in the Cloudflare dashboard) — falls back to relative "/" so a
// missing env var still redirects somewhere sane instead of 500ing.
function appUrl(env, path) {
  const base = env.APP_BASE_URL || "";
  return `${base}${path}`;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    // Teacher clicked "Cancel" on Google's consent screen — not a bug.
    return Response.redirect(appUrl(env, `/?driveBackup=denied`), 302);
  }
  if (!code || !state) {
    return new Response("Missing code/state from Google redirect.", { status: 400 });
  }

  let uid, username, nonce;
  try {
    ({ uid, username, nonce } = decodeState(state));
  } catch (e) {
    return new Response("Invalid state parameter.", { status: 400 });
  }

  const nonceOk = await consumeOAuthNonce(env, nonce);
  if (!nonceOk) {
    return new Response("This connection link expired or was already used. Go back to Settings and try again.", { status: 400 });
  }

  try {
    const tokens = await exchangeCodeForTokens(env, code);
    if (!tokens.refresh_token) {
      // Happens if the teacher had already granted consent before and Google
      // didn't re-issue a refresh_token despite prompt=consent — extremely
      // rare given we always force prompt=consent, but fail loud rather than
      // silently storing a connection that can't actually refresh later.
      throw new Error("Google did not return a refresh_token (no offline access granted).");
    }

    await upsertPersonalKV(env, {
      userId: uid,
      username,
      key: DRIVE_AUTH_KEY,
      value: {
        refreshToken: tokens.refresh_token,
        scope: tokens.scope,
        connectedAt: new Date().toISOString(),
        lastBackupAt: null,   // set by drive-backup.js (#369) after each run
        lastBackupOk: null,
      },
    });

    return Response.redirect(appUrl(env, `/?driveBackup=connected`), 302);
  } catch (e) {
    console.error("[drive-oauth-callback] failed:", e);
    return Response.redirect(appUrl(env, `/?driveBackup=error`), 302);
  }
}
