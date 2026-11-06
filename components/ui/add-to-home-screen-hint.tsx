"use client";

import { useSyncExternalStore } from "react";
import { Share } from "lucide-react";
import { isLikelyUnsupportedIOSBrowser } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

/**
 * The iPhone Home Screen hint (P17): iOS only delivers web push to a site that was
 * added to the Home Screen, so wherever notifications are offered this explains it —
 * and only on an iPhone/iPad browser tab (never in the installed app, on Android, or on desktop).
 * The check reads `navigator`, so it renders nothing on the server and on first paint, then appears.
 */
export function AddToHomeScreenHint({ className }: { className?: string }) {
  const show = useSyncExternalStore(subscribe, isLikelyUnsupportedIOSBrowser, () => false);
  if (!show) return null;
  return (
    <p className={cn("flex max-w-xs items-start gap-2 rounded-xl border border-[var(--glass-border)] bg-white/5 px-3 py-2 text-xs text-[var(--muted-foreground)]", className)}>
      <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>On iPhone, notifications only work once this site is added to your Home Screen: tap Share, then &ldquo;Add to Home Screen&rdquo;, and open the app from there.</span>
    </p>
  );
}
