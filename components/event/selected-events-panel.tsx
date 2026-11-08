"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, CalendarX2, Check, ChevronDown, Clock, GripVertical, Star, X } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { moveActiveEvent } from "@/lib/active-events";
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
  /** Admins can reorder (which also sets the primary), star a primary and remove events; everyone else sees the panel read-only. */
  canEdit: boolean;
  onRemove: (event: FtcEvent) => void;
  /** FIX4: move an event to a new place in the order. The first place is the primary event, so the star is "move to 0". */
  onMove: (code: string, toIndex: number) => void;
};

const dragGripClass =
  "flex h-9 w-9 shrink-0 touch-none cursor-grab items-center justify-center rounded-full text-[var(--muted-foreground)] outline-none hover:bg-white/10 hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)] active:cursor-grabbing";

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
export function SelectedEventsPanel({ events, primaryCode, canEdit, onRemove, onMove }: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [scrolledPast, setScrolledPast] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Fixed at mount: the badge status only needs to be right for this visit, and render must stay pure.
  const [now] = useState(() => Date.now());

  const hasEvents = events.length > 0;
  const canReorder = canEdit && events.length > 1;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch: press and hold on the grip to drag, so scrolling the page still works (the arrows are the no-drag way).
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  // A subtle confirmation when a move changes which event is primary (a drag to the first place, the star, or the
  // arrows). Cleared by a timer; announced politely.
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 3500);
    return () => clearTimeout(t);
  }, [note]);

  // Every way of changing the order goes through here, so the primary confirmation is the same for all of them.
  const move = (code: string, toIndex: number) => {
    const state = { events, primaryCode };
    const next = moveActiveEvent(state, code, toIndex);
    if (next === state) return;
    if (next.primaryCode !== primaryCode) setNote(`${next.events[0]?.name ?? ""} is now the primary event`);
    onMove(code, toIndex);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const to = events.findIndex((ev) => ev.code === e.over!.id);
    if (to >= 0) move(String(e.active.id), to);
  };

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
                      {/* FIX4: every chip is the event code, the same format for all of them; the full name is its tooltip. */}
                      <span className="max-w-[11rem] truncate uppercase" title={event.name} aria-label={event.name}>
                        {event.code}
                      </span>
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
                        onMakePrimary={(code) => move(code, 0)}
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Selected events ({events.length})
            </h2>
            {canReorder && <span className="text-xs text-[var(--muted-foreground)]">Drag to reorder. The first event is the primary.</span>}
          </div>
          <div aria-live="polite" className="min-h-[1.25rem]">
            {note && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={spring} data-testid="primary-note" className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                <Check className="h-3.5 w-3.5" aria-hidden /> {note}
              </motion.p>
            )}
          </div>
          <DndContext id="selected-events" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={events.map((e) => e.code)} strategy={rectSortingStrategy} disabled={!canReorder}>
              <ul className={cn("grid grid-cols-1 gap-2", canReorder ? "lg:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")} data-testid="selected-events-list">
                <AnimatePresence initial={false}>
                  {events.map((event, index) => (
                    <SortableEventCard
                      key={event.code}
                      event={event}
                      index={index}
                      count={events.length}
                      isPrimary={event.code === primaryCode}
                      canEdit={canEdit}
                      canReorder={canReorder}
                      now={now}
                      onRemove={onRemove}
                      onMove={move}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </SortableContext>
          </DndContext>
        </GlassPanel>
      </div>
    </>
  );
}

/** One selected event in the big panel: a sortable card (drag grip, up/down arrows) around the shared row. */
function SortableEventCard({
  event,
  index,
  count,
  isPrimary,
  canEdit,
  canReorder,
  now,
  onRemove,
  onMove,
}: {
  event: FtcEvent;
  index: number;
  count: number;
  isPrimary: boolean;
  canEdit: boolean;
  canReorder: boolean;
  now: number;
  onRemove: (event: FtcEvent) => void;
  onMove: (code: string, toIndex: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: event.code, disabled: !canReorder });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("list-none", isDragging && "relative z-10 opacity-70")} data-testid={`selected-event-${event.code}`}>
      <motion.div layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={spring} className="glass-card">
        <EventRow
          event={event}
          isPrimary={isPrimary}
          canEdit={canEdit}
          now={now}
          onRemove={onRemove}
          onMakePrimary={(code) => onMove(code, 0)}
          reorder={
            canReorder
              ? {
                  index,
                  count,
                  onMove: (to) => onMove(event.code, to),
                  grip: (
                    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag ${event.name} to reorder`} className={dragGripClass}>
                      <GripVertical className="h-4 w-4" />
                    </button>
                  ),
                }
              : undefined
          }
        />
      </motion.div>
    </li>
  );
}

function EventRow({
  event,
  isPrimary,
  canEdit,
  now,
  onRemove,
  onMakePrimary,
  reorder,
}: {
  event: FtcEvent;
  isPrimary: boolean;
  canEdit: boolean;
  now: number;
  onRemove: (event: FtcEvent) => void;
  onMakePrimary: (code: string) => void;
  /** The drag grip and up/down arrows, only in the big panel and only when there is something to reorder. */
  reorder?: { index: number; count: number; onMove: (toIndex: number) => void; grip: React.ReactNode };
}) {
  const status = STATUS_BADGE[getEventStatus(event, now)];

  return (
    <div className="flex items-center gap-1 rounded-xl p-2.5 sm:gap-2" onClick={(e) => e.stopPropagation()}>
      {reorder?.grip}
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
      {reorder && (
        <>
          <button
            type="button"
            onClick={() => reorder.onMove(reorder.index - 1)}
            disabled={reorder.index === 0}
            aria-label={`Move ${event.name} up`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => reorder.onMove(reorder.index + 1)}
            disabled={reorder.index === reorder.count - 1}
            aria-label={`Move ${event.name} down`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </>
      )}
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
