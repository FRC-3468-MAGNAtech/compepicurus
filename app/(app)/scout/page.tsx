"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Minus, Plus, Send } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { spring, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

function Counter({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="glass-card flex items-center justify-between p-4">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          transition={springSnappy}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 hover:bg-white/12"
        >
          <Minus className="h-3.5 w-3.5" />
        </motion.button>
        <span className="w-6 text-center text-base font-semibold tabular-nums">{value}</span>
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          transition={springSnappy}
          onClick={() => onChange(value + 1)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-white"
          style={{ background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }}
        >
          <Plus className="h-3.5 w-3.5" />
        </motion.button>
      </div>
    </div>
  );
}

export default function MatchScoutFormPage() {
  const [alliance, setAlliance] = useState("red");
  const [autoLeave, setAutoLeave] = useState(false);
  const [autoScored, setAutoScored] = useState(0);
  const [teleopScored, setTeleopScored] = useState(0);
  const [defensePlayed, setDefensePlayed] = useState(false);
  const [endgame, setEndgame] = useState("Parked");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 2600);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Match Scout Form</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Log what you see, live, match by match.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <GlassPanel className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Match info</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="match-number">Match #</Label>
              <Input id="match-number" type="number" min={1} defaultValue={15} required />
            </div>
            <div>
              <Label htmlFor="team-number">Team #</Label>
              <Input id="team-number" type="number" min={1} placeholder="3468" required />
            </div>
            <div>
              <Label htmlFor="alliance">Alliance</Label>
              <Select value={alliance} onValueChange={setAlliance}>
                <SelectTrigger id="alliance">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="red">Red</SelectItem>
                  <SelectItem value="blue">Blue</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </GlassPanel>

        <GlassPanel className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Autonomous</h2>
          <div className="flex items-center justify-between">
            <Label htmlFor="auto-leave" className="mb-0">Left starting zone</Label>
            <Switch id="auto-leave" checked={autoLeave} onCheckedChange={setAutoLeave} />
          </div>
          <Counter label="Pieces scored" value={autoScored} onChange={setAutoScored} />
        </GlassPanel>

        <GlassPanel className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Teleop</h2>
          <Counter label="Pieces scored" value={teleopScored} onChange={setTeleopScored} />
          <div className="flex items-center justify-between">
            <Label htmlFor="defense" className="mb-0">Played defense</Label>
            <Switch id="defense" checked={defensePlayed} onCheckedChange={setDefensePlayed} />
          </div>
        </GlassPanel>

        <GlassPanel className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Endgame</h2>
          <div className="grid grid-cols-3 gap-2">
            {["None", "Parked", "Climbed"].map((option) => {
              const active = endgame === option;
              return (
                <motion.button
                  key={option}
                  type="button"
                  onClick={() => setEndgame(option)}
                  whileTap={{ scale: 0.96 }}
                  transition={spring}
                  className={cn(
                    "relative rounded-2xl px-3 py-3 text-sm font-medium",
                    active ? "text-[var(--color-primary-foreground)]" : "glass-card text-[var(--muted-foreground)]"
                  )}
                  style={
                    active
                      ? { background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }
                      : undefined
                  }
                >
                  {option}
                </motion.button>
              );
            })}
          </div>
        </GlassPanel>

        <GlassPanel className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Notes</h2>
          <Textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything notable — robot issues, standout driving, penalties..."
          />
        </GlassPanel>

        <Button type="submit" size="lg" className="gap-2 self-start">
          <Send className="h-4 w-4" /> Submit match
        </Button>
      </form>

      <AnimatePresence>
        {submitted && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={springSnappy}
            className="glass-strong fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-5 py-3 text-sm font-medium shadow-2xl"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Match logged (placeholder — not saved anywhere yet)
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
