// Cloudflare Pages Function — POST /api/drive-backup
//
// Issue #369 (sub-issue of #58), depends on #368 (OAuth already implemented).
// The actual backup engine: fetches the shared word bank, refreshes each
// connected teacher's Drive access token, and uploads a JSON + CSV snapshot
// into their "Chaa Chaa Thai Backups" folder. Two call modes so #370's
// scheduling piece and manual testing/"Backup now" buttons share one
// implementation:
//
//   { "uid": "<teacher_supabase_uid>" }   — back up just that one teacher
//   { "all": true }                        — back up every connected teacher
//                                            (this is what #370's cron calls)
//
// Auth: same shared-secret header pattern as weekly-report.js — this reads
// (and writes storage for) every connected teacher in one shot, so it must
// not be triggerable by anyone who just finds the URL.
//   Header: X-Backup-Secret: <DRIVE_BACKUP_SECRET>
//
// Env vars: everything from functions/_lib/googleDrive.js, plus:
//   DRIVE_BACKUP_SECRET — NEW, any random string you choose (like
//                          WEEKLY_REPORT_SECRET but scoped separately —
//                          least-privilege: a leaked report secret shouldn't
//                          also be able to trigger Drive writes)

import {
  listConnectedTeachers,
  refreshAccessToken,
  findOrCreateBackupFolder,
  uploadFileToDriveFolder,
  upsertPersonalKV,
  DRIVE_AUTH_KEY,
} from "../_lib/googleDrive.js";
import { fetchWordBankSnapshot, wordsToCSV, wordsToJSON } from "../_lib/wordBankSnapshot.js";

const corsHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, X-Backup-Secret",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Backs up one teacher: refresh token -> ensure folder -> upload both
// formats -> stamp lastBackupAt/lastBackupOk. Every failure is caught and
// recorded on that teacher's own row rather than throwing, so one teacher's
// expired/revoked grant can't abort the whole "all" run for everyone else.
async function backupOneTeacher(env, { userId, username, driveAuth }) {
  try {
    const { access_token } = await refreshAccessToken(env, driveAuth.refreshToken);
    const folderId = await findOrCreateBackupFolder(access_token);
    const { words, generatedAt } = await fetchWordBankSnapshot(env);
    const stamp = todayStr();

    await uploadFileToDriveFolder(access_token, folderId, {
      name: `wordbank-${stamp}.json`,
      mimeType: "application/json",
      content: wordsToJSON(words),
    });
    await uploadFileToDriveFolder(access_token, folderId, {
      name: `wordbank-${stamp}.csv`,
      mimeType: "text/csv",
      content: wordsToCSV(words),
    });

    await upsertPersonalKV(env, {
      userId,
      username,
      key: DRIVE_AUTH_KEY,
      value: { ...driveAuth, lastBackupAt: generatedAt, lastBackupOk: true, lastBackupError: null },
    });
    return { userId, ok: true, wordCount: words.length };
  } catch (e) {
    console.error(`[drive-backup] failed for user ${userId}:`, e);
    // Best-effort status write — if even this fails, the teacher just won't
    // see an updated "last backup" timestamp, which is self-evidently stale.
    await upsertPersonalKV(env, {
      userId,
      username,
      key: DRIVE_AUTH_KEY,
      value: { ...driveAuth, lastBackupOk: false, lastBackupError: String(e?.message || e) },
    }).catch(() => {});
    return { userId, ok: false, error: String(e?.message || e) };
  }
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get("x-backup-secret") !== env.DRIVE_BACKUP_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: corsHeaders });
  }

  let payload;
  try { payload = await request.json(); } catch { payload = {}; }

  try {
    const rows = await listConnectedTeachers(env);
    if (!rows.length) {
      return new Response(JSON.stringify({ ok: true, results: [] }), { headers: corsHeaders });
    }

    const targets = payload.all
      ? rows
      : rows.filter((r) => r.user_id === payload.uid);

    if (!payload.all && !targets.length) {
      return new Response(JSON.stringify({ ok: false, error: "uid not connected to Google Drive" }), { status: 404, headers: corsHeaders });
    }

    const results = [];
    for (const row of targets) {
      const driveAuth = JSON.parse(row.value);
      results.push(await backupOneTeacher(env, { userId: row.user_id, username: row.username, driveAuth }));
    }

    return new Response(JSON.stringify({ ok: true, results }), { headers: corsHeaders });
  } catch (e) {
    console.error("[drive-backup] fatal:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: corsHeaders });
  }
}
