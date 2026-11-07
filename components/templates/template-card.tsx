"use client";

import type { ReactNode } from "react";
import { BadgeCheck, Download, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GlassPanel } from "@/components/ui/glass-panel";
import type { FormTemplate } from "@/lib/templates/build";

// P23: one template in the library: name, description, tags and season, author, version, how big it is, how often it was used, and an Official badge
// for the platform owner's own. `actions` are the buttons the screen decides on; `status` shows where one of your own templates is in the review process.

export function TemplateStatus({ t }: { t: FormTemplate }) {
  switch (t.visibility) {
    case "private":
      return <Badge variant="outline">Private</Badge>;
    case "public-pending":
      return <Badge variant="warning">Waiting for review</Badge>;
    case "public":
      return (
        <>
          <Badge variant="success">Public</Badge>
          {t.hasPendingUpdate && <Badge variant="warning">Update waiting for review</Badge>}
        </>
      );
    case "rejected":
      return <Badge variant="danger">Not approved</Badge>;
  }
}

export function TemplateCard({ t, showStatus, actions, extra }: { t: FormTemplate; showStatus?: boolean; actions: ReactNode; extra?: ReactNode }) {
  return (
    <GlassPanel className="flex h-full flex-col gap-3" data-template-card={t.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{t.name}</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            by {t.authorName} · v{t.version}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {t.official && (
            <Badge variant="accent" className="gap-1">
              <BadgeCheck className="h-3.5 w-3.5" /> Official
            </Badge>
          )}
          {showStatus && <TemplateStatus t={t} />}
        </div>
      </div>

      {t.description && <p className="text-sm text-[var(--muted-foreground)]">{t.description}</p>}
      {t.visibility === "rejected" && t.rejectionReason && (
        <p role="note" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs">
          <strong>Why:</strong> {t.rejectionReason}
        </p>
      )}

      {t.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {t.tags.map((tag) => (
            <li key={tag}>
              <Badge variant="outline">{tag}</Badge>
            </li>
          ))}
        </ul>
      )}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
        <span className="inline-flex items-center gap-1">
          <Layers className="h-3.5 w-3.5" /> {t.sectionCount} categories, {t.fieldCount} fields
        </span>
        <span className="inline-flex items-center gap-1" data-testid="import-count">
          <Download className="h-3.5 w-3.5" /> {t.importCount} {t.importCount === 1 ? "use" : "uses"}
        </span>
      </p>

      {extra}
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">{actions}</div>
    </GlassPanel>
  );
}
