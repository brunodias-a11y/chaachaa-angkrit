/**
 * Copies avatar-powers-config from ChaaChaaThai's Supabase (shared_kv)
 * into chaachaa-angkrit's Supabase (shared_kv).
 *
 * Run once:  node scripts/copy-powers.mjs
 * Requires:  @supabase/supabase-js  (npm i -D @supabase/supabase-js)
 *
 * Reads from .env in the project root — no extra files needed.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// Parse .env manually (no dotenv dependency needed)
function loadEnv(filePath) {
  const vars = {};
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      vars[key] = val;
    }
  } catch { /* file not found — rely on process.env */ }
  return vars;
}

const env = { ...loadEnv(resolve(__dir, "../.env")), ...process.env };

const CATALOG_URL      = env.VITE_CATALOG_SUPABASE_URL;
const CATALOG_ANON_KEY = env.VITE_CATALOG_SUPABASE_ANON_KEY;
const ANGKRIT_URL      = env.VITE_SUPABASE_URL;
const ANGKRIT_SVC_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;

if (!CATALOG_URL || !CATALOG_ANON_KEY || !ANGKRIT_URL || !ANGKRIT_SVC_KEY) {
  console.error("Missing env vars. Check .env for VITE_CATALOG_SUPABASE_URL, VITE_CATALOG_SUPABASE_ANON_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const KEY = "avatar-powers-config";

const src  = createClient(CATALOG_URL,  CATALOG_ANON_KEY, { auth: { persistSession: false } });
const dest = createClient(ANGKRIT_URL,  ANGKRIT_SVC_KEY,  { auth: { persistSession: false } });

// Read from ChaaChaaThai
const { data: srcRow, error: srcErr } = await src.from("shared_kv").select("value").eq("key", KEY).maybeSingle();
if (srcErr) { console.error("Read from ChaaChaaThai failed:", srcErr.message); process.exit(1); }
if (!srcRow) { console.error(`Key "${KEY}" not found in ChaaChaaThai shared_kv.`); process.exit(1); }

console.log("Read from ChaaChaaThai OK — powers entries:", Object.keys(JSON.parse(srcRow.value)).length);

// Write to angkrit
const { error: destErr } = await dest.from("shared_kv").upsert(
  { key: KEY, value: srcRow.value, updated_at: new Date().toISOString() },
  { onConflict: "key" }
);
if (destErr) { console.error("Write to angkrit failed:", destErr.message); process.exit(1); }

console.log(`Done — "${KEY}" copied to chaachaa-angkrit shared_kv.`);
