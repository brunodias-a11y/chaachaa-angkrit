// Shared helpers for the Google Drive backup feature (#58 -> #367-#370).
// Leading underscore folder = Cloudflare Pages Functions ignores it for
// routing, so this is a plain importable module, not an endpoint.
//
// Env vars used (Cloudflare Pages -> Settings -> Environment variables):
//   GOOGLE_DRIVE_CLIENT_ID       — OAuth 2.0 Client ID (Web application), see #367
//   GOOGLE_DRIVE_CLIENT_SECRET   — OAuth 2.0 Client Secret, see #367
//   GOOGLE_DRIVE_REDIRECT_URI    — must exactly match the Authorized redirect
//                                   URI configured in Google Cloud Console,
//                                   e.g. https://chaachaathai.com/api/drive-oauth-callback
//   VITE_SUPABASE_URL            — reused from the client config (Cloudflare
//                                   exposes every env var to Functions)
//   SUPABASE_SERVICE_ROLE_KEY    — same key already used by weekly-report.js;
//                                   needed because these Functions write to
//                                   personal_kv on behalf of a teacher who
//                                   isn't "logged in" from the Function's
//                                   point of view (no Supabase JWT to attach)

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_AUTH_KEY = "driveAuth"; // personal_kv key, one row per teacher

// ---------------------------------------------------------------------------
// Minimal PostgREST client — same raw-fetch pattern as weekly-report.js's
// pgrest(), duplicated (not imported) on purpose: keeps each function
// independently deployable without a shared runtime import graph surprise.
// ---------------------------------------------------------------------------
async function pgrestRequest(env, method, table, { query = "", body, headers = {} } = {}) {
  const url = `${env.VITE_SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${table} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Upsert a personal_kv row on behalf of a specific teacher (by Supabase
// auth user_id), bypassing RLS via the service role key. Mirrors the
// (user_id, key) unique index + onConflict target that the client-side
// storageSet() already relies on, so this is read back correctly by the
// normal storageGet('driveAuth', false) from inside the app.
export async function upsertPersonalKV(env, { userId, username, key, value }) {
  return pgrestRequest(env, "POST", "personal_kv", {
    query: "on_conflict=user_id,key",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: {
      user_id: userId,
      username,
      key,
      value: JSON.stringify(value),
      updated_at: new Date().toISOString(),
    },
  });
}

export async function getPersonalKV(env, { userId, key }) {
  const rows = await pgrestRequest(env, "GET", "personal_kv", {
    query: `user_id=eq.${encodeURIComponent(userId)}&key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
  });
  if (!rows || !rows.length) return null;
  try { return JSON.parse(rows[0].value); } catch { return null; }
}

export async function deletePersonalKV(env, { userId, key }) {
  const url = `${env.VITE_SUPABASE_URL}/rest/v1/personal_kv?user_id=eq.${encodeURIComponent(userId)}&key=eq.${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`DELETE personal_kv failed: ${res.status} ${await res.text()}`);
}

// One-time nonce so /drive-oauth-callback can confirm the redirect really
// came from a /drive-oauth-start we issued (basic CSRF guard), without
// needing session/cookie state. Stored in shared_kv (already RLS-open to
// the anon key for reads elsewhere in the app; Functions use the service
// role key here regardless) with a short TTL enforced by timestamp check,
// not a DB expiry column — good enough for a low-traffic, single-teacher
// action button.
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function issueOAuthNonce(env, nonce) {
  await pgrestRequest(env, "POST", "shared_kv", {
    query: "on_conflict=key",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: { key: `driveOAuthNonce:${nonce}`, value: JSON.stringify({ ts: Date.now() }), updated_at: new Date().toISOString() },
  });
}

export async function consumeOAuthNonce(env, nonce) {
  const rows = await pgrestRequest(env, "GET", "shared_kv", {
    query: `key=eq.${encodeURIComponent(`driveOAuthNonce:${nonce}`)}&select=value&limit=1`,
  });
  // Always attempt cleanup, valid or not — one-time use either way.
  const url = `${env.VITE_SUPABASE_URL}/rest/v1/shared_kv?key=eq.${encodeURIComponent(`driveOAuthNonce:${nonce}`)}`;
  await fetch(url, {
    method: "DELETE",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  }).catch(() => {});
  if (!rows || !rows.length) return false;
  try {
    const { ts } = JSON.parse(rows[0].value);
    return typeof ts === "number" && Date.now() - ts <= NONCE_TTL_MS;
  } catch { return false; }
}

// Cloudflare Workers/Pages Functions run on workerd, not Node.js — no global
// `Buffer`. Same base64url encode/decode approach already used by tts.js in
// this repo (btoa/atob), extended to be UTF-8 safe (teacher usernames can
// contain Thai/Portuguese characters) and URL-safe (+/  and padding replaced,
// since this value travels inside a URL query string).
function base64UrlEncode(obj) {
  const json = JSON.stringify(obj);
  const binary = unescape(encodeURIComponent(json)); // UTF-8 -> Latin1 binary string
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(state) {
  const padded = state.replace(/-/g, "+").replace(/_/g, "/").padEnd(state.length + ((4 - (state.length % 4)) % 4), "=");
  const binary = atob(padded);
  const json = decodeURIComponent(escape(binary)); // Latin1 binary string -> UTF-8
  return JSON.parse(json);
}

export function buildAuthorizeUrl(env, { uid, username, nonce }) {
  const state = base64UrlEncode({ uid, username, nonce });
  const params = new URLSearchParams({
    client_id: env.GOOGLE_DRIVE_CLIENT_ID,
    redirect_uri: env.GOOGLE_DRIVE_REDIRECT_URI,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline", // required to get a refresh_token back
    prompt: "consent",      // forces refresh_token on every connect, even re-connects
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function decodeState(state) {
  return base64UrlDecode(state);
}

export async function exchangeCodeForTokens(env, code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_DRIVE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, expires_in, scope, token_type }
}

// Reused by #369 (drive-backup.js) — a stored refresh_token never expires
// (unless revoked) and is exchanged for a short-lived access_token on every
// backup run rather than cached, since backups only happen weekly (#370).
export async function refreshAccessToken(env, refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_DRIVE_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, expires_in, scope, token_type } — no new refresh_token
}

// ---------------------------------------------------------------------------
// Google Drive API v3 — used by #369 (drive-backup.js) to actually write the
// snapshot into the teacher's Drive. Kept in this file (not wordBankSnapshot.js)
// since it's OAuth-token-authenticated Drive plumbing, not word-bank logic.
// ---------------------------------------------------------------------------

const BACKUP_FOLDER_NAME = "Chaa Chaa Thai Backups";

// With the drive.file scope, this app can only ever see files/folders it
// created itself via the API — so a plain files.list search for our folder
// name is safe (won't collide with some unrelated folder of the same name
// elsewhere in the teacher's Drive) and is the correct way to make repeat
// backups land in the same folder instead of creating a new one every run.
export async function findOrCreateBackupFolder(accessToken) {
  const q = encodeURIComponent(`name='${BACKUP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) throw new Error(`Drive files.list failed: ${listRes.status} ${await listRes.text()}`);
  const { files } = await listRes.json();
  if (files && files.length) return files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!createRes.ok) throw new Error(`Drive folder create failed: ${createRes.status} ${await createRes.text()}`);
  const { id } = await createRes.json();
  return id;
}

// Simple multipart upload (metadata + content in one request) — the word
// bank is small (a class vocabulary list, not media), so the resumable
// upload protocol Google recommends for large files is unnecessary here.
export async function uploadFileToDriveFolder(accessToken, folderId, { name, mimeType, content }) {
  const boundary = "chaachaathai_backup_" + crypto.randomUUID();
  const metadata = JSON.stringify({ name, parents: [folderId] });
  const body =
    `--${boundary}
` +
    `Content-Type: application/json; charset=UTF-8

` +
    `${metadata}
` +
    `--${boundary}
` +
    `Content-Type: ${mimeType}

` +
    `${content}
` +
    `--${boundary}--`;

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive file upload failed: ${res.status} ${await res.text()}`);
  return res.json(); // { id, name }
}

// All teachers with a stored driveAuth row — used by the "run for everyone"
// mode (#370's cron calls this), and incidentally by a manual "run now"
// call too since there's no reason to have two separate query shapes.
export async function listConnectedTeachers(env) {
  return pgrestRequest(env, "GET", "personal_kv", {
    query: `key=eq.${encodeURIComponent(DRIVE_AUTH_KEY)}&select=user_id,username,value`,
  });
}
