"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarX2, ChevronDown, Clock, Star, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { getEventStatus } from "@/lib/ftc/event-status";
import { spring, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { EventLifecycleStatus, FtcEvent } from "@/lib/ftc/types";

export const STATUS_BADGE: Record<EventLifecycleStatus, { label: string; variant: "success" | "glass" | "outline" }> = {
  "in-progress": { label: "In Progress", variant: "success" },
  upcoming: { label: "Upcoming", variant: "glass" },
  completed: { label: "Completed", variant: "outline" },
};

export function formatDateRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(start).toLocaleDateString(undefined, opts);
  const e = new Date(end).toLocaleDateString(undefined, opts);
  return start === end ? s : `${s} – ${e}`;
}

// Where the condensed bar pins, mirroring the app shell: below the sticky
// mobile topbar (which is hidden at lg, where the sidebar replaces it), and
// clear of the safe-area inset. Shared between the CSS offset and the
// IntersectionObserver margin below so the swap happens exactly when the big
// panel slides under the bar's position.
const BAR_TOP_CLASS = "top-[calc(env(safe-area-inset-top)+5.25rem)] lg:top-[calc(env(safe-area-inset-top)+0.75rem)]";
const BAR_TOP_PX_MOBILE = 84;
const BAR_TOP_PX_DESKTOP = 12;
const CONDENSED_CHIP_LIMIT = 3;

type PanelProps = {
  events: FtcEvent[];
  primaryCode: string | null;
  /** Admins can star a primary and remove events; everyone else sees the panel read-only. */
  canEdit: boolean;
  onRemove: (event: FtcEvent) => void;
  onMakePrimary: (code: string) => void;
};

/**
 * The "Selected events" panel at the top of Event Selection, plus its
 * condensed sticky twin that takes over once the big panel scrolls away
 * (FIX1-2c).
 *
 * Nothing here can make the content below jump: the big panel always keeps
 * its place in the flow (it simply scrolls off like any other element), and
 * the condensed bar lives in a zero-height `sticky` slot with an absolutely
 * positioned child, so showing/hiding it changes no layout box. Visibility is
 * driven by an IntersectionObserver on the big panel — no scroll listener.
 *
 * Render this as a direct child of the page's `flex flex-col gap-*` root: the
 * slot needs the page-tall container as its sticky containing block, and its
 * negative bottom margin cancels the flex gap it would otherwise add.
 */
export function SelectedEventsPanel({ events, primaryCode, canEdit, onRemove, onMakePrimary }: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [scrolledPast, setScrolledPast] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Fixed at mount: the badge status only needs to be right for this visit, and render must stay pure.
  const [now] = useState(() => Date.now());

  const hasEvents = events.length > 0;
  const showBar = hasEvents && scrolledPast;
  const popoverOpen = showBar && expanded;

  useEffect(() => {
    const el = panelRef.current;
    if (!hasEvents || !el) return;

    const desktop = window.matchMedia("(min-width: 1024px)");
    let observer: IntersectionObserver | null = null;
    const connect = () => {
      observer?.disconnect();
      const top = desktop.matches ? BAR_TOP_PX_DESKTOP : BAR_TOP_PX_MOBILE;
      observer = new IntersectionObserver(
        ([entry]) => {
          // "Scrolled past" = out of view *above* the bar's pin line, not merely not intersecting.
          const past = !entry.isIntersecting && entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? top);
          setScrolledPast(past);
          if (!past) setExpanded(false);
        },
        { rootMargin: `-${top}px 0px 0px 0px` }
      );
      observer.observe(el);
    };

    connect();
    desktop.addEventListener("change", connect);
    return () => {
      desktop.removeEventListener("change", connect);
      observer?.disconnect();
    };
  }, [hasEvents]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setExpanded(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popoverOpen]);

  if (!hasEvents) {
    return (
      <GlassPanel className="flex flex-col items-center gap-2 py-8 text-center">
        <CalendarX2 className="h-7 w-7 text-[var(--muted-foreground)]" />
        <div className="font-semibold">No active events yet</div>
        <p className="max-w-md text-sm text-[var(--muted-foreground)]">
          {canEdit
            ? "Tap any event below to make it active. You can pick several — one of them can be starred as the primary."
            : "An admin hasn't picked any active events yet."}
        </p>
      </GlassPanel>
    );
  }

  const extra = events.length - CONDENSED_CHIP_LIMIT;

  return (
    <>
      <div className={cn("sticky z-20 -mb-6 h-0", BAR_TOP_CLASS)}>
        <AnimatePresence>
          {showBar && (
            <motion.div
              ref={barRef}
              initial={{ opacity: 0, y: -10, scaleY: 0.85 }}
              animate={{ opacity: 1, y: 0, scaleY: 1 }}
              exit={{ opacity: 0, y: -10, scaleY: 0.85 }}
              transition={spring}
              style={{ transformOrigin: "top" }}
              className="absolute inset-x-0 top-0"
            >
              <div
                role="button"
                tabIndex={0}
                aria-expanded={popoverOpen}
                aria-label="Selected events"
                onClick={() => setExpanded((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpanded((v) => !v);
                  }
                }}
                className="glass-overlay flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 shadow-xl outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
              >
                <span className="shrink-0 whitespace-nowrap text-xs font-semibold">{events.length} active</span>
                <span className="shrink-0 text-[var(--muted-foreground)]">&middot;</span>
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {events.map((event, i) => (
                    <span
                      key={event.code}
                      className={cn(
                        "flex shrink-0 items-center gap-1 rounded-full border border-[var(--glass-border)] bg-white/8 px-2.5 py-1 text-xs",
                        i >= CONDENSED_CHIP_LIMIT && "sm:hidden"
                      )}
                    >
                      {event.code === primaryCode && <Star className="h-3 w-3 fill-current" style={{ color: "var(--color-primary)" }} />}
                      <span className="max-w-[11rem] truncate">{i === 0 ? event.code : event.name}</span>
                    </span>
                  ))}
                  {extra > 0 && <span className="hidden shrink-0 rounded-full px-2 py-1 text-xs text-[var(--muted-foreground)] sm:inline">+{extra}</span>}
                </div>
                <motion.span animate={{ rotate: popoverOpen ? 180 : 0 }} transition={springSnappy} className="shrink-0">
                  <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
                </motion.span>
              </div>

              <AnimatePresence>
                {popoverOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={spring}
                    className="glass-overlay mt-2 flex max-h-[60vh] flex-col gap-1 overflow-y-auto rounded-2xl p-2 shadow-2xl"
                  >
                    {events.map((event) => (
                      <EventRow
                        key={event.code}
                        event={event}
                        isPrimary={event.code === primaryCode}
                        canEdit={canEdit}
                        now={now}
                        onRemove={onRemove}
                        onMakePrimary={onMakePrimary}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div ref={panelRef}>
        <GlassPanel strong className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Selected events ({events.length})
            </h2>
            {events.length > 1 && canEdit && <span className="text-xs text-[var(--muted-foreground)]">Tap the star to change the primary</span>}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence initial={false}>
              {events.map((event) => (
                <motion.div
                  key={event.code}
                  layout
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={spring}
                  className="glass-card"
                >
                  <EventRow
                    event={event}
                    isPrimary={event.code === primaryCode}
                    canEdit={canEdit}
                    now={now}
                    onRemove={onRemove}
                    onMakePrimary={onMakePrimary}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </GlassPanel>
      </div>
    </>
  );
}

function EventRow({
  event,
  isPrimary,
  canEdit,
  now,
  onRemove,
  onMakePrimary,
}: {
  event: FtcEvent;
  isPrimary: boolean;
  canEdit: boolean;
  now: number;
  onRemove: (event: FtcEvent) => void;
  onMakePrimary: (code: string) => void;
}) {
  const status = STATUS_BADGE[getEventStatus(event, now)];

  return (
    <div className="flex items-center gap-2 rounded-xl p-2.5" onClick={(e) => e.stopPropagation()}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.85 }}
        transition={springSnappy}
        disabled={!canEdit || isPrimary}
        onClick={() => onMakePrimary(event.code)}
        aria-label={isPrimary ? `${event.name} is the primary event` : `Make ${event.name} the primary event`}
        title={isPrimary ? "Primary event" : canEdit ? "Make primary" : undefined}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:cursor-default"
      >
        <Star
          className={cn("h-5 w-5 transition-colors", isPrimary ? "fill-current" : "text-[var(--muted-foreground)]")}
          style={isPrimary ? { color: "var(--color-primary)" } : undefined}
        />
      </motion.button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{event.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--muted-foreground)]">
          <span className="uppercase tracking-wide">{event.code}</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" /> {formatDateRange(event.dateStart, event.dateEnd)}
          </span>
        </div>
      </div>
      <Badge variant={status.variant} className="hidden shrink-0 sm:inline-flex">
        {status.label}
      </Badge>
      {canEdit && (
        <motion.button
          type="button"
          whileTap={{ scale: 0.85 }}
          transition={springSnappy}
          onClick={() => onRemove(event)}
          aria-label={`Remove ${event.name}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)]"
        >
          <X className="h-4 w-4" />
        </motion.button>
      )}
    </div>
  );
}
