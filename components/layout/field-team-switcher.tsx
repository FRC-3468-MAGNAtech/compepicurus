"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronsUpDown } from "lucide-react";
import { fieldTeamLabel, type FieldTeam } from "@/lib/field-teams";
import { useActiveFieldTeam } from "@/lib/field-teams-context";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

const POPOVER_WIDTH = 248;
const GAP = 8;

/**
 * P19: the sidebar's FTC team display. Shows the active team's number and name ("FTC 35792" over its
 * name); when the user is assigned to more than one it becomes a compact switcher (popover listing
 * their assigned teams, choice saved to their profile). Collapsed, it is just the number. Realtime:
 * it reads the shared team doc, so a Team Settings change shows up here on its own.
 */
export function FieldTeamSwitcher({ collapsed }: { collapsed: boolean }) {
  const { loaded, activeFieldTeam, setActiveFieldTeam, assignedFieldTeams, canSwitch } = useActiveFieldTeam();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [error, setError] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      setCoords({ top: rect.bottom + GAP, left: Math.min(Math.max(8, rect.left), window.innerWidth - POPOVER_WIDTH - 8) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Put the keyboard on the current choice as soon as the list is up.
  useEffect(() => {
    if (open && coords) popoverRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
  }, [open, coords]);

  if (!loaded && !activeFieldTeam) {
    return <div className={cn("h-8 animate-pulse rounded-xl bg-white/6", collapsed ? "mx-auto w-10" : "mx-1.5")} aria-hidden />;
  }
  if (!activeFieldTeam) return null;

  const choose = async (team: FieldTeam) => {
    setOpen(false);
    triggerRef.current?.focus();
    if (team.id === activeFieldTeam.id) return;
    setError(false);
    try {
      await setActiveFieldTeam(team.id);
    } catch {
      setError(true);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const options = Array.from(popoverRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const i = options.indexOf(document.activeElement as HTMLElement);
    options[(i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
  };

  const content = collapsed ? (
    <span className="text-[11px] font-semibold tabular-nums" title={fieldTeamLabel(activeFieldTeam)}>
      {activeFieldTeam.number}
    </span>
  ) : (
    <span className="flex min-w-0 flex-1 flex-col text-left">
      <span className="truncate text-xs font-semibold tabular-nums">{fieldTeamLabel(activeFieldTeam)}</span>
      {activeFieldTeam.name && <span className="truncate text-[11px] text-[var(--muted-foreground)]">{activeFieldTeam.name}</span>}
    </span>
  );

  if (!canSwitch) {
    return (
      <div
        className={cn("flex min-h-9 items-center rounded-xl", collapsed ? "justify-center" : "px-2.5")}
        title={collapsed ? [fieldTeamLabel(activeFieldTeam), activeFieldTeam.name].filter(Boolean).join(" · ") : undefined}
        data-testid="field-team-display"
      >
        {content}
      </div>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Viewing as ${fieldTeamLabel(activeFieldTeam)}. Switch FTC team`}
        data-testid="field-team-switcher"
        className={cn(
          "glass-pill touch-compact flex min-h-9 items-center gap-1.5 text-[var(--foreground)] transition-shadow hover:shadow-[0_0_18px_2px_rgba(var(--glow),0.3)]",
          collapsed ? "mx-auto w-full justify-center px-1" : "w-full px-2.5 py-1.5",
          open && "shadow-[0_0_18px_2px_rgba(var(--glow),0.4)]"
        )}
      >
        {content}
        {!collapsed && <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden />}
      </button>
      {error && !collapsed && <p role="alert" className="px-2.5 text-[11px] text-red-300">Couldn&apos;t switch teams. Try again.</p>}

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                ref={popoverRef}
                id={listId}
                role="listbox"
                aria-label="Your FTC teams"
                onKeyDown={onListKeyDown}
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={springSnappy}
                // glass-overlay: a solid backing, so team names stay legible over whatever is behind (every theme).
                className="glass-overlay fixed z-50 flex flex-col gap-1 rounded-2xl p-2 shadow-2xl"
                style={{ width: POPOVER_WIDTH, left: coords.left, top: coords.top }}
              >
                <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">View as</div>
                {assignedFieldTeams.map((t) => {
                  const selected = t.id === activeFieldTeam.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => void choose(t)}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-xl px-2.5 text-left outline-none transition-colors hover:bg-white/8 focus-visible:bg-white/10",
                        selected && "bg-white/8"
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-semibold tabular-nums">{fieldTeamLabel(t)}</span>
                        {t.name && <span className="truncate text-xs text-[var(--muted-foreground)]">{t.name}</span>}
                      </span>
                      {selected && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
