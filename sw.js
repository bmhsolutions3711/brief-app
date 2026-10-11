const VERSION = "brief-shell-v9";

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
