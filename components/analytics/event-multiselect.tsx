"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_BADGE } from "@/components/event/selected-events-panel";
import type { EventOption } from "@/lib/analytics/data-context";
import type { EventScope } from "@/lib/analytics/filters";
import { getEventStatus } from "@/lib/ftc/event-status";
import { spring, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The Analytics Event control: a multi-select with two presets ("Active
 * events", the default, and "All events") above the individual events. In
 * single-event mode it is a plain single select. The list is a floating panel,
 * so it uses `.glass-overlay` (solid backing) like every other dropdown.
 */
export function EventMultiSelect({
  options,
  scope,
  onChange,
  singleEvent,
  practice,
  primaryCode,
  singleSelectedCode,
}: {
  options: EventOption[];
  scope: EventScope;
  onChange: (scope: EventScope) => void;
  singleEvent: boolean;
  practice: boolean;
  primaryCode: string | null;
  /** Single-event mode only: the event the page is actually showing (its resolved default when nothing was picked). */
  singleSelectedCode: string | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const now = useNow();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const customCodes = scope.kind === "custom" ? scope.codes : [];
  const selectedCodes = singleEvent ? (singleSelectedCode ? [singleSelectedCode] : []) : customCodes;
  const nameOf = (code: string) => options.find((o) => o.code === code)?.name ?? code;

  const summary = singleEvent
    ? singleSelectedCode
      ? nameOf(singleSelectedCode)
      : "Pick an event"
    : scope.kind === "all"
      ? "All events"
      : scope.kind === "active"
        ? practice
          ? "All events"
          : `Active events (${options.filter((o) => o.active).length})`
        : customCodes.length === 1
          ? nameOf(customCodes[0])
          : `${nameOf(customCodes[0])} +${customCodes.length - 1}`;

  const toggle = (code: string) => {
    if (singleEvent) {
      onChange({ kind: "custom", codes: [code] });
      setOpen(false);
      return;
    }
    const next = customCodes.includes(code) ? customCodes.filter((c) => c !== code) : [...customCodes, code];
    // Unchecking the last event falls back to the default rather than an empty (match-nothing) selection.
    onChange(next.length === 0 ? { kind: "active" } : { kind: "custom", codes: next });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 min-w-[14rem] max-w-full items-center justify-between gap-2 rounded-2xl border border-[var(--glass-border)] bg-white/5 px-4 text-sm outline-none transition-shadow duration-300 focus-visible:shadow-[0_0_0_3px_rgba(var(--glow),0.25)] data-[open=true]:shadow-[0_0_0_3px_rgba(var(--glow),0.25)]"
        data-open={open}
      >
        <span className="truncate">{summary}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={springSnappy} className="shrink-0">
          <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-multiselectable={!singleEvent}
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={spring}
            className="glass-overlay absolute left-0 top-full z-50 mt-2 flex max-h-[min(24rem,60vh)] w-[min(26rem,calc(100vw-2rem))] flex-col gap-0.5 overflow-y-auto rounded-2xl p-1.5 shadow-2xl"
          >
            {!singleEvent && (
              <>
                {!practice && (
                  <PresetRow
                    label="Active events"
                    hint="The events the team has set active"
                    selected={scope.kind === "active"}
                    onClick={() => onChange({ kind: "active" })}
                  />
                )}
                <PresetRow
                  label="All events"
                  hint={practice ? "Every library and live event" : "Every event with scouted data"}
                  selected={scope.kind === "all" || (practice && scope.kind === "active")}
                  onClick={() => onChange({ kind: "all" })}
                />
                <div className="mx-2 my-1 border-t border-[var(--glass-border)]" />
              </>
            )}

            {options.length === 0 && <p className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">No events with data yet.</p>}

            {options.map((o) => {
              const checked = selectedCodes.includes(o.code);
              const status = o.event ? STATUS_BADGE[getEventStatus(o.event, now)] : null;
              return (
                <button
                  key={o.code}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(o.code)}
                  className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10"
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center border",
                      singleEvent ? "rounded-full" : "rounded-md",
                      checked ? "border-transparent" : "border-[var(--glass-border)]"
                    )}
                    style={checked ? { background: "var(--theme-gradient)" } : undefined}
                  >
                    {checked && <Check className="h-3 w-3 text-[var(--color-primary-foreground)]" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {o.code === primaryCode && !practice && <Star className="h-3 w-3 shrink-0 fill-current" style={{ color: "var(--color-primary)" }} />}
                      <span className="truncate font-medium">{o.name}</span>
                    </span>
                    <span className="block text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                      {o.code} &middot; {o.count} {o.count === 1 ? "entry" : "entries"}
                    </span>
                  </span>
                  {status && (
                    <Badge variant={status.variant} className="shrink-0 text-[10px]">
                      {status.label}
                    </Badge>
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PresetRow({ label, hint, selected, onClick }: { label: string; hint: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10"
    >
      <span
        className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-transparent" : "border-[var(--glass-border)]")}
        style={selected ? { background: "var(--theme-gradient)" } : undefined}
      >
        {selected && <Check className="h-3 w-3 text-[var(--color-primary-foreground)]" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-[11px] text-[var(--muted-foreground)]">{hint}</span>
      </span>
    </button>
  );
}

/** Fixed at mount so every status chip in the list agrees and render stays pure. */
function useNow() {
  const [now] = useState(() => Date.now());
  return now;
}
