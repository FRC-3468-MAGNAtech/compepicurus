"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "scout" | "lead" | "admin";

type AuthState = {
  isLoggedIn: boolean;
  name: string;
  role: Role;
  login: (name: string, role?: Role) => void;
  logout: () => void;
  setRole: (role: Role) => void;
};

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = "compepicurus.mock-auth";

export function MockAuthProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState("Priya Nandakumar");
  const [role, setRoleState] = useState<Role>("admin");
  const [isLoggedIn, setIsLoggedIn] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Deliberately deferred: SSR has no localStorage, so we render the
        // default mock session first (matching the server) and sync the
        // persisted one in after mount rather than risk a hydration mismatch.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (parsed.name) setName(parsed.name);
        if (parsed.role) setRoleState(parsed.role);
        if (typeof parsed.isLoggedIn === "boolean") setIsLoggedIn(parsed.isLoggedIn);
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  const persist = (next: Partial<{ name: string; role: Role; isLoggedIn: boolean }>) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed, ...next }));
    } catch {
      // ignore storage failures
    }
  };

  const login = (newName: string, newRole: Role = "scout") => {
    setName(newName);
    setRoleState(newRole);
    setIsLoggedIn(true);
    persist({ name: newName, role: newRole, isLoggedIn: true });
  };

  const logout = () => {
    setIsLoggedIn(false);
    persist({ isLoggedIn: false });
  };

  const setRole = (newRole: Role) => {
    setRoleState(newRole);
    persist({ role: newRole });
  };

  return (
    <AuthContext.Provider value={{ isLoggedIn, name, role, login, logout, setRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useMockAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useMockAuth must be used within MockAuthProvider");
  return ctx;
}
