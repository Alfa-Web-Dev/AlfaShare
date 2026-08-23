const CACHE_NAME = "alfashare-v3";

const APP_SHELL = [
    "/",
    "/index.html",
    "/manifest.json",
    "/css/style.css",
    "/js/app.js",
    "/icon.svg"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") {
        return;
    }

    const requestURL = new URL(event.request.url);

    // API, Socket.IO aur server requests ko cache mat karo.
    if (
        requestURL.pathname.startsWith("/socket.io/") ||
        requestURL.pathname.startsWith("/api/")
    ) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                return cached;
            }

            return fetch(event.request)
                .then(response => {
                    if (
                        !response ||
                        response.status !== 200 ||
                        response.type === "opaque"
                    ) {
                        return response;
                    }

                    const copy = response.clone();

                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, copy);
                    });

                    return response;
                })
                .catch(() => {
                    return caches.match("/index.html");
                });
        })
    );
});
