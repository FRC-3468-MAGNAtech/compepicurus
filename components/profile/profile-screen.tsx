"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LimitedProfileCard } from "@/components/profile/profile-sections";
import { canModerateProfile, profileAccess, type ProfileAccess, type ProfileDoc } from "@/lib/profile/model";
import type { TeamMember } from "@/lib/team-members";

export function BackLink() {
  return (
    <Link href="/people" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
      <ArrowLeft className="h-4 w-4" /> People
    </Link>
  );
}

/**
 * The profile page's chrome and its one privacy decision, as plain props: who is looking, at whom, and whether the
 * rules already refused (`denied`). It shows the limited "This profile is private" card or hands the viewer-may-see
 * case to `renderFull` (the connected page loads the team's scouting data there; the browser-test fixture passes
 * fixed data). Yourself, you also get Edit and "View as others see it" (a teammate who isn't an admin).
 */
export function ProfileScreen({
  member,
  profile,
  denied,
  viewer,
  renderFull,
}: {
  member: TeamMember;
  /** null before the member has ever saved one. */
  profile: ProfileDoc | null;
  /** The rules refused the read (a private profile seen by a non-admin teammate). */
  denied: boolean;
  viewer: { uid: string; isAdmin: boolean };
  renderFull: (ctx: { canModerate: boolean; isSelf: boolean }) => React.ReactNode;
}) {
  const [preview, setPreview] = useState(false);
  const isSelf = viewer.uid === member.uid;
  // "Preview" is you looking as a teammate who isn't an admin would; it's only ever about yourself.
  const previewing = isSelf && preview;
  const viewerIsAdmin = viewer.isAdmin && !previewing;
  // FIX4: your own profile is never the limited card, whatever the read said (a refused read of your own doc is a
  // setup problem, not privacy): you see it in full, with the defaults, and a note.
  const ownReadFailed = isSelf && denied && !previewing;
  const access: ProfileAccess = ownReadFailed
    ? "full"
    : denied
    ? "limited"
    : profileAccess({ viewerUid: previewing ? "preview" : viewer.uid, viewerIsAdmin, targetUid: member.uid, targetIsAdmin: member.isAdmin, visibility: profile?.visibility });
  const canModerate = !previewing && canModerateProfile({ viewerUid: viewer.uid, viewerIsAdmin: viewer.isAdmin, targetUid: member.uid, targetIsOwner: member.isOwner });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isSelf ? <span className="text-sm text-[var(--muted-foreground)]">Your profile</span> : <BackLink />}
        {isSelf && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch checked={preview} onCheckedChange={setPreview} aria-label="View as others see it" data-testid="view-as-others" />
              <span className="flex items-center gap-1.5">
                <Eye className="h-4 w-4" aria-hidden /> View as others see it
              </span>
            </label>
            <Link href="/account#privacy-profile">
              <Button variant="glass" size="sm" className="gap-1.5" data-testid="edit-profile">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </Link>
          </div>
        )}
      </div>

      {previewing && (
        <p data-testid="preview-banner" className="glass-card px-4 py-3 text-sm text-[var(--muted-foreground)]">
          This is what a teammate who isn&apos;t an admin sees.{" "}
          {access === "limited" ? "Your profile is private, so they only see your picture, name and role." : viewer.isAdmin ? "Admins are always visible to teammates, whatever the privacy setting says." : "Your profile is public to your team."}
        </p>
      )}

      {ownReadFailed && (
        <p data-testid="own-profile-unreadable" role="status" className="glass-card px-4 py-3 text-sm text-[var(--muted-foreground)]">
          We couldn&apos;t read your saved profile settings, so you&apos;re seeing the defaults. Reload the page; if it keeps happening, ask an admin to check that the latest security rules are deployed.
        </p>
      )}

      {access === "limited" ? <LimitedProfileCard member={member} /> : renderFull({ canModerate, isSelf })}
    </div>
  );
}
