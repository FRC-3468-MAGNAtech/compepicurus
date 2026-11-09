"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type TeamOption = { teamNumber: number; name: string };

/**
 * P27: a searchable chooser for a team at the chosen event (the `teamPicker` outside a match: the pit scout's team, and the box inside each per-team group so a
 * wrong team on the schedule can be corrected). Type a number or part of a name; the list is the event's teams. `value` is "" until chosen.
 */
export function TeamSelect({
  id,
  label,
  value,
  teams,
  disabled,
  invalid,
  placeholder = "Choose a team",
  onChange,
}: {
  id: string;
  label: string;
  value: number | string;
  teams: TeamOption[];
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  onChange: (team: number | "") => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const chosen = typeof value === "number" ? teams.find((t) => t.teamNumber === value) : undefined;
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase().replace(/^#/, "");
    if (!query) return teams;
    return teams.filter((t) => String(t.teamNumber).includes(query) || t.name.toLowerCase().includes(query));
  }, [teams, q]);

  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
       
        aria-label={`${label}: ${chosen ? `${chosen.teamNumber} ${chosen.name}` : typeof value === "number" ? String(value) : "none chosen"}`}
        onClick={() => {
          setQ("");
          setOpen(true);
        }}
        className={cn("glass-card flex h-12 w-full items-center justify-between gap-2 rounded-2xl border border-[var(--glass-border)] px-4 text-left text-sm", invalid && "border-red-400/60", disabled && "opacity-60")}
        data-testid="team-select"
      >
        <span className="min-w-0 truncate">
          {typeof value === "number" ? (
            <>
              <span className="font-semibold tabular-nums">{value}</span>
              {chosen && <span className="ml-2 text-[var(--muted-foreground)]">{chosen.name}</span>}
            </>
          ) : (
            <span className="text-[var(--muted-foreground)]">{placeholder}</span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] sm:max-w-md">
          <DialogTitle className="pr-8">{label}</DialogTitle>
          <DialogDescription>Pick a team at this event.</DialogDescription>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by number or name" inputMode="search" className="pl-10" aria-label="Search teams" data-testid="team-search" />
          </div>
          <ul className="mt-3 flex max-h-[50dvh] flex-col gap-1 overflow-y-auto" data-testid="team-options">
            {shown.length === 0 && <li className="px-2 py-6 text-center text-sm text-[var(--muted-foreground)]">{teams.length === 0 ? "No teams are listed for this event yet." : "No team matches that."}</li>}
            {shown.map((t) => (
              <li key={t.teamNumber}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(t.teamNumber);
                    setOpen(false);
                  }}
                  data-team={t.teamNumber}
                  className={cn("glass-card flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm", t.teamNumber === value && "ring-2 ring-[var(--color-primary)]")}
                >
                  <span className="w-14 shrink-0 font-semibold tabular-nums">{t.teamNumber}</span>
                  <span className="min-w-0 truncate text-[var(--muted-foreground)]">{t.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
