/* ==========================================================================
 * OpenCodeABsUI/UX — Service Worker
 *
 * Cache-first for static assets, network-first for navigation/API.
 * Versioned via CACHE_NAME for easy invalidation.
 * ==========================================================================
 * @version 2026-07-29
 */

const CACHE_NAME = "opencodeabs-ux-v1";
const STATIC_CACHE = CACHE_NAME + "-static";

// Assets to pre-cache on install (immutable hashed files)
const PRECACHE_URLS = [
  "/",
  "/site.webmanifest",
  "/favicon.svg",
  "/globe-icon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

/* ------------------------------------------------------------------ */
/*  Install — pre-cache critical static resources                      */
/* ------------------------------------------------------------------ */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // Activate immediately — don't wait for reload
      return self.skipWaiting();
    })
  );
});

/* ------------------------------------------------------------------ */
/*  Activate — clean up old caches                                     */
/* ------------------------------------------------------------------ */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key.startsWith("opencodeabs-ux-"))
          .map((key) => caches.delete(key))
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

/* ------------------------------------------------------------------ */
/*  Fetch — intelligent cache strategy                                 */
/* ------------------------------------------------------------------ */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and non-http(s) requests
  if (request.method !== "GET" || !url.protocol.startsWith("http")) return;

  // ---- API calls: Network-only (no cache) ----
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // ---- Cloudflare function routes: Network-first ----
  if (url.pathname.startsWith("/auth/") ||
      url.pathname.startsWith("/installations") ||
      url.pathname.startsWith("/login") ||
      url.pathname.startsWith("/callback")) {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // ---- Hashed assets (JS, CSS, images in /assets/): Cache-first ----
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ---- Static public files: Cache-first ----
  if (url.pathname === "/" ||
      url.pathname === "/index.html" ||
      url.pathname.endsWith(".webmanifest") ||
      url.pathname.endsWith(".svg") ||
      url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".ico")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ---- Navigation (SPA routes): Network-first ----
  // This handles all React Router routes like /ag, /community, /users, etc.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstWithFallback(request));
    return;
  }

  // ---- Everything else: Network-first ----
  event.respondWith(networkFirstWithFallback(request));
});

/* ------------------------------------------------------------------ */
/*  Cache strategies                                                   */
/* ------------------------------------------------------------------ */

/**
 * Cache-first: serve from cache if available, else fetch + cache.
 * Best for immutable assets (hashed JS/CSS).
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      // Don't cache opaque responses (CORS failures)
      if (response.type === "basic" || response.type === "cors") {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (error) {
    // Offline: return cached index.html for navigation, or fail
    if (request.mode === "navigate") {
      const fallback = await caches.match("/");
      if (fallback) return fallback;
    }
    throw error;
  }
}

/**
 * Network-first: try network, fall back to cache if offline.
 * Best for navigation, API calls, and dynamic content.
 */
async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request);
    // Cache successful responses for offline fallback
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      if (response.type === "basic" || response.type === "cors") {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // For navigation, serve the app shell (index.html)
    if (request.mode === "navigate") {
      const fallback = await caches.match("/");
      if (fallback) return fallback;
    }
    throw error;
  }
}
