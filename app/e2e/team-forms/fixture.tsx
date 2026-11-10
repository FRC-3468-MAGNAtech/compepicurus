"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { FormPageView } from "@/components/forms/form-page";
import { PhotoUploadProvider } from "@/components/forms/photo-upload";
import type { FormEntry, NewFormEntry } from "@/lib/form-entries-model";
import { HELPER_FORM, PIT_SCOUT_FORM, TEAM_STRATEGY_FORM } from "@/lib/forms/builtin-pit-forms";
import { rookieSuggestion } from "@/lib/forms/pit-suggest";
import type { FormValues, StickyNote } from "@/lib/forms/types";
import type { FtcEvent } from "@/lib/ftc/types";

declare global {
  interface Window {
    __saved?: NewFormEntry[];
    __updated?: { id: string; values: FormValues; stickyNotes: StickyNote[] }[];
  }
}

const FORMS = { pit: PIT_SCOUT_FORM, strategy: TEAM_STRATEGY_FORM, helper: HELPER_FORM } as const;
const TITLES = { pit: "Pit Scout Form", strategy: "Team Strategy Form", helper: "Helper Form" } as const;
const ev = (code: string, name: string): FtcEvent => ({ code, season: 2025, name, dateStart: "2025-11-08", dateEnd: "2025-11-08", city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "in-progress" });
const TEAMS = [
  { teamNumber: 111, name: "Rookies", rookieYear: 2025 },
  { teamNumber: 222, name: "Veterans", rookieYear: 2015 },
  { teamNumber: 333, name: "Unknown", rookieYear: null },
];

function Fixture() {
  const q = useSearchParams();
  const which = (q.get("form") ?? "pit") as keyof typeof FORMS;
  const form = FORMS[which];
  const events = q.get("events") === "2" ? [ev("EVT1", "Bonney Lake Qualifier"), ev("EVT2", "Sequim League Meet")] : [ev("EVT1", "Bonney Lake Qualifier")];
  // an earlier entry of mine (and one by someone else) for team 222
  const seeded: FormEntry[] =
    q.get("mine") === "1"
      ? [
          { id: "mine-1", teamId: "t", uid: "me", scoutName: "Ada Lovelace", formId: form.id, formVersion: 1, formType: form.formType as FormEntry["formType"], eventCode: "EVT1", teamNumber: 222, values: { weight: 20, weightUnit: "lb", bestAt: "hive" }, stickyNotes: [{ id: "n1", text: "earlier note", color: "yellow", createdAt: 1 }], flags: [], excluded: false, createdAtMs: 100, updatedAtMs: 100 },
          { id: "other-1", teamId: "t", uid: "someone", scoutName: "Ben", formId: form.id, formVersion: 1, formType: form.formType as FormEntry["formType"], eventCode: "EVT1", teamNumber: 222, values: {}, stickyNotes: [], flags: [], excluded: false, createdAtMs: 50, updatedAtMs: 50 },
        ]
      : [];
  const assigned = q.get("assigned") === "1" ? [{ teamNumber: 111, done: true }, { teamNumber: 222, done: false }, { teamNumber: 333, done: false }] : null;

  useEffect(() => {
    window.__saved = [];
    window.__updated = [];
  }, []);

  return (
    <div className="mx-auto max-w-[900px] p-3">
      <PhotoUploadProvider
        deps={{
          getToken: async () => "test-token",
          // the real upload needs a network: while the browser is offline it fails and the photo waits in the queue
          uploader: async (item) => {
            if (!navigator.onLine) throw new Error("offline");
            await new Promise((r) => setTimeout(r, 250));
            return { url: `https://fixture.public.blob.vercel-storage.com/${item.id}.jpg`, pathname: `pit/${item.id}.jpg`, size: item.blob.size, contentType: "image/jpeg" };
          },
        }}
      >
        <FormPageView
          form={form}
          title={TITLES[which]}
          subtitle="Fixture"
          events={events}
          eventsLoaded
          defaultEventCode="EVT1"
          scoutName="Ada Lovelace"
          matches={[]}
          teams={TEAMS.map((t) => ({ teamNumber: t.teamNumber, name: t.name }))}
          planEntries={[]}
          renderMatchPicker={() => null}
          myUid="me"
          existingEntries={seeded}
          assignedTeams={assigned}
          hideEventPickerIfSingle={which === "helper"}
          photoKind={which === "pit" ? "pit" : "form"}
          suggestFor={which === "pit" ? (n) => rookieSuggestion(TEAMS.find((t) => t.teamNumber === n), 2025) : undefined}
          onSave={async (doc) => {
            (window.__saved ??= []).push(doc);
            return `entry-${window.__saved.length}`;
          }}
          onUpdate={async (entry, patch) => {
            (window.__updated ??= []).push({ id: entry.id, ...patch });
          }}
        />
      </PhotoUploadProvider>
    </div>
  );
}

export function TeamFormsFixture() {
  return (
    <Suspense fallback={null}>
      <Fixture />
    </Suspense>
  );
}
