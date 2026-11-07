// P25: member profiles — the one place their tunable constants live.

export type ProfileVisibility = "public" | "private";

/**
 * What a member's profile is until they choose: visible to teammates ("public" is public WITHIN the account,
 * never to the internet). Change this one constant to flip the default for everyone who hasn't saved a profile.
 * (Admins and the owner are always visible whatever this says — see effectiveVisibility().)
 */
export const DEFAULT_PROFILE_VISIBILITY: ProfileVisibility = "public";

export const BIO_MAX = 280;
export const PRONOUNS_MAX = 30;
export const DISPLAY_NAME_MAX = 40;

/** How many recent practice sessions the profile lists. */
export const RECENT_SESSIONS_SHOWN = 5;

/** Event Veteran: events attended. */
export const EVENT_VETERAN_EVENTS = 3;

/** The streak that earns the streak badge, in days. */
export const STREAK_BADGE_DAYS = 5;

export type AvatarType = "google" | "initials" | "preset";
export type AvatarChoice = { type: AvatarType; value: string };

export const DEFAULT_AVATAR: AvatarChoice = { type: "initials", value: "" };

/**
 * The preset avatars: a gradient and a glyph, drawn in the browser (no uploads, no files). `icon` names a glyph the
 * Avatar component knows (components/profile/profile-avatar.tsx); the ids are what is stored, so keep them stable.
 */
export const AVATAR_PRESETS: { id: string; label: string; from: string; to: string; icon: string }[] = [
  { id: "bot", label: "Robot", from: "#06b6d4", to: "#3b82f6", icon: "bot" },
  { id: "gear", label: "Gear", from: "#f59e0b", to: "#ef4444", icon: "cog" },
  { id: "bolt", label: "Bolt", from: "#eab308", to: "#f97316", icon: "zap" },
  { id: "rocket", label: "Rocket", from: "#8b5cf6", to: "#ec4899", icon: "rocket" },
  { id: "target", label: "Target", from: "#ef4444", to: "#be123c", icon: "target" },
  { id: "eye", label: "Eye", from: "#10b981", to: "#0ea5e9", icon: "eye" },
  { id: "trophy", label: "Trophy", from: "#facc15", to: "#d97706", icon: "trophy" },
  { id: "star", label: "Star", from: "#a78bfa", to: "#6366f1", icon: "star" },
  { id: "flame", label: "Flame", from: "#fb923c", to: "#dc2626", icon: "flame" },
  { id: "leaf", label: "Leaf", from: "#84cc16", to: "#059669", icon: "leaf" },
  { id: "wave", label: "Wave", from: "#38bdf8", to: "#4f46e5", icon: "waves" },
  { id: "moon", label: "Moon", from: "#64748b", to: "#1e293b", icon: "moon" },
];

export const presetById = (id: string) => AVATAR_PRESETS.find((p) => p.id === id) ?? null;
