"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoutForm, type ScoutFormHandle } from "@/components/scout/scout-form";
import { ScoutingWorkspace } from "@/components/practice/scouting-workspace";
import { VideoPlayer } from "@/components/video/video-player";
import type { VideoPlayerHandle } from "@/components/video/types";
import { BIOBUZZ_FORM } from "@/lib/forms/builtin";
import type { StickyNote } from "@/lib/forms/types";
import { joinNotes } from "@/lib/forms/values";
import { calculateScore } from "@/lib/forms/scoring";

declare global {
  interface Window {
    /** What the fixture "saved": one entry per robot, with the comments it was submitted with. */
    __submitted?: { team: number; comments: string; autoLeave: boolean }[];
  }
}

const ROBOTS = [1234, 5678];

function Fixture() {
  const mode = useSearchParams().get("mode") === "competitive" ? "competitive" : "trial";
  const novideo = useSearchParams().get("novideo") === "1";
  const [robot, setRobot] = useState(0);
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [done, setDone] = useState(false);
  const [saved] = useState<NonNullable<Window["__submitted"]>>(() => []);
  const form = useRef<ScoutFormHandle>(null);
  const video = useRef<VideoPlayerHandle>(null);

  useEffect(() => {
    window.__submitted = saved;
  }, [saved]);

  const next = () => {
    const handle = form.current;
    if (!handle || !handle.validate()) return;
    const v = handle.getValues();
    void calculateScore(BIOBUZZ_FORM, v.values);
    saved.push({ team: ROBOTS[robot], comments: String(v.values.comments ?? ""), autoLeave: v.values.autoLeave === true });
    if (robot === ROBOTS.length - 1) return setDone(true);
    setRobot((r) => r + 1);
    setNotes([]);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-6 pt-4 lg:px-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="glass">Fixture</Badge>
        <Badge variant="outline">{mode}</Badge>
        <Badge variant="outline" data-testid="robot-badge">
          Robot {robot + 1} of {ROBOTS.length}
        </Badge>
        {done && <span data-testid="done">Session finished</span>}
      </div>
      <ScoutingWorkspace
        video={novideo ? null : <VideoPlayer ref={video} fill video={null} usePlaceholder lockPause={mode === "competitive"} />}
        videoNote={mode === "competitive" ? "Competitive: video can't be paused." : null}
        form={
          <ScoutForm
            key={robot}
            ref={form}
            mode="practice"
            layout="side-panel"
            hideMatchPicker
            showSubmitButton={false}
            lockedFields={["teamNumber"]}
            prefill={{ teamNumber: ROBOTS[robot], scoutName: "Fixture Scout" }}
            commentsMode="popout"
            comments={joinNotes(notes)}
            onCommentsChange={() => undefined}
          />
        }
        comments={{ notes, onChange: setNotes, label: `Robot ${robot + 1}: #${ROBOTS[robot]}` }}
        actions={
          <>
            <Button variant="ghost" className="gap-1.5 text-red-300">
              <X className="h-4 w-4" /> Cancel
            </Button>
            <Button size="lg" className="gap-2" onClick={next} data-testid="next-robot">
              <Send className="h-4 w-4" /> {robot === ROBOTS.length - 1 ? "Finish Session" : `Next Robot (${robot + 1}/${ROBOTS.length})`}
            </Button>
          </>
        }
      />
      {/* page content below the workspace: it must stay out of reach (the page doesn't scroll while the workspace is open) */}
      <footer className="mt-10 h-[600px] text-sm text-[var(--muted-foreground)]">Footer that is never reached</footer>
    </div>
  );
}

export function WorkspaceFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}
