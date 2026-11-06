"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { failureDetails, failureExplanation, type FirestoreFailure } from "@/lib/firestore-errors";
import { cn } from "@/lib/utils";

/**
 * The on-theme replacement for a raw Firestore error (FIX3): a plain title,
 * one sentence on what it probably means, **Retry** (when the caller can
 * retry), and **Copy details** (code, message, and the failing collection path
 * and query) so a problem can be diagnosed from a screenshot-free paste.
 */
export function LoadError({ failure, onRetry, className }: { failure: FirestoreFailure; onRetry?: () => void; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(failureDetails(failure));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context): the details are still visible below.
    }
  };

  return (
    <div role="alert" className={cn("glass-card flex flex-col gap-3 border border-red-400/25 p-5", className)}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">{failure.context}</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{failureExplanation(failure)}</p>
        </div>
      </div>
      <details className="rounded-xl bg-white/4 px-3 py-2 text-xs text-[var(--muted-foreground)]">
        <summary className="cursor-pointer select-none">Details</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono">{failureDetails(failure)}</pre>
      </details>
      <div className="flex flex-wrap gap-2">
        {onRetry && (
          <Button size="sm" className="gap-1.5" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        )}
        <Button size="sm" variant="glass" className="gap-1.5" onClick={() => void copy()}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy details"}
        </Button>
      </div>
    </div>
  );
}
