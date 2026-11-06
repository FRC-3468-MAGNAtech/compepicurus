"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Eye, EyeOff, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/ui/rich-text";
import { CHANGE_TYPES, formatEntryDate, groupChanges, visibleChanges, type ChangeType, type ChangelogEntry } from "@/lib/changelog";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const typeMeta = (type: ChangeType) => CHANGE_TYPES.find((t) => t.id === type)!;

export function ChangePill({ type, count, className }: { type: ChangeType; count?: number; className?: string }) {
  const meta = typeMeta(type);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", meta.pill, className)}>
      {meta.label}
      {count !== undefined && <span className="opacity-70">{count}</span>}
    </span>
  );
}

/** One release on the timeline: a collapsible glass card, with admin controls when `admin` is set. */
export function EntryCard({
  entry,
  expanded,
  onToggle,
  filterTypes,
  admin,
  onEdit,
  onDelete,
  onTogglePinned,
  onTogglePublished,
  actionsDisabled,
}: {
  entry: ChangelogEntry;
  expanded: boolean;
  onToggle: () => void;
  filterTypes: ChangeType[];
  admin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePinned: () => void;
  onTogglePublished: () => void;
  actionsDisabled: boolean;
}) {
  const changes = visibleChanges(entry, filterTypes);
  const groups = groupChanges(changes);
  const bodyId = `changelog-body-${entry.id}`;
  const isDraft = entry.status === "draft";

  return (
    <motion.article
      transition={spring}
      whileHover={{ y: -2 }}
      className={cn("glass-card glow-ring p-5", isDraft && "border-dashed")}
      aria-label={`${entry.version} — ${entry.title}`}
    >
      <div className="flex items-start gap-3">
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={bodyId} className="group flex min-w-0 flex-1 items-start gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold">{entry.version}</span>
              {entry.pinned && (
                <Badge variant="accent" className="gap-1">
                  <Pin className="h-3 w-3" /> Pinned
                </Badge>
              )}
              {isDraft && <Badge variant="warning">Draft · only admins can see this</Badge>}
              <span className="text-xs text-[var(--muted-foreground)]">{formatEntryDate(entry.date)}</span>
            </div>
            <h2 className="text-base font-semibold leading-snug">{entry.title}</h2>
            {!expanded && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {groupChanges(entry.changes).map((g) => (
                  <ChangePill key={g.type} type={g.type} count={g.items.length} />
                ))}
              </div>
            )}
          </div>
          <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform duration-300 group-hover:text-[var(--foreground)]", expanded && "rotate-180")} aria-hidden />
        </button>

        {admin && (
          <div className="flex shrink-0 items-center">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onTogglePinned} disabled={actionsDisabled} aria-label={entry.pinned ? `Unpin ${entry.version}` : `Pin ${entry.version}`} title={entry.pinned ? "Unpin" : "Pin to top"}>
              {entry.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onTogglePublished} disabled={actionsDisabled} aria-label={isDraft ? `Publish ${entry.version}` : `Unpublish ${entry.version}`} title={isDraft ? "Publish" : "Unpublish (back to draft)"}>
              {isDraft ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} disabled={actionsDisabled} aria-label={`Edit ${entry.version}`} title="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-red-300" onClick={onDelete} disabled={actionsDisabled} aria-label={`Delete ${entry.version}`} title="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={bodyId}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-4 pt-4">
              {entry.summary && (
                <p className="text-sm text-[var(--muted-foreground)]">
                  <RichText text={entry.summary} />
                </p>
              )}
              {groups.map((group) => (
                <section key={group.type} className="flex flex-col gap-2">
                  <ChangePill type={group.type} className="self-start" />
                  <ul className="flex flex-col gap-1.5">
                    {group.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <span className={cn("mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full", typeMeta(group.type).bullet)} aria-hidden />
                        <RichText text={item.text} className="text-[var(--muted-foreground)]" />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {groups.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No changes of the selected types in this entry.</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
