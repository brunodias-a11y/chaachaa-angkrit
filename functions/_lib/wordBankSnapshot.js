// Server-side word-bank snapshot generator for #369 (sub-issue of #58).
//
// Deliberately duplicates the storage-key constants and CSV column list
// from src/App.jsx (KEYS.sharedIndex/KEYS.word, WORD_EXPORT_COLUMNS) rather
// than importing across the src/functions boundary — same convention
// already established by weekly-report.js, which re-implements its own
// aggregation instead of pulling from App.jsx. Keeps each Function
// independently deployable with no bundler/shared-module surprises.
//
// Scope decision: backs up the SHARED word bank only (shared_kv), not each
// teacher's private word-index. The shared bank is the whole class's
// vocabulary and the actual asset #58 is protecting; a teacher's private
// additions are a much smaller, personal list already covered by the
// manual export (#53) whenever that teacher is at their own computer.

const SHARED_INDEX_KEY = "shared-word-index"; // must match KEYS.sharedIndex in src/App.jsx
const wordKey = (id) => `word:${id}`;          // must match KEYS.word(id) in src/App.jsx

const WORD_EXPORT_COLUMNS = ["thai", "romanization", "english", "pos", "category", "classCode", "emoji", "verified", "addedAt"];

async function pgrestGet(env, table, query) {
  const url = `${env.VITE_SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`${table} query failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function safeParse(value) {
  try { return JSON.parse(value); } catch { return null; }
}

// Fetches the shared word bank in two round trips regardless of size:
// 1) the index (list of ids), 2) every word row in one `key=in.(...)` query
// — same shape as reloadWords() in App.jsx, but batched instead of one
// storageGet() per word (that fan-out is fine for a handful of client
// reads with local caching; this runs headless on a cron, so a single
// batched query is worth the extra code).
export async function fetchWordBankSnapshot(env) {
  const idxRows = await pgrestGet(env, "shared_kv", `key=eq.${encodeURIComponent(SHARED_INDEX_KEY)}&select=value&limit=1`);
  const ids = idxRows.length ? (safeParse(idxRows[0].value) || []) : [];
  if (!ids.length) return { words: [], generatedAt: new Date().toISOString() };

  const keys = ids.map(wordKey);
  // PostgREST `in.()` needs each value wrapped in quotes when it may contain
  // special chars; word ids in this project are plain alphanumeric/uuid-ish,
  // but quoting defensively costs nothing.
  const inList = keys.map((k) => `"${k}"`).join(",");
  const rows = await pgrestGet(env, "shared_kv", `key=in.(${inList})&select=key,value`);
  const byKey = new Map(rows.map((r) => [r.key, safeParse(r.value)]));
  const words = keys.map((k) => byKey.get(k)).filter(Boolean);

  return { words, generatedAt: new Date().toISOString() };
}

function csvEscape(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Mirrors wordsToCSV() in src/App.jsx exactly (same column set/order) so a
// teacher can open a Drive backup and a manual #53 export side by side and
// see the same shape.
export function wordsToCSV(words) {
  const header = WORD_EXPORT_COLUMNS.join(",");
  const rows = words.map((w) => WORD_EXPORT_COLUMNS.map((c) => csvEscape(w[c])).join(","));
  return [header, ...rows].join("\n");
}

export function wordsToJSON(words) {
  return JSON.stringify(words, null, 2);
}
