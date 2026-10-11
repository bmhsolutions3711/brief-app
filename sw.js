const VERSION = "brief-shell-v10";

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "VERSION") {
    e.source && e.source.postMessage({ type: "VERSION", version: VERSION });
  }
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

// A fetch handler is required for Android to install the app.
// Do not call respondWith. Catching the document request is what
// made the installed app fail to open.
self.addEventListener("fetch", () => {});
