"use client";

import { FieldTeamsEditor } from "@/components/team/field-teams-editor";

export default function TeamSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team Settings</h1>
        <p className="text-sm text-[var(--muted-foreground)]">The account name and the FTC teams on this account.</p>
      </div>
      <FieldTeamsEditor />
    </div>
  );
}
