"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword as firebaseUpdatePassword,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

function randomJoinCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/**
 * Mints/clears the HttpOnly session cookie Server Actions check (see
 * lib/server/require-user.ts) before serving FIRST API data — Server
 * Actions can't read the client Firebase SDK's auth state directly. Called
 * from the onAuthStateChanged effect below so it covers every sign-in path
 * (login, signup, first-run setup, and restoring a session on page load)
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
import { auth, db, isFirebaseConfigured } from "@/lib/firebase/client";
import { DEFAULT_ROLE_ID, type RoleId } from "@/lib/roles";
import { defaultThemeId } from "@/lib/themes";

/** Fixed single-team doc id — see docs/ARCHITECTURE.md for why. */
export const TEAM_ID = "default";

export type UserDoc = {
  name: string;
  email: string;
  teamId: string;
  primaryRole: RoleId;
  secondaryRoles: RoleId[];
  isAdmin: boolean;
  themeId: string;
};

type AuthContextValue = {
  user: FirebaseUser | null;
  profile: UserDoc | null;
  /** True until the initial auth state (and, if signed in, the profile doc) has loaded. */
  loading: boolean;
  firebaseReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, joinCode: string) => Promise<void>;
  /** The one-time flow when no team exists yet: creates the account, the team doc, and makes this user its first admin. Returns the generated join code. */
  firstRunSetup: (name: string, email: string, password: string, teamNumber: number) => Promise<string>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  updateUserProfile: (patch: Partial<Pick<UserDoc, "name" | "themeId">>) => Promise<void>;
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

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoaded(true);
      if (!u) {
        setProfile(null);
        setProfileLoaded(true);
      }
      void syncServerSession(u);
    });
    return unsubscribe;
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
    // Awaited (not left to the onAuthStateChanged effect below) so the
    // session cookie exists before the caller redirects into a page that
    // immediately calls a FIRST API Server Action — otherwise that first
    // call can race the cookie sync and come back "unauthorized".
    await syncServerSession(credential.user);
  };

  const signup = async (name: string, email: string, password: string, joinCode: string) => {
    // Reads the team doc unauthenticated — allowed by rules (get-only, see
    // docs/ASSUMPTIONS.md) specifically so join-code validation doesn't need
    // a Cloud Function or a create-then-rollback dance.
    const teamSnap = await getDoc(doc(db, "teams", TEAM_ID));
    if (!teamSnap.exists()) throw new Error("No team has been set up yet.");
    if (teamSnap.data().joinCode !== joinCode.trim()) throw new Error("That join code doesn't match.");

    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const newProfile: UserDoc = {
      name,
      email,
      teamId: TEAM_ID,
      primaryRole: DEFAULT_ROLE_ID,
      secondaryRoles: [],
      isAdmin: false,
      themeId: defaultThemeId,
    };
    await setDoc(doc(db, "users", credential.user.uid), { ...newProfile, createdAt: serverTimestamp() });
    await syncServerSession(credential.user);
  };

  const firstRunSetup = async (name: string, email: string, password: string, teamNumber: number) => {
    // Order matters for the security rules, and for the bootstrap problem of
    // "who's allowed to become the first admin when no admin exists yet":
    // 1) create the account (team-doc create requires an authenticated
    //    caller), 2) create the team doc with firstAdminClaimed: false (only
    //    ever creatable once — see firestore.rules), 3) create this user's
    //    own doc as admin — allowed only while firstAdminClaimed is still
    //    false, 4) flip firstAdminClaimed to true, which is now allowed
    //    because step 3 already made this uid an admin. See
    //    docs/ASSUMPTIONS.md for the narrow race window this leaves between
    //    steps 3 and 4 (closable later with a Cloud Function).
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const joinCode = randomJoinCode();
    await setDoc(doc(db, "teams", TEAM_ID), {
      number: teamNumber,
      joinCode,
      activeEventCode: null,
      activeSeasonId: null,
      activeEvent: null,
      firstAdminClaimed: false,
      createdAt: serverTimestamp(),
    });
    const newProfile: UserDoc = {
      name,
      email,
      teamId: TEAM_ID,
      primaryRole: DEFAULT_ROLE_ID,
      secondaryRoles: [],
      isAdmin: true,
      themeId: defaultThemeId,
    };
    await setDoc(doc(db, "users", credential.user.uid), { ...newProfile, createdAt: serverTimestamp() });
    await updateDoc(doc(db, "teams", TEAM_ID), { firstAdminClaimed: true });
    await syncServerSession(credential.user);
    return joinCode;
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
  };

  const updateUserProfile = async (patch: Partial<Pick<UserDoc, "name" | "themeId">>) => {
    if (!auth.currentUser) throw new Error("Not signed in.");
    await updateDoc(doc(db, "users", auth.currentUser.uid), patch);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading: !authLoaded || (!!user && !profileLoaded),
        firebaseReady: isFirebaseConfigured(),
        login,
        signup,
        firstRunSetup,
        logout,
        resetPassword,
        changePassword,
        updateUserProfile,
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
