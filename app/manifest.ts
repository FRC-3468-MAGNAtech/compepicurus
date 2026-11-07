import type { MetadataRoute } from "next";

// The web app manifest (P17): lets the site be added to a phone's Home Screen and run
// standalone — which iOS *requires* before it will deliver web push (FCM). It only
// describes the app; it registers no service worker, so it coexists with the Firebase
// Messaging worker already served at /firebase-messaging-sw.js (app/firebase-messaging-sw.js/route.ts).

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CompEpicurus — FTC Scouting",
    short_name: "CompEpicurus",
    description: "A scouting app for FTC teams.",
    // Signed-out visitors are sent to the login page from here.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#17070c",
    theme_color: "#17070c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
