import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// #748 — capture errors from event handlers and unhandled promise rejections.
// ErrorBoundary only catches render errors; this fills the gap for onClick/async.
(function setupGlobalErrorHandlers() {
  // Debounce: suppress duplicate reports of the same message within 2s.
  const _seen = new Map(); // message → timestamp
  function shouldReport(message) {
    const now = Date.now();
    const last = _seen.get(message);
    if (last && now - last < 2000) return false;
    _seen.set(message, now);
    // Prune old entries to avoid memory leak
    if (_seen.size > 50) {
      const oldest = [..._seen.entries()].sort((a, b) => a[1] - b[1])[0][0];
      _seen.delete(oldest);
    }
    return true;
  }

  function sendReport(message, stack) {
    if (!shouldReport(message)) return;
    try {
      const w = window;
      fetch("/api/report-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          stack:          stack || null,
          componentStack: null,
          tab:            w.__currentTab  || "unknown",
          userType:       w.__userType    || "unknown",
          screen:         w.__screen      || w.__currentTab || "unknown",
          breadcrumbs:    w.__breadcrumbs ? [...w.__breadcrumbs] : [],
          viewport:       `${window.innerWidth}x${window.innerHeight}`,
          userAgent:      navigator.userAgent,
          url:            window.location.href,
          timestamp:      new Date().toISOString(),
          appVersion:     null,
        }),
      }).catch(() => {});
    } catch {}
  }

  // Uncaught errors in event handlers, scripts, etc.
  window.addEventListener("error", (event) => {
    const filename = event.filename || "";
    // Ignore errors with no filename (browser extensions injecting into the page)
    if (!filename) return;
    // Ignore cross-origin scripts (extensions, third-party widgets)
    if (!filename.includes(window.location.hostname) && !filename.includes("localhost")) return;
    const message = event.error?.message || event.message || "Unknown error";
    const stack   = event.error?.stack   || null;
    // Skip uninformative "Unknown error" with no stack — nothing actionable
    if (message === "Unknown error" && !stack) return;
    sendReport(message, stack);
  }, true);

  // Unhandled promise rejections (async functions without catch)
  window.addEventListener("unhandledrejection", (event) => {
    const reason  = event.reason;
    const message = reason?.message || String(reason) || "Unhandled promise rejection";
    const stack   = reason?.stack   || null;
    sendReport(message, stack);
  });
})();

// Register service worker on load
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => console.warn("SW registration failed"));
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
