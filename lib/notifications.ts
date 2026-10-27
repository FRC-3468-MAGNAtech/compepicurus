"use client";

import { arrayUnion, doc, updateDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";

export type PushRegistrationResult = { ok: true } | { ok: false; reason: "unsupported" | "denied" | "not-configured" | "error" };

/** iOS Safari (not installed to the Home Screen) can't receive web push at all — FCM's web SDK silently fails there, so the UI needs to say this explicitly rather than just "enable notifications" not working. */
export function isLikelyUnsupportedIOSBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isStandalone = "standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIOS && !isStandalone;
}

/**
 * Requests Notification permission, registers the FCM service worker, gets
 * a push token, and saves it onto `users/{uid}.fcmTokens` (an array — a
 * scout may have more than one device). `NEXT_PUBLIC_FIREBASE_VAPID_KEY`
 * must be set (Firebase Console > Project Settings > Cloud Messaging >
 * Web Push certificates) — see docs/DEPLOYMENT.md. Unverified in this
 * sandbox (no real device/browser push delivery to test against — see
 * docs/ASSUMPTIONS.md, P7); the plumbing follows Firebase's documented web
 * setup exactly.
 */
export async function requestAndRegisterPush(uid: string): Promise<PushRegistrationResult> {
  if (!isFirebaseConfigured() || typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return { ok: false, reason: "unsupported" };
  }
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) return { ok: false, reason: "not-configured" };

  try {
    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return { ok: false, reason: "unsupported" };

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const messaging = getMessaging();
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token) return { ok: false, reason: "error" };

    await updateDoc(doc(db, "users", uid), { fcmTokens: arrayUnion(token) });
    return { ok: true };
  } catch (err) {
    console.error("Push registration failed:", err);
    return { ok: false, reason: "error" };
  }
}

/** Foreground push (tab open and focused) — background messages are handled by the service worker itself (app/firebase-messaging-sw.js). Returns an unsubscribe function, or null if messaging isn't available. */
export async function onForegroundLiveScorePush(callback: (data: { sessionId?: string; title: string; body: string }) => void): Promise<(() => void) | null> {
  if (!isFirebaseConfigured() || typeof window === "undefined") return null;
  try {
    const { getMessaging, onMessage, isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return null;
    const messaging = getMessaging();
    return onMessage(messaging, (payload) => {
      callback({
        sessionId: payload.data?.sessionId,
        title: payload.notification?.title ?? "Scores are available",
        body: payload.notification?.body ?? "Your live match has been scored.",
      });
    });
  } catch (err) {
    console.error("Foreground push listener failed:", err);
    return null;
  }
}
