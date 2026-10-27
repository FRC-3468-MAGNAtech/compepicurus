/**
 * P7: serves the Firebase Cloud Messaging service worker at the fixed
 * `/firebase-messaging-sw.js` path FCM's web SDK expects by default — as a
 * generated Route Handler rather than a static `public/` file, since a
 * static file can't read `process.env` at request time and the Firebase
 * web config (not secret — see docs/DEPLOYMENT.md) still needs to reach
 * it somehow. `no-store` keeps a stale worker from sticking around if the
 * config ever changes.
 */
export async function GET() {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };

  const script = `
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp(${JSON.stringify(config)});

const messaging = firebase.messaging();

// Only background (tab not focused) notifications come through here — the
// in-app "Scores are available" popup (lib/notifications.ts's onMessage
// handler) covers the foreground case.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? "CompEpicurus";
  const body = payload.notification?.body ?? "Scores are available.";
  const url = payload.data?.url ?? "/";
  self.registration.showNotification(title, { body, data: { url }, icon: "/icon.png" });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(clients.openWindow(url));
});
`.trim();

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-store",
      "Service-Worker-Allowed": "/",
    },
  });
}
