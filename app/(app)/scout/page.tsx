"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarX2, CheckCircle2, Send, UserCog } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CounterControl } from "@/components/scout/counter-control";
import { FieldToggle } from "@/components/scout/field-toggle";
import { CheckboxTile } from "@/components/scout/checkbox-tile";
import { SectionNav, type ScoutSection } from "@/components/scout/section-nav";
import { ScoreBar } from "@/components/scout/score-bar";
import { MatchPickerDialog, type AssignedMatch } from "@/components/scout/match-picker-dialog";
import { TeamPickerDialog } from "@/components/scout/team-picker-dialog";
import { useActiveEvent } from "@/lib/active-event";
import { useMockAuth } from "@/lib/mock-auth";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  computeScore,
  initialScoutEntryFields,
  saveEntry,
  type ScoutEntryFields,
} from "@/lib/scout-entries";

const SECTIONS: ScoutSection[] = [
  { id: "assigned-match", label: "Assigned Match" },
  { id: "pre-match", label: "Pre-Match" },
  { id: "autonomous", label: "Autonomous" },
  { id: "teleop", label: "Teleop" },
  { id: "endgame", label: "Endgame" },
  { id: "general", label: "General" },
];

const GENERAL_FLAGS: { key: keyof ScoutEntryFields; label: string }[] = [
  { key: "diedDuringMatch", label: "Died During Match" },
  { key: "neverStartedMatch", label: "Never Started Match" },
  { key: "disabledByFtc", label: "Disabled by FTC" },
  { key: "recoveredFromFreeze", label: "Recovered from Freeze" },
  { key: "tippedOver", label: "Tipped Over" },
  { key: "yellowCard", label: "Yellow Card" },
  { key: "redCard", label: "Red Card" },
];

function matchLabel(assigned: AssignedMatch) {
  const prefix = assigned.type === "Qualification" ? "Q" : assigned.type === "Playoff" ? "M" : "P";
  return `${assigned.type} ${prefix}${assigned.match.matchNumber}`;
}

export default function MatchScoutFormPage() {
  const { activeEvent } = useActiveEvent();
  const { name } = useMockAuth();

  const [assignedMatch, setAssignedMatch] = useState<AssignedMatch | null>(null);
  const [teamNumber, setTeamNumber] = useState<number | null>(null);
  const [fields, setFields] = useState<ScoutEntryFields>(initialScoutEntryFields);

  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [subInRequested, setSubInRequested] = useState(false);
  const [validation, setValidation] = useState<{ match?: boolean; team?: boolean }>({});
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(SECTIONS[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveSectionId(visible[0].target.id);
      },
      { rootMargin: "-120px 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const setField = <K extends keyof ScoutEntryFields>(key: K, value: ScoutEntryFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  const score = computeScore(fields);

  const requestSubIn = () => {
    setSubInRequested(true);
    setTimeout(() => setSubInRequested(false), 3000);
  };

  const handleSubmit = () => {
    const missingMatch = !assignedMatch;
    const missingTeam = teamNumber === null;
    if (missingMatch || missingTeam) {
      setValidation({ match: missingMatch, team: missingTeam });
      document.getElementById("assigned-match")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setValidation({});

    saveEntry({
      scoutName: name,
      eventCode: activeEvent!.code,
      matchType: assignedMatch.type,
      matchNumber: assignedMatch.match.matchNumber,
      teamNumber: teamNumber!,
      fields,
      score,
    });

    setJustSubmitted(true);
    setTimeout(() => setJustSubmitted(false), 2200);
    setFields(initialScoutEntryFields);
    setAssignedMatch(null);
    setTeamNumber(null);
  };

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Match Scout Form</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Log what you see, live, match by match.</p>
      </div>

      <SectionNav sections={SECTIONS} activeId={activeSectionId} />

      <section id="assigned-match" className="scroll-mt-20">
        <GlassPanel className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">Assigned Match</h2>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" className="gap-2" onClick={() => setMatchDialogOpen(true)}>
              {assignedMatch ? matchLabel(assignedMatch) : "Pick match"}
            </Button>
            <Button size="lg" variant="glass" className="gap-2" onClick={requestSubIn}>
              <UserCog className="h-4 w-4" /> Request Sub-In
            </Button>
            {subInRequested && <Badge variant="success">Sub-in request sent</Badge>}
          </div>
          {validation.match && (
            <p className="text-sm font-medium text-red-300">Select a match before submitting.</p>
          )}
          {assignedMatch && (
            <div className="glass-card flex flex-wrap items-center gap-3 p-4 text-sm">
              <Badge variant="accent">{matchLabel(assignedMatch)}</Badge>
              <span className="text-red-300">{assignedMatch.match.redTeams.join(", ") || "TBD"}</span>
              <span className="text-[var(--muted-foreground)]">vs</span>
              <span className="text-blue-300">{assignedMatch.match.blueTeams.join(", ") || "TBD"}</span>
            </div>
          )}
        </GlassPanel>
      </section>

      <section id="pre-match" className="scroll-mt-20">
        <GlassPanel className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">Pre-Match</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Scout name
              </label>
              <Input value={name} readOnly disabled className="text-[var(--muted-foreground)]" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                Team number
              </label>
              {!activeEvent ? (
                <NoEventNotice />
              ) : (
                <Button
                  size="lg"
                  variant={teamNumber ? "primary" : "glass"}
                  className={cn("w-full", validation.team && "ring-2 ring-red-400")}
                  onClick={() => setTeamDialogOpen(true)}
                >
                  {teamNumber ? `Team ${teamNumber}` : "Pick team"}
                </Button>
              )}
            </div>
          </div>
          {validation.team && <p className="text-sm font-medium text-red-300">Select a team before submitting.</p>}
        </GlassPanel>
      </section>

      <section id="autonomous" className="scroll-mt-20">
        <GlassPanel className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Autonomous</h2>
          <FieldToggle label="Leave" pointsWhenOn={3} checked={fields.autoLeave} onChange={(v) => setField("autoLeave", v)} />
          <FieldToggle label="Park" pointsWhenOn={5} checked={fields.autoPark} onChange={(v) => setField("autoPark", v)} />
          <CounterControl label="Tip Hive" pointsPer={20} value={fields.autoTipHive} onChange={(v) => setField("autoTipHive", v)} />
        </GlassPanel>
      </section>

      <section id="teleop" className="scroll-mt-20">
        <GlassPanel className="flex flex-col gap-5">
          <h2 className="text-lg font-bold">Teleoperated</h2>

          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Hive</h3>
            <CounterControl label="Tip Hive" pointsPer={20} value={fields.teleTipHive} onChange={(v) => setField("teleTipHive", v)} />
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Flower</h3>
            <FieldToggle
              label="Bottom Nectar"
              pointsWhenOn={5}
              checked={fields.flowerBottomNectar}
              onChange={(v) => setField("flowerBottomNectar", v)}
            />
            <CounterControl
              label="Pollen and Nectar"
              pointsPer={2}
              value={fields.flowerPollenNectar}
              onChange={(v) => setField("flowerPollenNectar", v)}
            />
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Garden</h3>
            <CounterControl
              label="Pollen and Nectar"
              pointsPer={1}
              value={fields.gardenPollenNectar}
              onChange={(v) => setField("gardenPollenNectar", v)}
            />
          </div>
        </GlassPanel>
      </section>

      <section id="endgame" className="scroll-mt-20">
        <GlassPanel className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Endgame</h2>
          <FieldToggle label="Park" pointsWhenOn={5} checked={fields.endgamePark} onChange={(v) => setField("endgamePark", v)} />
        </GlassPanel>
      </section>

      <section id="general" className="scroll-mt-20">
        <GlassPanel className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">General</h2>
          <p className="text-xs text-[var(--muted-foreground)]">These don&apos;t affect score but are saved with the submission.</p>
          <div className="flex flex-wrap gap-2">
            {GENERAL_FLAGS.map((f) => (
              <CheckboxTile
                key={f.key}
                label={f.label}
                checked={fields[f.key] as boolean}
                onChange={(v) => setField(f.key, v as ScoutEntryFields[typeof f.key])}
              />
            ))}
          </div>
        </GlassPanel>
      </section>

      <Button size="lg" className="mt-1 gap-2 self-start" onClick={handleSubmit}>
        <Send className="h-4 w-4" /> Submit match
      </Button>

      <ScoreBar score={score} />

      <MatchPickerDialog
        open={matchDialogOpen}
        onOpenChange={setMatchDialogOpen}
        activeEvent={activeEvent}
        onSelect={setAssignedMatch}
      />

      {activeEvent && (
        <TeamPickerDialog
          open={teamDialogOpen}
          onOpenChange={setTeamDialogOpen}
          eventCode={activeEvent.code}
          season={activeEvent.season}
          priorityTeamNumbers={
            assignedMatch ? [...assignedMatch.match.redTeams, ...assignedMatch.match.blueTeams] : undefined
          }
          onSelect={setTeamNumber}
        />
      )}

      <AnimatePresence>
        {justSubmitted && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={springSnappy}
            className="glass-strong fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-5 py-3 text-sm font-medium shadow-2xl"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Match logged &mdash; ready for the next one.
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NoEventNotice() {
  return (
    <div className="glass-card flex items-center justify-between gap-3 p-3 text-sm text-[var(--muted-foreground)]">
      <span className="flex items-center gap-2">
        <CalendarX2 className="h-4 w-4 shrink-0" /> No active event
      </span>
      <Link href="/event">
        <Button variant="glass" size="sm">
          Select event
        </Button>
      </Link>
    </div>
  );
}
