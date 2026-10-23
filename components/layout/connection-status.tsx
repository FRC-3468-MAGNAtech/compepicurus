"use client";

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useActiveEvent } from "@/lib/active-event";
import { subscribeEntries } from "@/lib/scout-entries";
import { cn } from "@/lib/utils";

/**
 * Online/offline + "N pending sync" indicator. Pending count is scoped to
 * the active event's scoutEntries (where offline submissions actually
 * happen, e.g. the Scout Form at a venue with bad Wi-Fi) rather than every
 * entry the team has ever recorded.
 */
export function ConnectionStatus({ collapsed }: { collapsed?: boolean }) {
  const { profile } = useAuth();
  const { activeEvent } = useActiveEvent();
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
    if (!profile?.teamId || !activeEvent?.code) {
      // Deliberate: clears a stale pending count from a previous team/event
      // once either becomes unavailable, rather than leaving it on screen.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPending(0);
      return;
    }
    return subscribeEntries(profile.teamId, activeEvent.code, (_entries, pendingWrites) => {
      setPending(pendingWrites);
    });
  }, [profile?.teamId, activeEvent?.code]);

  const label = !online ? "Offline" : pending > 0 ? `${pending} pending sync` : "Online";
  const Icon = !online ? CloudOff : pending > 0 ? RefreshCw : Wifi;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
        !online ? "bg-red-500/15 text-red-300" : pending > 0 ? "bg-amber-500/15 text-amber-300" : "text-[var(--muted-foreground)]"
      )}
      title={label}
    >
      <Icon className={cn("h-3 w-3 shrink-0", pending > 0 && online && "animate-spin")} />
      {!collapsed && <span className="truncate">{label}</span>}
    </div>
  );
}
