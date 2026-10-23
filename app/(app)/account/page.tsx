"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { KeyRound, Save } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Avatar } from "@/components/ui/avatar";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { themes } from "@/lib/themes";
import { useAppTheme } from "@/components/theme/theme-provider";
import { useAuth } from "@/lib/auth";
import { getRole } from "@/lib/roles";
import { spring } from "@/lib/motion";

export default function AccountSettingsPage() {
  const { user, profile, updateUserProfile, changePassword } = useAuth();
  const { themeId, setThemeId } = useAppTheme();
  const [displayName, setDisplayName] = useState(profile?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // `profile` loads asynchronously after mount (it's null until the user doc
  // snapshot resolves), so the lazy initializer above misses it — this syncs
  // displayName once that first arrives. Guarded to run only once: profile
  // can also change later for unrelated reasons (another admin edits this
  // user's role), and re-syncing then would silently overwrite whatever the
  // user is mid-typing in this field.
  const didInitDisplayName = useRef(false);
  useEffect(() => {
    if (profile && !didInitDisplayName.current) {
      didInitDisplayName.current = true;
      setDisplayName(profile.name);
    }
  }, [profile]);

  const handleSaveName = async () => {
    setSavingName(true);
    setNameSaved(false);
    try {
      await updateUserProfile({ name: displayName });
      setNameSaved(true);
    } finally {
      setSavingName(false);
    }
  };

  const handleSelectTheme = (id: string) => {
    setThemeId(id);
    void updateUserProfile({ themeId: id });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    setSavingPassword(true);
    try {
      await changePassword(newPassword);
      setPasswordSaved(true);
      setNewPassword("");
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setPasswordError(
        code === "auth/requires-recent-login"
          ? "For security, log out and back in before changing your password."
          : err instanceof Error
            ? err.message
            : "Couldn't change your password."
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const primaryRole = profile ? getRole(profile.primaryRole) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account Settings</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Manage your profile, theme, and password.</p>
      </div>

      <GlassPanel className="flex items-center gap-4">
        <Avatar name={displayName || profile?.name || ""} size="lg" />
        <div>
          <div className="font-semibold">{displayName || profile?.name}</div>
          {primaryRole && <Badge className={`mt-1 ${primaryRole.className}`}>{primaryRole.label}</Badge>}
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Profile</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setNameSaved(false);
              }}
            />
          </div>
          <div>
            <Label htmlFor="account-email">Email</Label>
            <Input id="account-email" type="email" value={user?.email ?? ""} disabled />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button className="gap-2 self-start" type="button" onClick={handleSaveName} disabled={savingName}>
            <Save className="h-4 w-4" /> {savingName ? "Saving…" : "Save changes"}
          </Button>
          {nameSaved && <span className="text-sm text-emerald-400">Saved.</span>}
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Theme</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {themes.map((t) => {
            const active = t.id === themeId;
            return (
              <motion.button
                key={t.id}
                type="button"
                onClick={() => handleSelectTheme(t.id)}
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.98 }}
                transition={spring}
                className="glass-card relative flex flex-col gap-3 p-4 text-left"
                style={active ? { boxShadow: `0 0 0 2px ${t.primary}, var(--glass-shadow)` } : undefined}
              >
                <div
                  className="h-16 w-full rounded-xl"
                  style={{
                    background: `linear-gradient(135deg, ${t.backgroundGradient[0]}, ${t.backgroundGradient[2]})`,
                  }}
                />
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{t.name}</div>
                    <div className="text-xs text-[var(--muted-foreground)]">{t.tagline}</div>
                  </div>
                  <div className="flex -space-x-1.5">
                    <span className="h-5 w-5 rounded-full border-2 border-[var(--background)]" style={{ background: t.primary }} />
                    <span className="h-5 w-5 rounded-full border-2 border-[var(--background)]" style={{ background: t.secondary }} />
                    <span className="h-5 w-5 rounded-full border-2 border-[var(--background)]" style={{ background: t.accent }} />
                  </div>
                </div>
                {active && <Badge variant="accent" className="w-fit">Active</Badge>}
              </motion.button>
            );
          })}
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Password</h2>
        <form onSubmit={handleChangePassword} className="flex flex-col gap-4 sm:max-w-sm">
          <div>
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
              required
            />
          </div>
          {passwordError && <p className="text-sm text-red-400">{passwordError}</p>}
          {passwordSaved && <p className="text-sm text-emerald-400">Password changed.</p>}
          <Button className="gap-2 self-start" type="submit" disabled={savingPassword}>
            <KeyRound className="h-4 w-4" /> {savingPassword ? "Changing…" : "Change password"}
          </Button>
        </form>
      </GlassPanel>
    </div>
  );
}
