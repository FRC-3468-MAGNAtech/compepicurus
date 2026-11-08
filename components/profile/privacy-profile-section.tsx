"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Check, Globe, Lock, Save } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Shimmer } from "@/components/ui/shimmer";
import { useAuth } from "@/lib/auth";
import { AVATAR_PRESETS, BIO_MAX, DEFAULT_AVATAR, DISPLAY_NAME_MAX, PRONOUNS_MAX, type AvatarChoice, type ProfileVisibility } from "@/lib/profile/config";
import { isGoogleAvatarUrl, sanitizeBio, sanitizeDisplayName, sanitizePronouns, visibilityToSave, type ProfileDoc } from "@/lib/profile/model";
import { saveOwnProfile, useProfile, type ProfileEdit } from "@/lib/profile/service";
import { DEFAULT_PROFILE_VISIBILITY } from "@/lib/profile/config";
import { cn } from "@/lib/utils";

const sameAvatar = (a: AvatarChoice, b: AvatarChoice) => a.type === b.type && a.value === b.value;

/** Account Settings > Privacy and profile (P25): picture, display name, pronouns, bio and who can see the profile page. */
export function PrivacyProfileSection() {
  const { user, profile: me } = useAuth();
  const state = useProfile(user?.uid ?? null, me?.teamId ?? null);
  // Held here, not in the form: a save changes the stored profile, which restarts the form (see the key below).
  const [justSaved, setJustSaved] = useState(false);

  if (!user || !me) return null;
  if (state.status === "loading") return <Shimmer className="h-96" />;
  if (state.status === "denied" || state.status === "error") {
    return (
      <GlassPanel className="text-sm text-[var(--muted-foreground)]">Couldn&apos;t load your profile settings. Check your connection and reload the page.</GlassPanel>
    );
  }
  // Re-keyed on the saved copy so the form restarts from what is stored (after a save, or a change on another device).
  const saved = state.profile;
  return (
    <ProfileEditorForm
      key={JSON.stringify([saved?.displayName ?? "", saved?.bio ?? "", saved?.pronouns ?? "", saved?.avatar ?? me.avatar ?? DEFAULT_AVATAR])}
      saved={saved}
      isAdmin={me.isAdmin}
      accountName={me.name}
      accountAvatar={me.avatar ?? null}
      googleUrl={user.photoURL && isGoogleAvatarUrl(user.photoURL) ? user.photoURL : null}
      justSaved={justSaved}
      onSave={async (edit) => {
        await saveOwnProfile({ uid: user.uid, teamId: me.teamId }, edit);
        setJustSaved(true);
      }}
      // FIX4: the visibility choice saves by itself, with the profile's stored text (never what is half-typed in the form).
      onSetVisibility={(visibility) =>
        saveOwnProfile(
          { uid: user.uid, teamId: me.teamId },
          {
            displayName: saved?.displayName ?? "",
            bio: saved?.bio ?? "",
            pronouns: saved?.pronouns ?? "",
            avatar: saved?.avatar ?? me.avatar ?? DEFAULT_AVATAR,
            visibility,
          }
        )
      }
    />
  );
}

/**
 * The form itself, as plain props (the Settings section wires it to Firestore; the browser-test fixture to memory).
 * `saved` is what is stored (null before a first save); the form restarts from it, so the parent re-keys it on a change.
 */
export function ProfileEditorForm({
  saved,
  isAdmin,
  accountName,
  accountAvatar,
  googleUrl,
  justSaved,
  onSave,
  onSetVisibility,
}: {
  saved: ProfileDoc | null;
  isAdmin: boolean;
  accountName: string;
  accountAvatar: AvatarChoice | null;
  /** The member's Google picture, when they signed in with Google. */
  googleUrl: string | null;
  /** The parent's "your last save went through" (it outlives the form's restart on a save). Hidden again as soon as something is edited. */
  justSaved: boolean;
  onSave: (edit: ProfileEdit) => Promise<void>;
  /** FIX4: called the moment a non-admin picks Public or Private (saved on its own, not with "Save profile"). Rejects when the write fails. */
  onSetVisibility: (visibility: ProfileVisibility) => Promise<void>;
}) {
  const ids = useId();

  const [displayName, setDisplayName] = useState(saved?.displayName ?? "");
  const [pronouns, setPronouns] = useState(saved?.pronouns ?? "");
  const [bio, setBio] = useState(saved?.bio ?? "");
  const [avatar, setAvatar] = useState<AvatarChoice>(saved?.avatar ?? accountAvatar ?? DEFAULT_AVATAR);
  const savedVisibility: ProfileVisibility = saved?.visibility ?? DEFAULT_PROFILE_VISIBILITY;
  const [visibility, setVisibility] = useState<ProfileVisibility>(savedVisibility);
  // Follow the stored value when it changes under us (another device, or the write landing), without restarting the form.
  const [seenSavedVisibility, setSeenSavedVisibility] = useState(savedVisibility);
  if (seenSavedVisibility !== savedVisibility) {
    setSeenSavedVisibility(savedVisibility);
    setVisibility(savedVisibility);
  }
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [visibilityStatus, setVisibilityStatus] = useState<"idle" | "saved" | "failed">("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A admin's toggle shows what applies (public) while their saved preference waits for a demotion.
  const shownVisibility: ProfileVisibility = isAdmin ? "public" : visibility;

  const dirty =
    sanitizeDisplayName(displayName) !== (saved?.displayName ?? "") ||
    sanitizePronouns(pronouns) !== (saved?.pronouns ?? "") ||
    sanitizeBio(bio) !== (saved?.bio ?? "") ||
    !sameAvatar(avatar, saved?.avatar ?? accountAvatar ?? DEFAULT_AVATAR);

  const chooseVisibility = async (next: ProfileVisibility) => {
    if (isAdmin || visibilityBusy || next === visibility) return;
    const previous = visibility;
    setVisibility(next);
    setVisibilityBusy(true);
    setVisibilityStatus("idle");
    try {
      await onSetVisibility(next);
      setVisibilityStatus("saved");
    } catch {
      setVisibility(previous);
      setVisibilityStatus("failed");
    } finally {
      setVisibilityBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        displayName: sanitizeDisplayName(displayName),
        pronouns: sanitizePronouns(pronouns),
        bio: sanitizeBio(bio),
        avatar,
        visibility: visibilityToSave({ isAdmin, chosen: visibility, existing: saved?.visibility ?? null }),
      });
    } catch {
      setError("Couldn't save your profile. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-8" data-testid="privacy-profile">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-[var(--muted-foreground)]">What your teammates see when they open your profile. It&apos;s only ever shown inside your team.</p>
        <Link href="/profile" className="text-sm underline underline-offset-2">
          See your profile
        </Link>
      </div>

      {/* Picture */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold">Picture</legend>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={sanitizeDisplayName(displayName) || accountName} size="xl" avatar={avatar} />
          <div role="radiogroup" aria-label="Picture" className="flex flex-wrap gap-2" data-testid="avatar-picker">
            <AvatarTile label="Initials" selected={avatar.type === "initials"} onSelect={() => setAvatar({ type: "initials", value: "" })}>
              <Avatar name={accountName} size="md" />
            </AvatarTile>
            {googleUrl && (
              <AvatarTile label="Google picture" selected={avatar.type === "google"} onSelect={() => setAvatar({ type: "google", value: googleUrl })}>
                <Avatar name={accountName} size="md" avatar={{ type: "google", value: googleUrl }} />
              </AvatarTile>
            )}
            {AVATAR_PRESETS.map((p) => (
              <AvatarTile key={p.id} label={p.label} selected={avatar.type === "preset" && avatar.value === p.id} onSelect={() => setAvatar({ type: "preset", value: p.id })}>
                <Avatar name={accountName} size="md" avatar={{ type: "preset", value: p.id }} />
              </AvatarTile>
            ))}
          </div>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">There are no uploads: pick your initials{googleUrl ? ", your Google picture" : ""} or one of the presets.</p>
      </fieldset>

      {/* Text */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${ids}-name`}>Display name</Label>
          <Input id={`${ids}-name`} value={displayName} maxLength={DISPLAY_NAME_MAX} placeholder={accountName} onChange={(e) => setDisplayName(e.target.value)} />
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">Shown on your profile only. Everywhere else you stay &ldquo;{accountName}&rdquo; (change that above).</p>
        </div>
        <div>
          <Label htmlFor={`${ids}-pronouns`}>Pronouns (optional)</Label>
          <Input id={`${ids}-pronouns`} value={pronouns} maxLength={PRONOUNS_MAX} placeholder="e.g. she/her, they/them" onChange={(e) => setPronouns(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`${ids}-bio`}>Bio</Label>
          <Textarea id={`${ids}-bio`} value={bio} maxLength={BIO_MAX} rows={4} placeholder="A line or two about you and your scouting." onChange={(e) => setBio(e.target.value)} />
          <p className="mt-1 flex justify-between text-xs text-[var(--muted-foreground)]">
            <span>Plain text only; links and formatting aren&apos;t shown.</span>
            <span data-testid="bio-count" className="tabular-nums">
              {bio.length} / {BIO_MAX}
            </span>
          </p>
        </div>
      </div>

      {/* Visibility */}
      <fieldset className="flex flex-col gap-3" data-testid="visibility-group" disabled={isAdmin} aria-busy={visibilityBusy}>
        <legend className="mb-1 text-sm font-semibold">Who can see your profile</legend>
        <div role="radiogroup" aria-label="Who can see your profile" className="grid gap-3 sm:grid-cols-2">
          <VisibilityOption
            icon={Globe}
            title="Public to my team"
            body="Teammates can open your profile: bio, pronouns, accuracy, practice, events and achievements."
            selected={shownVisibility === "public"}
            disabled={isAdmin || visibilityBusy}
            onSelect={() => void chooseVisibility("public")}
            testId="visibility-public"
          />
          <VisibilityOption
            icon={Lock}
            title="Private"
            body="Teammates who aren't admins see only your picture, name and role, and “This profile is private”."
            selected={shownVisibility === "private"}
            disabled={isAdmin || visibilityBusy}
            onSelect={() => void chooseVisibility("private")}
            testId="visibility-private"
          />
        </div>
        {isAdmin && (
          <p data-testid="admin-visibility-note" className="glass-card px-4 py-3 text-sm text-[var(--muted-foreground)]">
            Admins and the owner are always visible to their team, so this can&apos;t be turned off while you&apos;re an admin.
            {saved?.visibility === "private" ? " Your saved choice, Private, applies again if your role changes." : " If your role changes later, your choice here will apply."}
          </p>
        )}
        {!isAdmin && (
          <p className="text-xs text-[var(--muted-foreground)]">This saves as soon as you pick it. You can always see your own profile, whichever you choose.</p>
        )}
        {visibilityStatus === "saved" && (
          <span role="status" data-testid="visibility-saved" className="flex items-center gap-1.5 text-sm text-emerald-400">
            <Check className="h-4 w-4" /> {visibility === "private" ? "Your profile is now private." : "Your profile is now public to your team."}
          </span>
        )}
        {visibilityStatus === "failed" && (
          <span role="alert" data-testid="visibility-error" className="text-sm text-red-400">
            Couldn&apos;t change who can see your profile. Check your connection and try again. If it keeps happening, ask an admin to check that the latest security rules are deployed.
          </span>
        )}
        <div className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]" data-testid="privacy-limits">
          <p className="font-medium text-[var(--foreground)]">What private does and doesn&apos;t do</p>
          <p>
            Private hides your profile page and the text on it (display name, bio, pronouns) from teammates who aren&apos;t admins. It doesn&apos;t hide the scouting your team already shares: your
            entries, practice sessions, accuracy and rank still appear in Analytics, Scout Accuracy, Scout Status and the leaderboards, and the People page still lists you. Admins can always see
            your profile and can clear a bio or pronouns that break your team&apos;s rules (they can&apos;t write for you).
          </p>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!dirty || saving} className="gap-2" data-testid="save-profile">
          <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save profile"}
        </Button>
        {justSaved && !dirty && (
          <span role="status" data-testid="profile-saved" className="flex items-center gap-1.5 text-sm text-emerald-400">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
        {error && (
          <span role="alert" data-testid="profile-save-error" className="text-sm text-red-400">
            {error}
          </span>
        )}
      </div>
    </GlassPanel>
  );
}

function AvatarTile({ label, selected, onSelect, children }: { label: string; selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn("rounded-full p-1 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.6)]", selected ? "ring-2 ring-[var(--color-primary)]" : "ring-1 ring-transparent hover:ring-[var(--glass-border)]")}
    >
      {children}
    </button>
  );
}

function VisibilityOption({
  icon: Icon,
  title,
  body,
  selected,
  disabled,
  onSelect,
  testId,
}: {
  icon: typeof Globe;
  title: string;
  body: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        "glass-card flex flex-col gap-1.5 p-4 text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.6)] disabled:cursor-not-allowed",
        selected ? "ring-2 ring-[var(--color-primary)]" : "ring-1 ring-transparent",
        disabled && !selected && "opacity-50"
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4" aria-hidden /> {title}
      </span>
      <span className="text-xs text-[var(--muted-foreground)]">{body}</span>
    </button>
  );
}
