"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, GripVertical, Plus, X } from "lucide-react";
import { PickStats } from "@/components/pick-list/pick-stats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { placeOpFromList, type PickOp } from "@/lib/pick-list/ops";
import type { PickRow } from "@/lib/pick-list/rows";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

// The two-column Pick List board (P12): Available (everyone not picked) and
// Picked (our priority order). Drag and drop is @dnd-kit; every drag action also
// has an explicit button (Add / Move up / Move down / Remove) so the board
// works from a touchscreen or a keyboard. Every change leaves here as a
// `PickOp` — nothing in this file writes an array back — see lib/pick-list/ops.ts.

const idOf = {
  available: (team: number) => `avail:${team}`,
  picked: (team: number) => `pick:${team}`,
};
const ZONE_AVAILABLE = "zone:available";
const ZONE_PICKED = "zone:picked";

type Parsed = { kind: "avail" | "pick"; team: number } | { kind: "zone-available" } | { kind: "zone-picked" };

function parseId(id: UniqueIdentifier): Parsed | null {
  const s = String(id);
  if (s === ZONE_AVAILABLE) return { kind: "zone-available" };
  if (s === ZONE_PICKED) return { kind: "zone-picked" };
  if (s.startsWith("avail:")) return { kind: "avail", team: Number(s.slice(6)) };
  if (s.startsWith("pick:")) return { kind: "pick", team: Number(s.slice(5)) };
  return null;
}

/** Prefer the card under the pointer over the big column behind it; fall back to the closest card/column. */
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const pool = within.length > 0 ? within : closestCenter(args);
  const cards = pool.filter((c) => !String(c.id).startsWith("zone:"));
  return cards.length > 0 ? cards : pool;
};

export function PickBoard({
  availableRows,
  pickedRows,
  ourRank,
  showEpa,
  canEdit,
  onOp,
  availableEmpty,
}: {
  availableRows: PickRow[];
  pickedRows: PickRow[];
  ourRank: number | null;
  showEpa: boolean;
  canEdit: boolean;
  onOp: (op: PickOp) => void;
  availableEmpty: React.ReactNode;
}) {
  const [mobileTab, setMobileTab] = useState<"available" | "picked">("available");
  const [active, setActive] = useState<{ team: number; from: "avail" | "pick" } | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch: a short press-and-hold on the grip starts a drag, so scrolling the page still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const pickedOrder = pickedRows.map((r) => r.teamNumber);
  const activeRow = active ? [...availableRows, ...pickedRows].find((r) => r.teamNumber === active.team) : null;

  const onDragStart = (e: DragStartEvent) => {
    const p = parseId(e.active.id);
    if (p && (p.kind === "avail" || p.kind === "pick")) setActive({ team: p.team, from: p.kind });
  };
  const onDragOver = (e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null);

  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    setOverId(null);
    const a = parseId(e.active.id);
    const o = e.over ? parseId(e.over.id) : null;
    if (!a || !o || (a.kind !== "avail" && a.kind !== "pick")) return;
    const team = a.team;

    if (a.kind === "avail") {
      if (o.kind === "pick") onOp({ type: "place", team, before: o.team });
      else if (o.kind === "zone-picked") onOp({ type: "place", team, before: null });
      return;
    }
    // Dragging a picked team.
    if (o.kind === "pick") {
      if (o.team === team) return;
      const result = arrayMove(pickedOrder, pickedOrder.indexOf(team), pickedOrder.indexOf(o.team));
      onOp(placeOpFromList(result, team));
    } else if (o.kind === "zone-picked") {
      onOp({ type: "place", team, before: null });
    } else {
      onOp({ type: "remove", team }); // dropped back on Available
    }
  };

  return (
    <DndContext
      // A stable id keeps dnd-kit's generated aria ids identical between the server render and hydration.
      id="pick-list-board"
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        setOverId(null);
      }}
    >
      {/* Phones: the two columns become two tabs. */}
      <div className="mb-3 lg:hidden">
        <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as "available" | "picked")}>
          <TabsList className="w-full justify-between">
            <TabsTrigger value="available" className="flex-1">
              Available
            </TabsTrigger>
            <TabsTrigger value="picked" className="flex-1">
              Picked ({pickedRows.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Column
          title="Available"
          count={availableRows.length}
          zoneId={ZONE_AVAILABLE}
          dropHint={active?.from === "pick" ? "Drop here to remove from Picked" : null}
          className={mobileTab === "available" ? "block" : "hidden lg:block"}
        >
          {availableRows.length === 0 ? (
            <EmptyNote>{availableEmpty}</EmptyNote>
          ) : (
            availableRows.map((row) => (
              <AvailableCard key={row.teamNumber} row={row} ourRank={ourRank} showEpa={showEpa} canEdit={canEdit} onOp={onOp} />
            ))
          )}
        </Column>

        <Column
          title="Picked"
          count={pickedRows.length}
          subtitle="Priority order — first choice on top"
          zoneId={ZONE_PICKED}
          dropHint={active ? "Drop here to add" : null}
          className={mobileTab === "picked" ? "block" : "hidden lg:block"}
        >
          <SortableContext items={pickedOrder.map(idOf.picked)} strategy={verticalListSortingStrategy}>
            {pickedRows.length === 0 ? (
              <EmptyNote>{canEdit ? "Nothing picked yet — tap Add on a team, or drag one here." : "Nothing picked yet."}</EmptyNote>
            ) : (
              pickedRows.map((row, i) => (
                <PickedCard
                  key={row.teamNumber}
                  row={row}
                  ourRank={ourRank}
                  showEpa={showEpa}
                  canEdit={canEdit}
                  onOp={onOp}
                  priority={i + 1}
                  isFirst={i === 0}
                  isLast={i === pickedRows.length - 1}
                  dropIndicator={active?.from === "avail" && overId === idOf.picked(row.teamNumber)}
                />
              ))
            )}
          </SortableContext>
        </Column>
      </div>

      <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.18, 0.89, 0.32, 1.15)" }}>
        {activeRow ? (
          <CardBody
            row={activeRow}
            ourRank={ourRank}
            showEpa={showEpa}
            priority={active?.from === "pick" ? pickedOrder.indexOf(activeRow.teamNumber) + 1 : undefined}
            glow
            handle={<Grip />}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// --- columns -----------------------------------------------------------------------

function Column({
  title,
  subtitle,
  count,
  zoneId,
  dropHint,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  zoneId: string;
  dropHint: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: zoneId });
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {title}
          <span className="glass-pill px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal tabular-nums">{count}</span>
        </h2>
        {subtitle && <span className="text-xs text-[var(--muted-foreground)]">{subtitle}</span>}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "relative flex min-h-40 flex-col gap-2 rounded-3xl border border-dashed border-transparent p-1 transition-[border-color,background-color] duration-200 lg:max-h-[72vh] lg:overflow-y-auto",
          isOver && dropHint && "border-[rgba(var(--glow),0.6)] bg-[rgba(var(--glow),0.06)]"
        )}
      >
        {isOver && dropHint && (
          <div className="pointer-events-none sticky top-0 z-10 -mb-1 self-center rounded-full bg-[var(--overlay-bg)] px-3 py-1 text-xs font-medium shadow-lg">{dropHint}</div>
        )}
        {children}
      </div>
    </section>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="glass-card flex flex-1 items-center justify-center p-8 text-center text-sm text-[var(--muted-foreground)]">{children}</div>;
}

// --- cards -------------------------------------------------------------------------

function Grip() {
  return (
    <span className="flex h-11 w-9 shrink-0 items-center justify-center text-[var(--muted-foreground)]">
      <GripVertical className="h-5 w-5" />
    </span>
  );
}

/** The card's look, shared by the in-list cards and the drag overlay. */
function CardBody({
  row,
  ourRank,
  showEpa,
  priority,
  handle,
  actions,
  glow,
  className,
}: {
  row: PickRow;
  ourRank: number | null;
  showEpa: boolean;
  priority?: number;
  handle?: React.ReactNode;
  actions?: React.ReactNode;
  glow?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass-card flex flex-col gap-2 p-3 transition-shadow",
        glow && "scale-[1.02] shadow-[0_0_32px_4px_rgba(var(--glow),0.45)] ring-2 ring-[rgba(var(--glow),0.6)]",
        className
      )}
    >
      <div className="flex items-center gap-2">
        {handle}
        {priority !== undefined && (
          <Badge variant="accent" className="h-8 min-w-8 justify-center text-sm tabular-nums" aria-label={`Priority ${priority}`}>
            {priority}
          </Badge>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold tabular-nums">{row.teamNumber}</div>
          <div className="truncate text-xs text-[var(--muted-foreground)]">{row.teamName ?? "—"}</div>
        </div>
        {actions}
      </div>
      <PickStats row={row} ourRank={ourRank} showEpa={showEpa} />
    </div>
  );
}

const iconButton =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] outline-none transition-colors hover:bg-white/10 hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)] disabled:pointer-events-none disabled:opacity-30";

function AvailableCard({ row, ourRank, showEpa, canEdit, onOp }: { row: PickRow; ourRank: number | null; showEpa: boolean; canEdit: boolean; onOp: (op: PickOp) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: idOf.available(row.teamNumber), disabled: !canEdit });

  return (
    <motion.div layout="position" transition={spring} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
      <div ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
        <CardBody
          row={row}
          ourRank={ourRank}
          showEpa={showEpa}
          handle={
            canEdit ? (
              <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag team ${row.teamNumber}`} className="touch-none cursor-grab rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)] active:cursor-grabbing">
                <Grip />
              </button>
            ) : undefined
          }
          actions={
            canEdit ? (
              <Button size="md" className="h-11 gap-1.5 px-4" onClick={() => onOp({ type: "place", team: row.teamNumber, before: null })} aria-label={`Add team ${row.teamNumber} to picked`}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            ) : undefined
          }
        />
      </div>
    </motion.div>
  );
}

function PickedCard({
  row,
  ourRank,
  showEpa,
  canEdit,
  onOp,
  priority,
  isFirst,
  isLast,
  dropIndicator,
}: {
  row: PickRow;
  ourRank: number | null;
  showEpa: boolean;
  canEdit: boolean;
  onOp: (op: PickOp) => void;
  priority: number;
  isFirst: boolean;
  isLast: boolean;
  dropIndicator: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: idOf.picked(row.teamNumber), disabled: !canEdit });

  return (
    // The outer element animates button-driven moves (framer layout); the inner one is dnd-kit's own drag transform.
    <motion.div layout="position" transition={spring} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="relative">
      {dropIndicator && <div className="absolute -top-1.5 left-2 right-2 z-10 h-1 rounded-full" style={{ background: "var(--theme-gradient-h)" }} />}
      <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "opacity-40")}>
        <CardBody
          row={row}
          ourRank={ourRank}
          showEpa={showEpa}
          priority={priority}
          handle={
            canEdit ? (
              <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag team ${row.teamNumber} to reorder`} className="touch-none cursor-grab rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)] active:cursor-grabbing">
                <Grip />
              </button>
            ) : undefined
          }
          actions={
            canEdit ? (
              <div className="flex items-center">
                <button type="button" className={iconButton} disabled={isFirst} onClick={() => onOp({ type: "move", team: row.teamNumber, delta: -1 })} aria-label={`Move team ${row.teamNumber} up`}>
                  <ChevronUp className="h-5 w-5" />
                </button>
                <button type="button" className={iconButton} disabled={isLast} onClick={() => onOp({ type: "move", team: row.teamNumber, delta: 1 })} aria-label={`Move team ${row.teamNumber} down`}>
                  <ChevronDown className="h-5 w-5" />
                </button>
                <button type="button" className={cn(iconButton, "hover:text-red-300")} onClick={() => onOp({ type: "remove", team: row.teamNumber })} aria-label={`Remove team ${row.teamNumber} from picked`}>
                  <X className="h-5 w-5" />
                </button>
              </div>
            ) : undefined
          }
        />
      </div>
    </motion.div>
  );
}
