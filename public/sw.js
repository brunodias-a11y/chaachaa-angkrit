// ============================================================
// Thai Vocab PWA — Service Worker
// Sprint 7.4 | Cache strategy:
//   - Static assets (JS/CSS/fonts) → Cache-first
//   - Supabase / OpenRouter AI      → Network-first (no offline cache)
//   - Navigation (HTML)            → Network-first, fallback to cached shell
//
// Sprint 13 fix: openrouter.ai was missing from NETWORK_ONLY_HOSTS after the
// Gemini → OpenRouter migration, so AI calls were falling through to the
// cache-first branch meant for static assets — that path is not built to
// carry POST bodies/custom headers through untouched, which surfaced as
// "401 Missing Authentication header" on PPTX import. Fixed by adding
// openrouter.ai here so AI requests always go straight to the network.
// ============================================================

const CACHE_VERSION  = "v2";
const STATIC_CACHE   = `thai-vocab-static-${CACHE_VERSION}`;
const FONT_CACHE     = `thai-vocab-fonts-${CACHE_VERSION}`;

// Assets to precache on install (adjust paths after Vite build)
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
];

// Hosts that should NEVER be served from cache
const NETWORK_ONLY_HOSTS = [
  "supabase.co",
  "googleapis.com",   // Google Fonts API
  "openrouter.ai",    // AI (Sprint 13 — Qwen 2.5 via OpenRouter)
  "cdn.jsdelivr.net",  // Supabase JS CDN
];

// ── Install: precache app shell ───────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== FONT_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: route by request type ──────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Always network for API / CDN calls (no offline caching)
  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ error: "network_unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } })));
    return;
  }

  // 2. Cache Google Fonts stylesheets and font files
  if (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  ) {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((res) => {
              cache.put(request, res.clone());
              return res;
            })
        )
      )
    );
    return;
  }

  // 3. Navigation requests: network-first, fallback to cached index.html
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/index.html").then((res) => res || caches.match("/"))
      )
    );
    return;
  }

  // 4. Static assets: cache-first (GET only — Cache API doesn't support POST)
  if (request.method !== "GET") {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          // Cache successful GET responses for future offline use
          if (response && response.status === 200 && response.type !== "opaque") {
            const clone = response.clone();
            caches
              .open(STATIC_CACHE)
              .then((cache) => cache.put(request, clone));
          }
          return response;
        })
    )
  );
});

// ── Background sync placeholder (Sprint 7.6) ──────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-progress") {
    // Progress sync on reconnect — implemented in Sprint 7.6
    console.log("[SW] Background sync: sync-progress");
  }
});

// ── Push Notifications (#573) ─────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: "Chaa Chaa Thai", body: event.data.text() }; }
  const { title = "Chaa Chaa Thai", body = "", icon = "/icons/icon-192.png", data = {} } = payload;
  event.waitUntil(
    self.registration.showNotification(title, { body, icon, badge: "/icons/icon-192.png", data })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});
