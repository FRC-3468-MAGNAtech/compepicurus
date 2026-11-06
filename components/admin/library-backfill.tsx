"use client";

import { useAuth } from "@/lib/auth";
import { useLibraryBackfill } from "@/lib/library/store";
import { useTeamDoc } from "@/lib/team";

/**
 * Renders nothing. For admins only: the first time one has the app open after
 * P15, stamps the pre-P15 match library (`origin: 'api'`, `published: true`) so
 * those matches keep showing up for scouts — members now only read matches with
 * `published == true`. Runs once per team (flagged on the team doc); safe to repeat.
 */
export function LibraryBackfill() {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { team, loaded } = useTeamDoc(teamId);
  useLibraryBackfill(teamId, user?.uid ?? null, team, loaded);
  return null;
}
