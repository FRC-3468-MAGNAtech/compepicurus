"use client";

import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

export type ReauthMethod = "password" | "google" | null;

/** How the signed-in user can prove it's them again: their password, or a Google popup. (Both linked? Prefer the password: no popup to block.) */
export function reauthMethod(): ReauthMethod {
  const user = auth.currentUser;
  if (!user) return null;
  const providers = user.providerData.map((p) => p.providerId);
  if (providers.includes("password") && user.email) return "password";
  if (providers.includes("google.com")) return "google";
  return null;
}

/**
 * P20: re-authenticates the current user and refreshes their ID token, so the token's `auth_time` is "now". The
 * server reads that to accept sensitive actions (ownership transfer) only from a sign-in no older than 5 minutes
 * (lib/team-owner.ts REAUTH_MAX_AGE_SECONDS); this is the client half. Throws a friendly Error on a wrong
 * password or a closed popup.
 */
export async function reauthenticate(password: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const method = reauthMethod();
  try {
    if (method === "password") {
      if (!password) throw new Error("Enter your password to confirm it's you.");
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email!, password));
    } else if (method === "google") {
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
    } else {
      throw new Error("Sign out and back in, then try again.");
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "auth/wrong-password" || code === "auth/invalid-credential" || code === "auth/invalid-login-credentials") throw new Error("That password isn't right.");
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") throw new Error("The Google window was closed. Try again.");
    if (code === "auth/too-many-requests") throw new Error("Too many attempts. Wait a few minutes and try again.");
    throw err instanceof Error ? err : new Error("Couldn't confirm it's you.");
  }
  await user.getIdToken(true);
}
