// ---------------------------------------------------------------------------
// Unified storage API — Supabase (shared_kv / personal_kv) with Artifact fallback.
// Extracted from App.jsx (Phase 21 refactor) so lessonPath.jsx and future
// feature modules can import storage directly without going through App.jsx.
// ---------------------------------------------------------------------------

const USE_SUPABASE      = import.meta.env.VITE_USE_SUPABASE !== "false";
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Catalog Supabase — read-only client pointing to ChaaChaaThai's project.
// Used exclusively to fetch the shared avatar catalog (shared_kv key
// "avatar-custom-catalog") so both apps always show the same cats.
// Falls back to the local client when the vars are absent (dev / demo mode).
const CATALOG_SUPABASE_URL      = import.meta.env.VITE_CATALOG_SUPABASE_URL;
const CATALOG_SUPABASE_ANON_KEY = import.meta.env.VITE_CATALOG_SUPABASE_ANON_KEY;

let _sbClient      = null;
let _catalogClient = null;
let _sbUser   = null;
let _currentUsername = null;

// Issue #251 — lightweight last-error tracker for shared_kv reads.
let _lastSharedKvError = null;

// Issue #729 — fire once per session so App.jsx can redirect to Login.
let _sessionExpiredFired = false;
function _notifySessionExpired() {
  if (_sessionExpiredFired) return;
  _sessionExpiredFired = true;
  window.dispatchEvent(new CustomEvent("sb:session-expired"));
}
function _isAuthError(error) {
  if (!error) return false;
  return error.status === 401 || /jwt expired|invalid jwt|not authenticated/i.test(error.message || "");
}

export function getLastSharedKvError() { return _lastSharedKvError; }
export { getCatalogSupabaseClient };

// Read a shared_kv key from ChaaChaaThai's Supabase (catalog client).
// Drop-in replacement for storageGet(key, true) on keys that are
// globally configured in ChaaChaaThai and shared across ChaaChaa products
// (banner featured avatars, banner art, Hearthbound config, event art).
export async function catalogStorageGet(key) {
  if (USE_SUPABASE) {
    try {
      const client = await getCatalogSupabaseClient();
      const { data, error } = await client.from("shared_kv").select("value").eq("key", key).maybeSingle();
      if (error) { console.error("[catalogStorageGet] failed for key:", key, error.message); return null; }
      return data ? JSON.parse(data.value) : null;
    } catch (e) { console.error("[catalogStorageGet] exception for key:", key, e); return null; }
  }
  try {
    const res = await window.storage?.get(key, true);
    return res ? JSON.parse(res.value) : null;
  } catch { return null; }
}
export function getCurrentUsername() { return _currentUsername; }
export function getStorageUser() { return _sbUser; }

// Called by App.jsx after every login/signup and on logout (pass null, null).
export function setStorageAuthState(user, username) {
  _sbUser          = user;
  _currentUsername = username;
}

export async function getSupabaseClient() {
  if (_sbClient) return _sbClient;
  if (!window._supabaseLoaded) {
    await new Promise((res, rej) => {
      if (window.supabase) { window._supabaseLoaded = true; return res(); }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.onload  = () => { window._supabaseLoaded = true; res(); };
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  // persistSession: false — we manage one session per *username* ourselves
  // (see saveSession/restoreSession) instead of supabase-js's single global
  // session, because several students can share one device/browser.
  _sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: true }
  });
  // When autoRefreshToken fires in the background it produces a new session
  // that is only in memory (persistSession: false). Without this listener the
  // refreshed tokens are never written back to localStorage, so the next page
  // load tries the already-consumed refresh token and forces a re-login.
  _sbClient.auth.onAuthStateChange((event, session) => {
    if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && session && _currentUsername) {
      const slug = _currentUsername.trim().toLowerCase().replace(/\s+/g, "-");
      try {
        localStorage.setItem(`sb-session:${slug}`, JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }));
      } catch (_) {}
    }
  });
  return _sbClient;
}

// Returns a Supabase client pointed at ChaaChaaThai's project for catalog reads.
// Falls back to the local client when VITE_CATALOG_SUPABASE_URL is not set.
async function getCatalogSupabaseClient() {
  if (!CATALOG_SUPABASE_URL || !CATALOG_SUPABASE_ANON_KEY) return getSupabaseClient();
  if (_catalogClient) return _catalogClient;
  await getSupabaseClient(); // ensures the supabase-js script is loaded
  _catalogClient = window.supabase.createClient(CATALOG_SUPABASE_URL, CATALOG_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return _catalogClient;
}

export async function storageGet(key, shared) {
  if (USE_SUPABASE) {
    try {
      const client = await getSupabaseClient();
      if (shared) {
        const { data, error } = await client.from("shared_kv").select("value").eq("key", key).maybeSingle();
        if (error) { console.error("[storageGet] shared_kv failed for key:", key, error.message); return null; }
        return data ? JSON.parse(data.value) : null;
      } else {
        if (!_sbUser) return null;
        const { data, error } = await client.from("personal_kv")
          .select("value").eq("user_id", _sbUser.id).eq("key", key).maybeSingle();
        if (error) { if (_isAuthError(error)) _notifySessionExpired(); console.error("[storageGet] personal_kv failed for key:", key, error.message); return null; }
        return data ? JSON.parse(data.value) : null;
      }
    } catch (e) { console.error("[storageGet] exception for key:", key, e); return null; }
  }
  try {
    const res = await window.storage.get(key, shared);
    return res ? JSON.parse(res.value) : null;
  } catch (e) { return null; }
}

// Issue #251 — safe variant that surfaces read failures instead of masking
// them as null. Use for read-merge-write on shared records to avoid silent
// overwrites when a transient failure returns null.
export async function storageGetSafe(key, shared) {
  if (USE_SUPABASE) {
    try {
      const client = await getSupabaseClient();
      if (shared) {
        const { data, error } = await client.from("shared_kv").select("value").eq("key", key).maybeSingle();
        if (error) return { value: null, error: error.message };
        return { value: data ? JSON.parse(data.value) : null, error: null };
      } else {
        if (!_sbUser) return { value: null, error: null };
        const { data, error } = await client.from("personal_kv")
          .select("value").eq("user_id", _sbUser.id).eq("key", key).maybeSingle();
        if (error) { if (_isAuthError(error)) _notifySessionExpired(); return { value: null, error: error.message }; }
        return { value: data ? JSON.parse(data.value) : null, error: null };
      }
    } catch (e) { return { value: null, error: String(e?.message || e) }; }
  }
  try {
    const res = await window.storage.get(key, shared);
    return { value: res ? JSON.parse(res.value) : null, error: null };
  } catch (e) { return { value: null, error: String(e?.message || e) }; }
}

export async function storageSet(key, value, shared) {
  if (USE_SUPABASE) {
    try {
      const client = await getSupabaseClient();
      const json = JSON.stringify(value);
      if (shared) {
        const { error } = await client.from("shared_kv").upsert(
          { key, value: json, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );
        if (error) { console.error("[storageSet] shared_kv failed for key:", key, error.message); return false; }
      } else {
        if (!_sbUser) return false;
        const { error } = await client.from("personal_kv").upsert(
          { user_id: _sbUser.id, username: _currentUsername, key, value: json, updated_at: new Date().toISOString() },
          { onConflict: "user_id,key" }
        );
        if (error) { if (_isAuthError(error)) _notifySessionExpired(); console.error("[storageSet] personal_kv failed for key:", key, error.message); return false; }
      }
      return true;
    } catch (e) { console.error("[storageSet] exception for key:", key, e); return false; }
  }
  try {
    await window.storage.set(key, JSON.stringify(value), shared);
    return true;
  } catch (e) { return false; }
}

export async function storageList(prefix, shared) {
  if (USE_SUPABASE) {
    try {
      const client = await getSupabaseClient();
      if (shared) {
        const { data, error } = await client.from("shared_kv").select("key").like("key", `${prefix}%`);
        if (error) {
          console.error("[storageList] shared_kv failed for prefix:", prefix, error.message);
          _lastSharedKvError = error.message;
          return [];
        }
        _lastSharedKvError = null;
        return data?.map(r => r.key) || [];
      } else {
        if (!_sbUser) return [];
        const { data, error } = await client.from("personal_kv")
          .select("key").eq("user_id", _sbUser.id).like("key", `${prefix}%`);
        if (error) { if (_isAuthError(error)) _notifySessionExpired(); console.error("[storageList] personal_kv failed for prefix:", prefix, error.message); return []; }
        return data?.map(r => r.key) || [];
      }
    } catch (e) { console.error("[storageList] exception for prefix:", prefix, e); return []; }
  }
  try {
    const res = await window.storage.list(prefix, shared);
    return res?.keys || [];
  } catch (e) { return []; }
}

export async function storageDelete(key, shared) {
  if (USE_SUPABASE) {
    try {
      const client = await getSupabaseClient();
      if (shared) {
        const { error } = await client.from("shared_kv").delete().eq("key", key);
        if (error) { console.error("[storageDelete] shared_kv failed for key:", key, error.message); return false; }
      } else {
        if (!_sbUser) return false;
        const { error } = await client.from("personal_kv").delete().eq("user_id", _sbUser.id).eq("key", key);
        if (error) { console.error("[storageDelete] personal_kv failed for key:", key, error.message); return false; }
      }
      return true;
    } catch (e) { console.error("[storageDelete] exception for key:", key, e); return false; }
  }
  try {
    await window.storage.delete(key, shared);
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------------------
// S0 Energy system (#430)
// ---------------------------------------------------------------------------

export const S0_ENERGY_MAX  = 20;
export const S0_ENERGY_COST = 2;
const S0_ENERGY_KEY    = "s0-energy";
const S0_REFILL_MS     = 15 * 60 * 1000; // 1 point per 15 min

// #705 — progressive energy cost: increases with each NEW lesson completed today
const PATH_NEW_LESSONS_TODAY_KEY = "path-new-lessons-today";
function _todayLocalStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
export function getProgressiveEnergyCost(lessonsToday) {
  if (lessonsToday === 0) return { amount: 2, every: 5 };
  if (lessonsToday === 1) return { amount: 3, every: 5 };
  if (lessonsToday === 2) return { amount: 4, every: 4 };
  if (lessonsToday === 3) return { amount: 5, every: 4 };
  return { amount: 5, every: 3 };
}
export async function getNewLessonsToday() {
  const stored = await storageGet(PATH_NEW_LESSONS_TODAY_KEY, false);
  if (!stored || stored.date !== _todayLocalStr()) return 0;
  return stored.count || 0;
}
export async function incrementNewLessonsToday() {
  const today = _todayLocalStr();
  const stored = await storageGet(PATH_NEW_LESSONS_TODAY_KEY, false);
  const count = (stored?.date === today ? (stored.count || 0) : 0) + 1;
  await storageSet(PATH_NEW_LESSONS_TODAY_KEY, { date: today, count }, false);
}

// #572 — effectiveMax allows cat power (energyMaxBonus) to raise the refill cap
export function calcS0Energy({ current, lastUpdatedAt }, effectiveMax = S0_ENERGY_MAX) {
  if (current > effectiveMax) return current; // bonus above cap drains naturally
  const passiveGain = Math.floor((Date.now() - lastUpdatedAt) / S0_REFILL_MS);
  return Math.min(effectiveMax, current + passiveGain);
}

export async function getS0Energy(effectiveMax = S0_ENERGY_MAX) {
  const stored = await storageGet(S0_ENERGY_KEY, false);
  if (!stored) return effectiveMax; // new student starts full
  return calcS0Energy(stored, effectiveMax);
}

// Deduct cost. Returns true if successful, false if insufficient energy.
export async function spendS0Energy(amount = S0_ENERGY_COST) {
  const stored = await storageGet(S0_ENERGY_KEY, false) || { current: S0_ENERGY_MAX, lastUpdatedAt: Date.now() };
  const effective = calcS0Energy(stored);
  if (effective < amount) return false;
  await storageSet(S0_ENERGY_KEY, { current: Math.max(0, effective - amount), lastUpdatedAt: Date.now() }, false);
  return true;
}

// Add bonus energy (no cap — activity bonus can exceed 20).
export async function addS0Energy(amount) {
  const stored = await storageGet(S0_ENERGY_KEY, false) || { current: S0_ENERGY_MAX, lastUpdatedAt: Date.now() };
  const effective = calcS0Energy(stored);
  await storageSet(S0_ENERGY_KEY, { current: effective + amount, lastUpdatedAt: Date.now() }, false);
}

// ---------------------------------------------------------------------------
// Upload a File to Supabase Storage and return its public URL.
// bucket — e.g. "lesson-assets"
// pathPrefix — e.g. "tips/" (optional, defaults to "")
export async function storageUpload(file, bucket, pathPrefix = "") {
  const client = await getSupabaseClient();
  // persistSession:false loses the in-memory session after autoRefreshToken runs.
  // Re-apply from localStorage before any storage op (same fix as #444 for banner art).
  if (_currentUsername) {
    const slug = _currentUsername.trim().toLowerCase().replace(/\s+/g, "-");
    const raw = localStorage.getItem(`sb-session:${slug}`);
    if (raw) {
      try {
        const { access_token, refresh_token } = JSON.parse(raw);
        await client.auth.setSession({ access_token, refresh_token });
      } catch {}
    }
  }
  const ext  = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${pathPrefix}${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await client.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = client.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// ---------------------------------------------------------------------------
// #737 — Student ID: HMAC-SHA256(user_id, "almost") → 8 uppercase hex chars
// Deterministic, non-reversible without the key, collision-safe at any class size.
// ---------------------------------------------------------------------------
export async function generateStudentCode(userId) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode("almost"),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(userId));
  return Array.from(new Uint8Array(sig))
    .slice(0, 4)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export { USE_SUPABASE };
