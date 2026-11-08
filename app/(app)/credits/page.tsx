"use client";

import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { LoadError } from "@/components/practice/load-error";
import { CreditsBoard } from "@/components/credits/credits-board";
import { CreditsEditToggle } from "@/components/credits/credits-edit-toggle";
import { Shimmer } from "@/components/ui/shimmer";
import { useAuth } from "@/lib/auth";
import type { CreditsOp } from "@/lib/credits/ops";
import { useCredits } from "@/lib/credits/store";
import { usePermissions } from "@/lib/permissions";

export default function CreditsPage() {
  const { user, profile } = useAuth();
  const { isAdmin } = usePermissions();
  const { sections, isDefault, loaded, edit, error: loadError, retry } = useCredits(profile?.teamId ?? null);
  const [error, setError] = useState<string | null>(null);
  // FIX4: edit mode is a plain in-memory switch: off on every visit, never saved, never entered automatically.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(0);
  const actor = useMemo(() => (user && profile ? { uid: user.uid, name: profile.name } : null), [user, profile]);

  const onOp = async (op: CreditsOp) => {
    setError(null);
    setSaving((n) => n + 1);
    try {
      const ok = await edit(actor, op);
      if (!ok) setError("Couldn't save that change. You may be offline, or no longer allowed to edit.");
    } finally {
      setSaving((n) => n - 1);
    }
  };
  const inEditMode = isAdmin && editing;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Credits</h1>
          <p className="text-sm text-[var(--muted-foreground)]">The people, tools, and data behind CompEpicurus.</p>
        </div>
        <CreditsEditToggle canEdit={isAdmin && loaded && !loadError} editing={inEditMode} unsavedCount={saving} onEdit={() => setEditing(true)} onDone={() => setEditing(false)} />
      </div>

      {inEditMode && loaded && isDefault && (
        <p className="flex items-start gap-2 self-start rounded-2xl border border-[var(--glass-border)] bg-white/5 px-4 py-2.5 text-xs text-[var(--muted-foreground)]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>This is the starter list. Replace the team placeholders and edit anything — your changes are saved as the team&apos;s credits.</span>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      {loaded && loadError ? (
        <LoadError failure={loadError} onRetry={retry} />
      ) : loaded ? (
        <CreditsBoard sections={sections} admin={isAdmin} editing={inEditMode} onOp={(op) => void onOp(op)} />
      ) : (
        <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading credits">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card flex h-[112px] flex-col gap-3 p-5">
              <Shimmer className="h-5 w-1/4" />
              <Shimmer className="h-4 w-2/3" />
              <Shimmer className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
