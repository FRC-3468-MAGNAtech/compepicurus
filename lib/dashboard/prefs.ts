"use client";

import { useCallback, useSyncExternalStore } from "react";

// The role a user last viewed on their dashboard (P13), remembered per user in
// this browser's localStorage under their uid — same trade-off as the Pick
// List's EPA setting (docs/ASSUMPTIONS.md, P12-5): two people on one browser
// keep separate choices, but it doesn't follow someone to another device.

const KEY_PREFIX = "compepicurus.dashboard.role.";
const listeners = new Set<() => void>();

function read(uid: string): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + uid);
  } catch {
    return null; // storage blocked (private window, etc.) — fall back to the primary role
  }
}

export function useSavedDashboardRole(uid: string | null): [string | null, (role: string) => void] {
  const saved = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      window.addEventListener("storage", onChange);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => (uid ? read(uid) : null),
    () => null
  );

  const save = useCallback(
    (role: string) => {
      if (!uid) return;
      try {
        window.localStorage.setItem(KEY_PREFIX + uid, role);
      } catch {
        // Couldn't persist; listeners below still update this session.
      }
      listeners.forEach((l) => l());
    },
    [uid]
  );

  return [saved, save];
}
