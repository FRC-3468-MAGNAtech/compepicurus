"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { FtcEvent } from "@/lib/ftc/types";

type ActiveEventContextValue = {
  activeEvent: FtcEvent | null;
  setActiveEvent: (event: FtcEvent | null) => void;
  isActive: (code: string) => boolean;
};

const ActiveEventContext = createContext<ActiveEventContextValue | null>(null);

const STORAGE_KEY = "compepicurus.active-event";

export function ActiveEventProvider({ children }: { children: ReactNode }) {
  const [activeEvent, setActiveEventState] = useState<FtcEvent | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        // Deliberately deferred: SSR has no localStorage, so we render "no
        // active event" first (matching the server) and sync the persisted
        // one in after mount rather than risk a hydration mismatch.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveEventState(JSON.parse(stored));
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  const setActiveEvent = (event: FtcEvent | null) => {
    setActiveEventState(event);
    try {
      if (event) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore storage failures
    }
  };

  const isActive = (code: string) => activeEvent?.code === code;

  return (
    <ActiveEventContext.Provider value={{ activeEvent, setActiveEvent, isActive }}>
      {children}
    </ActiveEventContext.Provider>
  );
}

export function useActiveEvent() {
  const ctx = useContext(ActiveEventContext);
  if (!ctx) throw new Error("useActiveEvent must be used within ActiveEventProvider");
  return ctx;
}
