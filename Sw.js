// DingleProxy Background Engine
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Intercept requests starting with /service/
    if (url.pathname.startsWith('/service/')) {
        const targetUrl = decodeURIComponent(url.pathname.replace('/service/', ''));

        // Use a CORS engine to bypass school blocks
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;

        event.respondWith(
            fetch(proxyUrl)
                .then(res => res.json())
                .then(data => {
                    return new Response(data.contents, {
                        headers: { 'Content-Type': 'text/html' }
                    });
                })
                .catch(err => new Response("Proxy Error: " + err, { status: 500 }))
        );
    }
});
