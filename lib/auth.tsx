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
import { syncFieldTeams, syncRoles } from "@/lib/team-enrollment";
import type { RoleId } from "@/lib/roles";
import type { AvatarChoice } from "@/lib/profile/config";

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
  /** P20: the TEAM owner (a mirror of teams/{teamId}.ownerUid, written only by the server routes in the same transaction). Authoritative is `ownerUid`; see lib/team-owner.ts. */
  isOwner: boolean;
  /** P20: a PLATFORM owner (an email in OWNER_EMAILS, set by app/api/auth/sync-roles). Approves applications, switches team creation, force-transfers for recovery. Clients can never write it. */
  isPlatformOwner?: boolean;
  themeId: string;
  /** P18: "light" | "dark" | "system". Separate from themeId; absent until the user first picks one (then this browser's, or the system's, applies). Ignored while a pride theme is active. */
  colorMode?: "light" | "dark" | "system";
  /** P32: how strongly a gradient / pride theme's painted page shows (Settings > Appearance > Gradient intensity). Absent means the default, Vivid. Their own to write (the own-profile update rule has no key allowlist). */
  gradientIntensity?: "subtle" | "normal" | "vivid";
  /** P19: the FTC teams (ids from teams/{teamId}.fieldTeams) this member is assigned to. Admin-only to change (firestore.rules); absent until the migration runs, and an empty/unresolvable list counts as "all teams" (lib/field-teams.ts). */
  fieldTeamIds?: string[];
  /** P19: the FTC team this user is "viewing as" (their own choice, saved so it follows them across devices). Resolved against their assigned teams, so a stale id is harmless. */
  activeFieldTeamId?: string | null;
  /** P14: when the user last opened the Changelog (a Firestore Timestamp; absent until they first do) — drives the unread dot on its nav item. */
  lastSeenChangelogAt?: unknown;
  /** FIX3: the layered-glass level (0.3-2, 1 = default), saved per user so it follows them across devices. See lib/glass-layer.tsx. */
  glassLayerLevel?: number;
  /** P24: the practice workspace's form width as a share (0-1) of the workspace, saved per user. See lib/workspace/use-workspace-prefs.ts. */
  workspaceFormWidth?: number;
  /** P24: on phones, the video's share (0-1) of the practice workspace's height. */
  workspacePhoneSplit?: number;
  /** P25: the member's avatar choice, mirrored from their profile so teammates (and the limited "private profile" card) can show it. Absent = initials. */
  avatar?: AvatarChoice;
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
  updateUserProfile: (patch: Partial<Pick<UserDoc, "name" | "themeId" | "colorMode" | "gradientIntensity" | "activeFieldTeamId" | "avatar">>) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  /** FIX2: this account's email is in OWNER_EMAILS but isn't verified yet, so owner access hasn't been applied. Drives the "Verify your email to activate owner access" notice. */
  ownerPendingVerification: boolean;
  /** After the user clicks the verification link: reloads the account, refreshes the ID token, and re-runs the owner/admin sync, without a sign-out. */
  recheckOwnerAccess: () => Promise<void>;
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
  const [ownerPendingVerification, setOwnerPendingVerification] = useState(false);

  const onSignedIn = async (signedInUser: FirebaseUser) => {
    setLinkedProviders(signedInUser.providerData.map((p) => p.providerId));
    await syncServerSession(signedInUser);
    // Grants owner/admin (from OWNER_EMAILS/ADMIN_EMAILS) idempotently on
    // every sign-in. If it actually changed anything, the custom claims on
    // this session are stale until the token is force-refreshed.
    const { changed, ownerPendingVerification: pending } = await syncRoles();
    setOwnerPendingVerification(pending);
    if (changed) {
      await signedInUser.getIdToken(true);
      await syncServerSession(signedInUser);
    }
    // P19: idempotent FTC-teams migration for this account (a no-op once done). Not awaited: nothing
    // waits on it, readers fall back to the legacy team number until the doc updates, and the
    // realtime listeners pick the result up on their own.
    void syncFieldTeams();
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
        setOwnerPendingVerification(false);
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
    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        setProfile(snap.exists() ? (snap.data() as UserDoc) : null);
        setProfileLoaded(true);
      },
      (err) => {
        // firestore.rules' `users/{uid}` read checks `resource.data.teamId`,
        // which throws (denying the read) when the doc doesn't exist yet —
        // exactly the "signed in but never finished team setup" case this
        // provider already has a `profile: null` path for. Without this
        // handler, onSnapshot's success callback simply never fires and
        // `profileLoaded` is stuck `false` forever, hanging every page on
        // its loading spinner — this treats that denial the same as "no
        // profile doc" so app/(app)/layout.tsx's redirect to /finish-setup
        // can actually run.
        console.error("users/{uid} subscription failed:", err);
        setProfile(null);
        setProfileLoaded(true);
      }
    );
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

  const updateUserProfile = async (patch: Partial<Pick<UserDoc, "name" | "themeId" | "colorMode" | "gradientIntensity" | "activeFieldTeamId" | "avatar">>) => {
    if (!auth.currentUser) throw new Error("Not signed in.");
    await updateDoc(doc(db, "users", auth.currentUser.uid), patch);
  };

  const resendVerificationEmail = async () => {
    if (!auth.currentUser) throw new Error("Not signed in.");
    await sendEmailVerification(auth.currentUser);
  };

  const recheckOwnerAccess = async () => {
    const current = auth.currentUser;
    if (!current) return;
    // The cached ID token still says "unverified" until it's re-fetched, which would make the sync refuse again.
    await current.reload();
    await current.getIdToken(true);
    await onSignedIn(current);
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
        ownerPendingVerification,
        recheckOwnerAccess,
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
