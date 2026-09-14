"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FlaskConical, RotateCcw, Send } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { springSnappy } from "@/lib/motion";

export default function PracticeScoutingPage() {
  const [autoScored, setAutoScored] = useState(0);
  const [teleopScored, setTeleopScored] = useState(0);
  const [logged, setLogged] = useState(false);

  const reset = () => {
    setAutoScored(0);
    setTeleopScored(0);
    setLogged(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLogged(true);
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <GlassPanel strong className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ background: "rgba(var(--glow), 0.16)" }}>
          <FlaskConical className="h-5 w-5" style={{ color: "var(--color-primary)" }} />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Practice Scouting</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            A sandbox copy of the scout form &mdash; nothing here touches real match data.
          </p>
        </div>
        <Badge variant="warning" className="ml-auto">Sandbox</Badge>
      </GlassPanel>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <GlassPanel className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="practice-auto">Auto pieces</Label>
            <Input
              id="practice-auto"
              type="number"
              min={0}
              value={autoScored}
              onChange={(e) => setAutoScored(Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="practice-teleop">Teleop pieces</Label>
            <Input
              id="practice-teleop"
              type="number"
              min={0}
              value={teleopScored}
              onChange={(e) => setTeleopScored(Number(e.target.value))}
            />
          </div>
        </GlassPanel>

        <div className="flex gap-3">
          <Button type="submit" className="gap-2">
            <Send className="h-4 w-4" /> Log practice run
          </Button>
          <Button type="button" variant="glass" onClick={reset} className="gap-2">
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
        </div>
      </form>

      <AnimatePresence>
        {logged && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={springSnappy}
          >
            <GlassPanel className="text-sm text-[var(--muted-foreground)]">
              Practice run logged: <span className="text-[var(--foreground)] font-medium">{autoScored} auto</span> +{" "}
              <span className="text-[var(--foreground)] font-medium">{teleopScored} teleop</span> pieces. Discarded on
              refresh &mdash; this is a sandbox.
            </GlassPanel>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
