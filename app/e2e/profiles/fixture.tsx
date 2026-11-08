"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ProfileBody } from "@/components/profile/profile-body";
import { ProfileEditorForm } from "@/components/profile/privacy-profile-section";
import { ProfileScreen } from "@/components/profile/profile-screen";
import type { EventAttendance } from "@/lib/event-attendance";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ProfileEdit } from "@/lib/profile/service";
import type { ProfileDoc } from "@/lib/profile/model";
import { computeProfileStats, eventTargetProgress } from "@/lib/profile/stats";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { TeamMember } from "@/lib/team-members";

declare global {
  interface Window {
    /** Every profile the Settings editor saved. */
    __saves?: ProfileEdit[];
    /** FIX4: every visibility the Settings toggle saved on its own. */
    __visibilitySaves?: string[];
    /** Every clear the moderation button performed. */
    __cleared?: string[];
  }
}

// Fixed "now" (2026-03-10, local noon) so the streak, "last active" and the badges are the same on every run.
const NOW = new Date(2026, 2, 10, 12);
const day = (d: number, h = 12) => new Date(2026, 2, d, h).toISOString();

const ADA: TeamMember = { uid: "ada", name: "Ada Lovelace", email: "ada@example.com", primaryRole: "match-scout", secondaryRoles: ["pit-scout"], isAdmin: false, isOwner: false, joinedAtMs: new Date(2025, 8, 1).getTime() };
const BEN: TeamMember = { uid: "ben", name: "Ben Carter", email: "ben@example.com", primaryRole: "drive-team", secondaryRoles: [], isAdmin: false, isOwner: false };
const ROOT: TeamMember = { uid: "root", name: "Root Admin", email: "root@example.com", primaryRole: "lead-scout", secondaryRoles: [], isAdmin: true, isOwner: true };

function session(id: string, uid: string, o: Partial<PracticeSession>): PracticeSession {
  return {
    id,
    teamId: "t1",
    uid,
    scoutName: uid,
    kind: "solo",
    seasonId: "s",
    mode: "trial",
    difficulty: "medium",
    libraryMatchId: null,
    eventCode: null,
    alliance: "red",
    robots: [1, 2],
    status: "completed",
    completedRobots: [1, 2],
    entryIds: ["a", "b"],
    accuracy: 92,
    scoutedTotal: 92,
    penaltyPoints: 0,
    officialScore: 100,
    platform: "pc",
    flags: [],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: day(10, 9),
    finishedAt: day(10, 9),
    matchType: null,
    matchNumber: null,
    allianceTeams: null,
    streamUrl: null,
    streamStartSec: null,
    streamEndSec: null,
    ...o,
  };
}

function entry(id: string, uid: string, o: Partial<ScoutEntry>): ScoutEntry {
  return {
    id,
    teamId: "t1",
    uid,
    source: "event",
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: uid,
    eventCode: "USWABON1",
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber: 1,
    fields: {} as ScoutEntry["fields"],
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "",
    submittedAt: day(9, 15),
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
    ...o,
  };
}

// Ada: five practice days in a row ending today (so the 5-day streak and a 100% session), two sessions on mobile, a
// Competitive session, and three events with entries (one a perfect alliance).
const SESSIONS: PracticeSession[] = [
  session("s1", "ada", { finishedAt: day(6), accuracy: 88 }),
  session("s2", "ada", { finishedAt: day(7), accuracy: 94, platform: "mobile" }),
  session("s3", "ada", { finishedAt: day(8), accuracy: 100 }),
  session("s4", "ada", { finishedAt: day(9), accuracy: 91, mode: "competitive" }),
  session("s5", "ada", { finishedAt: day(10, 8), accuracy: 96, platform: "mobile" }),
  session("s6", "ada", { finishedAt: day(10, 9), accuracy: 70, excluded: true }),
  session("b1", "ben", { finishedAt: day(2), accuracy: 80 }),
];
const ATTENDANCE: EventAttendance[] = [
  { id: "t1_USWABON1", teamId: "t1", eventCode: "USWABON1", uids: ["ada", "ben"], updatedAt: null },
  { id: "t1_USWAYAK1", teamId: "t1", eventCode: "USWAYAK1", uids: ["ada"], updatedAt: null },
  { id: "t1_USWASPO1", teamId: "t1", eventCode: "USWASPO1", uids: ["ada"], updatedAt: null },
];
const done = { status: "complete" as const, value: 1, scoutedTotal: 60, penaltyPoints: 0, officialScore: 60 };
const ENTRIES: ScoutEntry[] = [
  entry("e1", "ada", { matchNumber: 1, accuracy: done }),
  entry("e2", "ada", { matchNumber: 2, accuracy: { ...done, value: 0.9 } }),
  entry("e3", "ada", { matchNumber: 3, accuracy: { ...done, value: 0.8 } }),
  entry("e4", "ada", { eventCode: "USWAYAK1", matchNumber: 1 }),
  entry("e5", "ben", { matchNumber: 4, accuracy: { ...done, value: 0.7 } }),
];

const EVENT_NAMES: Record<string, string> = { USWABON1: "Bonney Lake Qualifier", USWAYAK1: "Yakima Qualifier", USWASPO1: "Spokane Qualifier" };
const eventName = (code: string) => EVENT_NAMES[code] ?? code;

function Fixture() {
  const q = useSearchParams();
  const view = q.get("view") === "editor" ? "editor" : "profile";
  return (
    <div className="mx-auto w-full max-w-[1100px] px-3 pb-6 pt-4 lg:px-6">
      {view === "editor" ? <EditorFixture /> : <ProfileFixture />}
    </div>
  );
}

function ProfileFixture() {
  const q = useSearchParams();
  const viewerKey = q.get("viewer") ?? "teammate";
  const isPrivate = q.get("private") === "1";
  const empty = q.get("empty") === "1";
  const loading = q.get("loading") === "1";
  const noBio = q.get("bio") === "none";
  const withTarget = q.get("target") !== "none";

  const viewer = viewerKey === "self" ? ADA : viewerKey === "admin" ? ROOT : BEN;
  const [profile, setProfile] = useState<ProfileDoc | null>(() => ({
    teamId: "t1",
    displayName: "Ada L.",
    bio: noBio ? "" : "Counts everything twice.\nLoves a clean auto.",
    pronouns: noBio ? "" : "she/her",
    avatar: { type: "preset", value: "rocket" },
    visibility: isPrivate ? "private" : "public",
  }));

  useEffect(() => {
    window.__cleared = [];
  }, []);

  const stats = useMemo(
    () =>
      loading
        ? null
        : computeProfileStats({
            uid: "ada",
            members: [ADA, BEN, ROOT],
            sessions: empty ? [] : SESSIONS,
            entries: empty ? [] : ENTRIES,
            libraryMatchesById: new Map(),
            attendance: empty ? [] : ATTENDANCE,
            now: NOW,
          }),
    [loading, empty]
  );
  const target = useMemo(
    () =>
      withTarget && !empty
        ? eventTargetProgress({ uid: "ada", eventCode: "USWABON1", entries: ENTRIES, setup: { ranges: {}, maxOverrides: {}, individual: { ada: { qualification: 6 } }, extraScouts: [] }, slots: [] })
        : null,
    [withTarget, empty]
  );

  const member = ADA;
  // What the rules do: a private profile is refused to a teammate who isn't an admin (and is always readable by its owner and by admins).
  // `?denied=1` makes the read itself fail whoever is looking (a rules problem): your own profile must still show.
  const denied = (isPrivate && viewer.uid !== "ada" && !viewer.isAdmin) || q.get("denied") === "1";

  return (
    <ProfileScreen
      member={member}
      profile={profile}
      denied={denied}
      viewer={{ uid: viewer.uid, isAdmin: viewer.isAdmin }}
      renderFull={({ canModerate, isSelf }) => (
        <ProfileBody
          member={member}
          profile={profile}
          isSelf={isSelf}
          stats={stats}
          nowMs={NOW.getTime()}
          eventName={eventName}
          target={target}
          targetEventName={target ? eventName(target.eventCode) : null}
          canModerate={canModerate}
          onClear={async () => {
            window.__cleared?.push("ada");
            setProfile((p) => (p ? { ...p, bio: "", pronouns: "" } : p));
          }}
        />
      )}
    />
  );
}

function EditorFixture() {
  const q = useSearchParams();
  const isAdmin = q.get("admin") === "1";
  const savedKey = q.get("saved") ?? "none";
  const google = q.get("google") === "1";
  const failSave = q.get("fail") === "1";
  const [justSaved, setJustSaved] = useState(false);
  const [saved, setSaved] = useState<ProfileDoc | null>(() =>
    savedKey === "none" ? null : { teamId: "t1", displayName: "Ada L.", bio: "Existing bio", pronouns: "she/her", avatar: { type: "initials", value: "" }, visibility: savedKey === "private" ? "private" : "public" }
  );

  useEffect(() => {
    window.__saves = [];
    window.__visibilitySaves = [];
  }, []);

  return (
    <ProfileEditorForm
      key={JSON.stringify([saved?.displayName ?? "", saved?.bio ?? "", saved?.pronouns ?? "", saved?.avatar ?? { type: "initials", value: "" }])}
      saved={saved}
      isAdmin={isAdmin}
      accountName="Ada Lovelace"
      accountAvatar={null}
      googleUrl={google ? "https://lh3.googleusercontent.com/a/example=s96-c" : null}
      justSaved={justSaved}
      onSave={async (edit) => {
        if (failSave) throw new Error("offline");
        window.__saves?.push(edit);
        setSaved({ teamId: "t1", ...edit });
        setJustSaved(true);
      }}
      onSetVisibility={async (visibility) => {
        if (failSave) throw new Error("offline");
        window.__visibilitySaves?.push(visibility);
        setSaved((prev) => ({ teamId: "t1", displayName: prev?.displayName ?? "", bio: prev?.bio ?? "", pronouns: prev?.pronouns ?? "", avatar: prev?.avatar ?? { type: "initials", value: "" }, visibility }));
      }}
    />
  );
}

export function ProfilesFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}
