"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword as firebaseUpdatePassword,
  updateProfile as firebaseUpdateProfile,
  type AuthCredential,
  type AuthError,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "@/lib/firebase/client";
import { syncRoles } from "@/lib/team-enrollment";
import type { RoleId } from "@/lib/roles";

const googleProvider = new GoogleAuthProvider();

function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Mints/clears the HttpOnly session cookie Server Actions check (see
 * lib/server/require-user.ts) before serving FIRST API data — Server
 * Actions can't read the client Firebase SDK's auth state directly. Called
 * from the onAuthStateChanged effect below so it covers every sign-in path
 * (password, Google popup/redirect, and restoring a session on page load)
 * from one place, plus explicit sign-out. Best-effort: if this silently
 * fails, FIRST API calls just come back "unauthorized" like any other
 * server error, which pages already render as a normal error state.
 */
async function syncServerSession(user: FirebaseUser | null) {
  try {
    if (user) {
      const idToken = await user.getIdToken();
      await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
    } else {
      await fetch("/api/auth/session", { method: "DELETE" });
    }
  } catch {
    // ignore — see doc comment above
  }
}

export type UserDoc = {
  name: string;
  email: string;
  teamId: string;
  primaryRole: RoleId;
  secondaryRoles: RoleId[];
  isAdmin: boolean;
  /** Set only by app/api/auth/sync-roles (Admin SDK) — see docs/ASSUMPTIONS.md (P1b). Clients can never write this (firestore.rules). */
  isOwner: boolean;
  themeId: string;
};

export type GoogleLinkPrompt = { email: string };

type AuthContextValue = {
  user: FirebaseUser | null;
  profile: UserDoc | null;
  /** True until the initial auth state (and, if signed in, the profile doc) has loaded. */
  loading: boolean;
  firebaseReady: boolean;
  /** Provider ids from user.providerData (e.g. "password", "google.com") — kept as explicit state since a provider link mutates the same User object in place, which wouldn't otherwise trigger a re-render. */
  linkedProviders: string[];
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  linkGoogle: () => Promise<void>;
  /** Creates the Firebase Auth account only — no team yet. The caller follows up with joinTeam()/createTeam() from lib/team-enrollment.ts. */
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  updateUserProfile: (patch: Partial<Pick<UserDoc, "name" | "themeId">>) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  /** Set when a Google sign-in/link hits auth/account-exists-with-different-credential — the email already has a password account. Resolve it with completeGoogleLink(). */
  pendingGoogleLink: GoogleLinkPrompt | null;
  /** Signs in with the given password for pendingGoogleLink's email, then links the Google credential that triggered it. Clears pendingGoogleLink on success or failure. */
  completeGoogleLink: (password: string) => Promise<void>;
  dismissGoogleLinkPrompt: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  // isFirebaseConfigured() is a pure, static check — folding it into the
  // initializer (rather than setting it from inside the effect below) means
  // the "not configured" case never needs a synchronous setState in an effect.
  const [authLoaded, setAuthLoaded] = useState(() => !isFirebaseConfigured());
  const [profileLoaded, setProfileLoaded] = useState(() => !isFirebaseConfigured());
  const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
  const [pendingGoogleLink, setPendingGoogleLink] = useState<GoogleLinkPrompt | null>(null);
  const pendingGoogleCredential = useRef<AuthCredential | null>(null);

  const onSignedIn = async (signedInUser: FirebaseUser) => {
    setLinkedProviders(signedInUser.providerData.map((p) => p.providerId));
    await syncServerSession(signedInUser);
    // Grants owner/admin (from OWNER_EMAILS/ADMIN_EMAILS) idempotently on
    // every sign-in. If it actually changed anything, the custom claims on
    // this session are stale until the token is force-refreshed.
    const { changed } = await syncRoles();
    if (changed) {
      await signedInUser.getIdToken(true);
      await syncServerSession(signedInUser);
    }
  };

  const handleGoogleAuthError = (err: unknown): never => {
    const fbErr = err as AuthError;
    if (fbErr?.code === "auth/account-exists-with-different-credential") {
      const credential = GoogleAuthProvider.credentialFromError(fbErr);
      const email = (fbErr.customData?.email as string | undefined) ?? null;
      if (credential && email) {
        pendingGoogleCredential.current = credential;
        setPendingGoogleLink({ email });
      }
    }
    throw err;
  };

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoaded(true);
      if (!u) {
        setProfile(null);
        setProfileLoaded(true);
        setLinkedProviders([]);
        void syncServerSession(null);
        return;
      }
      void onSignedIn(u);
    });
    return unsubscribe;
  }, []);

  // Catches the result of signInWithRedirect (the mobile/popup-blocked
  // fallback) once the page reloads after bouncing to Google and back —
  // signInWithPopup resolves inline at its call site instead, so this only
  // ever fires for the redirect path.
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    getRedirectResult(auth).catch((err) => {
      try {
        handleGoogleAuthError(err);
      } catch {
        // onSignedIn (via onAuthStateChanged) already covers the success
        // path; account-link conflicts are now in pendingGoogleLink for the
        // Login/Signup page to prompt for.
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    // Deliberate: this effect re-subscribes whenever `user` changes, and
    // profileLoaded must flip back to false right away so a stale profile
    // from the *previous* user is never shown as this user's data while the
    // new subscription spins up.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfileLoaded(false);
    const unsubscribe = onSnapshot(doc(db, "users", user.uid), (snap) => {
      setProfile(snap.exists() ? (snap.data() as UserDoc) : null);
      setProfileLoaded(true);
    });
    return unsubscribe;
  }, [user]);

  const login = async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    // Awaited (not left to the onAuthStateChanged effect above) so the
    // session cookie exists before the caller redirects into a page that
    // immediately calls a FIRST API Server Action — otherwise that first
    // call can race the cookie sync and come back "unauthorized".
    await onSignedIn(credential.user);
  };

  const loginWithGoogle = async () => {
    if (isMobileUserAgent()) {
      await signInWithRedirect(auth, googleProvider);
      return; // result is picked up by the getRedirectResult effect above after the page reloads
    }
    try {
      const credential = await signInWithPopup(auth, googleProvider);
      await onSignedIn(credential.user);
    } catch (err) {
      const fbErr = err as AuthError;
      if (fbErr?.code === "auth/popup-blocked") {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      if (fbErr?.code === "auth/popup-closed-by-user" || fbErr?.code === "auth/cancelled-popup-request") {
        return; // the user backed out on purpose — not an error to surface
      }
      handleGoogleAuthError(err);
    }
  };

  const linkGoogle = async () => {
    if (!auth.currentUser) throw new Error("Not signed in.");
    try {
      await linkWithPopup(auth.currentUser, googleProvider);
      setLinkedProviders(auth.currentUser.providerData.map((p) => p.providerId));
    } catch (err) {
      handleGoogleAuthError(err);
    }
  };

  const completeGoogleLink = async (password: string) => {
    if (!pendingGoogleLink || !pendingGoogleCredential.current) throw new Error("Nothing to link.");
    const credential = pendingGoogleCredential.current;
    try {
      const result = await signInWithEmailAndPassword(auth, pendingGoogleLink.email, password);
      await linkWithCredential(result.user, credential);
      setLinkedProviders(result.user.providerData.map((p) => p.providerId));
      await onSignedIn(result.user);
    } finally {
      pendingGoogleCredential.current = null;
      setPendingGoogleLink(null);
    }
  };

  const dismissGoogleLinkPrompt = () => {
    pendingGoogleCredential.current = null;
    setPendingGoogleLink(null);
  };

  const signup = async (name: string, email: string, password: string) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await firebaseUpdateProfile(credential.user, { displayName: name });
    await sendEmailVerification(credential.user);
    await onSignedIn(credential.user);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const changePassword = async (newPassword: string) => {
    if (!auth.currentUser) throw new Error("Not signed in.");
    await firebaseUpdatePassword(auth.currentUser, newPassword);
    // For a Google-only user this *adds* the password provider rather than
    // changing an existing one — refresh so Account Settings' "Set a
    // password" relabels to "Change password" without needing a reload.
    setLinkedProviders(auth.currentUser.providerData.map((p) => p.providerId));
  };

  const updateUserProfile = async (patch: Partial<Pick<UserDoc, "name" | "themeId">>) => {
    if (!auth.currentUser) throw new Error("Not signed in.");
    await updateDoc(doc(db, "users", auth.currentUser.uid), patch);
  };

  const resendVerificationEmail = async () => {
    if (!auth.currentUser) throw new Error("Not signed in.");
    await sendEmailVerification(auth.currentUser);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading: !authLoaded || (!!user && !profileLoaded),
        firebaseReady: isFirebaseConfigured(),
        linkedProviders,
        login,
        loginWithGoogle,
        linkGoogle,
        signup,
        logout,
        resetPassword,
        changePassword,
        updateUserProfile,
        resendVerificationEmail,
        pendingGoogleLink,
        completeGoogleLink,
        dismissGoogleLinkPrompt,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
