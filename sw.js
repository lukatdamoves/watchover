// WatchOver Service Worker for Push Notifications
const CACHE_NAME = 'watchover-v1';

// Handle push events from server
// Handle push events from server
self.addEventListener('push', function (event) {
    console.log('[SW DEBUG] Push event received', event);
    if (!event.data) {
        console.log('[SW DEBUG] Push event has no data');
        return;
    }

    try {
        const data = event.data.json();
        console.log('[SW DEBUG] Push data:', data);

        const options = {
            body: data.body || 'Location updated',
            icon: '/favicon_icons/android-chrome-192x192.png',
            badge: '/favicon_icons/favicon-32x32.png',
            vibrate: [200, 100, 200],
            tag: 'watchover-location',
            renotify: true,
            requireInteraction: false,
            data: {
                url: data.url || '/dashboard/dashboard.html',
                device_id: data.device_id
            }
        };

        event.waitUntil(
            self.registration.showNotification(data.title || 'WatchOver', options)
                .then(() => console.log('[SW DEBUG] Notification shown'))
        );
    } catch (e) {
        console.error('[SW DEBUG] Push processing error:', e);
        // Fallback for plain text or empty data
        event.waitUntil(
            self.registration.showNotification('WatchOver', {
                body: event.data ? event.data.text() : 'Location updated',
                icon: '/favicon_icons/android-chrome-192x192.png',
                vibrate: [200, 100, 200]
            })
        );
    }
});

// Handle notification click - open dashboard
self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    const urlToOpen = event.notification.data?.url || '/dashboard/dashboard.html';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function (clientList) {
                // Check if dashboard is already open
                for (const client of clientList) {
                    if (client.url.includes('/dashboard/') && 'focus' in client) {
                        return client.focus();
                    }
                }
                // If not open, open new window
                if (clients.openWindow) {
                    return clients.openWindow(urlToOpen);
                }
            })
    );
});


// Service worker installation
self.addEventListener('install', function (event) {
    self.skipWaiting();
});

// Service worker activation
self.addEventListener('activate', function (event) {
    event.waitUntil(clients.claim());
});
