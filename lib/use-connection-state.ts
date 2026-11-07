"use client";

import { useEffect, useState } from "react";
import { useActiveEvents } from "@/lib/active-event";
import { useAuth } from "@/lib/auth";
import { connectionNotice, type ConnectionNotice } from "@/lib/connection-notice";
import { subscribeEntries } from "@/lib/scout-entries";

/**
 * Whether the browser is online and how many scout entries are still waiting to
 * sync. The pending count is scoped to the active events' `scoutEntries` (where
 * offline submissions actually happen — the Scout Form at a venue with bad Wi-Fi)
 * rather than every entry the team ever recorded. This is what the sidebar's
 * "Online / Offline / N pending sync" label used to compute (P1); it now feeds the
 * always-visible status chip (components/layout/connection-chip.tsx, P18).
 */
export function useConnectionNotice(): ConnectionNotice | null {
  const { profile } = useAuth();
  const { events: activeEvents } = useActiveEvents();
  // Stable across the team doc's unrelated re-snapshots, so subscriptions only restart when the set of codes changes.
  const activeCodesKey = activeEvents.map((e) => e.code).join(",");
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    // Deliberately deferred: navigator.onLine isn't available during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const codes = activeCodesKey ? activeCodesKey.split(",") : [];
    if (!profile?.teamId || codes.length === 0) {
      // Deliberate: clears a stale pending count from a previous team/event once either becomes unavailable.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPending(0);
      return;
    }
    // One subscription per active event; the badge shows the sum.
    const perEvent = new Map<string, number>();
    const unsubscribes = codes.map((code) =>
      subscribeEntries(profile.teamId, code, (_entries, pendingWrites) => {
        perEvent.set(code, pendingWrites);
        setPending([...perEvent.values()].reduce((a, b) => a + b, 0));
      })
    );
    return () => unsubscribes.forEach((u) => u());
  }, [profile?.teamId, activeCodesKey]);

  return connectionNotice(online, pending);
}
