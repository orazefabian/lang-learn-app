/**
 * Service worker.
 *
 * Deliberately small and hand-written. The app needs exactly three behaviours,
 * and a generated worker would bring a caching framework plus a build step for
 * rules that fit on one screen.
 *
 * 1. Navigations: network first, falling back to the offline page. Pages are
 *    server-rendered and personal, so a cached page is a lie about her deck.
 * 2. Audio: cache first. Content-hashed and immutable, and the whole point of
 *    pre-caching a session.
 * 3. Everything the app needs to boot: cached on install.
 *
 * What it never touches: server actions, the sync and bundle routes, and
 * anything under /teacher. Those are online-only by design.
 */

const VERSION = "v1";
const SHELL_CACHE = `dober-dan-shell-${VERSION}`;
const AUDIO_CACHE = "dober-dan-audio-v1";
const OFFLINE_URL = "/offline.html";

const SHELL_ASSETS = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      // A missing asset must not leave the old worker installed forever.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("dober-dan-shell-") && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Static build output: hashed filenames, safe to keep once fetched. */
function isBuildAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isAudio(url) {
  return url.pathname.startsWith("/api/media/");
}

function isOnlineOnly(url) {
  return (
    url.pathname.startsWith("/api/offline/") ||
    url.pathname.startsWith("/api/health") ||
    url.pathname.startsWith("/api/ready")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isOnlineOnly(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return (
          cached ??
          new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } })
        );
      }),
    );
    return;
  }

  if (isAudio(url)) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          // Range requests come back 206 and must not be cached as if whole.
          if (response.ok && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        } catch (error) {
          return new Response(null, { status: 504 });
        }
      }),
    );
    return;
  }

  if (isBuildAsset(url)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
  }
});

/** The page asks for a sync when it comes back online. */
self.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") self.skipWaiting();
});
