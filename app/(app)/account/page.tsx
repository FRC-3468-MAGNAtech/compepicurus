"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Save } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Avatar } from "@/components/ui/avatar";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { themes } from "@/lib/themes";
import { useAppTheme } from "@/components/theme/theme-provider";
import { useMockAuth } from "@/lib/mock-auth";
import { spring } from "@/lib/motion";

export default function AccountSettingsPage() {
  const { name, role } = useMockAuth();
  const { themeId, setThemeId } = useAppTheme();
  const [displayName, setDisplayName] = useState(name);
  const [email, setEmail] = useState("scout@compepicurus.org");
  const [notifications, setNotifications] = useState(true);
  const [compactMode, setCompactMode] = useState(false);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account Settings</h1>
        <p className="text-sm text-[var(--muted-foreground)]">Manage your profile, theme, and preferences.</p>
      </div>

      <GlassPanel className="flex items-center gap-4">
        <Avatar name={displayName || name} size="lg" />
        <div>
          <div className="font-semibold">{displayName || name}</div>
          <Badge variant="glass" className="mt-1 capitalize">{role}</Badge>
        </div>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Profile</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="display-name">Display name</Label>
            <Input id="display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="account-email">Email</Label>
            <Input id="account-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <Button className="mt-1 gap-2 self-start" type="button">
          <Save className="h-4 w-4" /> Save changes
        </Button>
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
                onClick={() => setThemeId(t.id)}
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Preferences</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Push notifications</div>
            <div className="text-xs text-[var(--muted-foreground)]">Get notified when it&apos;s your turn to scout.</div>
          </div>
          <Switch checked={notifications} onCheckedChange={setNotifications} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Compact layout</div>
            <div className="text-xs text-[var(--muted-foreground)]">Reduce padding on data-dense pages.</div>
          </div>
          <Switch checked={compactMode} onCheckedChange={setCompactMode} />
        </div>
      </GlassPanel>
    </div>
  );
}
