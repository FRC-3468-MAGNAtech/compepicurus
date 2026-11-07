"use client";

import { AlertTriangle, ArrowUp, Award, Battery, Bug, Cog, Crosshair, Flag, Flower2, Gauge, Hand, Heart, Home, MapPin, ParkingCircle, Rocket, Shield, Star, Target, Timer, Trophy, Wrench, Zap, type LucideIcon } from "lucide-react";
import type { FieldUi } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P22: the icons a form author can put in front of a field (`ui.icon`, a kebab-case name). A fixed, curated list (never an arbitrary string
// turned into an import) keeps the stored value validated by the schema's `^[a-z0-9-]{1,40}$` and the bundle small.

export const FIELD_ICONS: Record<string, LucideIcon> = {
  "alert-triangle": AlertTriangle,
  "arrow-up": ArrowUp,
  award: Award,
  battery: Battery,
  bug: Bug,
  cog: Cog,
  crosshair: Crosshair,
  flag: Flag,
  flower: Flower2,
  gauge: Gauge,
  hand: Hand,
  heart: Heart,
  home: Home,
  "map-pin": MapPin,
  parking: ParkingCircle,
  rocket: Rocket,
  shield: Shield,
  star: Star,
  target: Target,
  timer: Timer,
  trophy: Trophy,
  wrench: Wrench,
  zap: Zap,
};

export const FIELD_ICON_NAMES = Object.keys(FIELD_ICONS);

export function FieldIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = name ? FIELD_ICONS[name] : undefined;
  if (!Icon) return null;
  return <Icon className={cn("h-4 w-4 shrink-0", className)} aria-hidden />;
}

/**
 * The accent colours a field or category can take: theme tokens only, never a raw colour, so the text on them stays legible in every theme
 * (primary/secondary/accent follow the theme; success/warning/danger are the app's fixed semantic hues, already used on glass everywhere).
 */
export const ACCENT_TOKENS: Record<NonNullable<FieldUi["color"]>, string> = {
  default: "var(--glass-border)",
  primary: "var(--color-primary)",
  secondary: "var(--color-secondary)",
  accent: "var(--color-accent)",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#f87171",
};
