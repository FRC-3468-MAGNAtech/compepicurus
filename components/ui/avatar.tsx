"use client";

import { useState } from "react";
import { Bot, Cog, Eye, Flame, Leaf, Moon, Rocket, Star, Target, Trophy, Waves, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isGoogleAvatarUrl, initialsOf } from "@/lib/profile/model";
import { presetById, type AvatarChoice } from "@/lib/profile/config";

const PRESET_ICONS: Record<string, LucideIcon> = { bot: Bot, cog: Cog, zap: Zap, rocket: Rocket, target: Target, eye: Eye, trophy: Trophy, star: Star, flame: Flame, leaf: Leaf, waves: Waves, moon: Moon };

const SIZE_CLASSES = {
  sm: { box: "h-8 w-8 text-xs", icon: "h-4 w-4" },
  md: { box: "h-10 w-10 text-sm", icon: "h-5 w-5" },
  lg: { box: "h-14 w-14 text-lg", icon: "h-7 w-7" },
  /** The profile header. */
  xl: { box: "h-24 w-24 text-3xl", icon: "h-12 w-12" },
} as const;

/**
 * A member's picture. With no `avatar` it is the initials-on-gradient disc it always was; with one it can be the
 * Google picture (https, googleusercontent only; falls back to initials if it won't load), or one of the preset
 * glyphs. Nothing is uploaded: everything here is drawn in the browser or fetched from Google.
 */
export function Avatar({
  name,
  color,
  className,
  size = "md",
  avatar,
}: {
  name: string;
  color?: string;
  className?: string;
  size?: keyof typeof SIZE_CLASSES;
  avatar?: AvatarChoice | null;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const sizes = SIZE_CLASSES[size];
  const base = cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white shadow-inner", sizes.box, className);

  if (avatar?.type === "google" && isGoogleAvatarUrl(avatar.value) && failedUrl !== avatar.value) {
    return (
      <div className={base} data-avatar="google" style={{ background: `linear-gradient(135deg, ${color ?? "var(--color-primary)"}, var(--color-accent))` }}>
        {/* A plain <img>: a Google-hosted picture, so Next's image optimizer has nothing to add. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatar.value} alt="" referrerPolicy="no-referrer" loading="lazy" draggable={false} className="h-full w-full object-cover" onError={() => setFailedUrl(avatar.value)} />
      </div>
    );
  }

  const preset = avatar?.type === "preset" ? presetById(avatar.value) : null;
  if (preset) {
    const Icon = PRESET_ICONS[preset.icon] ?? Bot;
    return (
      <div className={base} data-avatar={`preset:${preset.id}`} style={{ background: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}>
        <Icon className={sizes.icon} aria-hidden />
      </div>
    );
  }

  return (
    <div className={base} data-avatar="initials" style={{ background: `linear-gradient(135deg, ${color ?? "var(--color-primary)"}, var(--color-accent))` }}>
      {initialsOf(name)}
    </div>
  );
}
