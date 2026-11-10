"use client";

import { useId, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Monitor, Moon, Search, Sun, type LucideIcon } from "lucide-react";
import { useAppTheme } from "@/components/theme/theme-provider";
import { Input } from "@/components/ui/input";
import { pageBackground, themeGroups, tokensFor, type ColorMode, type ColorModePreference, type ThemeDefinition } from "@/lib/themes";
import { GRADIENT_INTENSITIES, type GradientIntensity } from "@/lib/theme-gradient";
import { rgbTriple, parseHex } from "@/lib/theme-color";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const MODES: { id: ColorModePreference; label: string; icon: LucideIcon }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

const MODE_LABEL: Record<ColorModePreference, string> = { light: "Light", dark: "Dark", system: "System" };

const INTENSITY_LABEL: Record<GradientIntensity, string> = { subtle: "Subtle", normal: "Normal", vivid: "Vivid" };

/** Settings > Appearance (P18): Light / Dark / System on top, then every theme, grouped, searchable, with a live preview of each. */
export function AppearancePanel() {
  const { themeId, setThemeId, colorMode, setColorMode, resolvedMode, modeLocked, gradientIntensity, setGradientIntensity } = useAppTheme();
  const [query, setQuery] = useState("");
  const lockedNoteId = useId();
  const searchId = useId();

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return themeGroups
      .map((g) => ({
        ...g,
        themes: q ? g.themes.filter((t) => `${t.name} ${t.tagline} ${g.label} ${g.kind}`.toLowerCase().includes(q)) : g.themes,
      }))
      .filter((g) => g.themes.length > 0);
  }, [query]);

  return (
    <div className="flex flex-col gap-6" data-testid="appearance-panel">
      <section aria-labelledby={`${searchId}-mode`} className="flex flex-col gap-2">
        <h3 id={`${searchId}-mode`} className="text-sm font-semibold">
          Mode
        </h3>
        <div role="group" aria-labelledby={`${searchId}-mode`} aria-describedby={modeLocked ? lockedNoteId : undefined} className="glass-pill grid w-full max-w-md grid-cols-3 gap-1 p-1">
          {MODES.map(({ id, label, icon: Icon }) => {
            const active = colorMode === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`mode-option-${id}`}
                aria-pressed={active}
                disabled={modeLocked}
                onClick={() => setColorMode(id)}
                className={cn(
                  "relative flex h-10 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed",
                  active ? "text-[var(--color-primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                  modeLocked && "opacity-55"
                )}
              >
                {active && (
                  <motion.span layoutId="mode-pill" transition={spring} className="absolute inset-0 -z-10 rounded-full" style={{ background: "var(--theme-gradient)", boxShadow: "0 4px 18px -4px rgba(var(--glow), 0.6)" }} />
                )}
                <Icon className="h-4 w-4" /> {label}
              </button>
            );
          })}
        </div>
        <p id={lockedNoteId} className="text-xs text-[var(--muted-foreground)]">
          {modeLocked
            ? `Pride themes are one fixed look, so Light and Dark don't apply to them. Your choice (${MODE_LABEL[colorMode]}) is kept and comes back when you pick another theme.`
            : colorMode === "system"
              ? `Following your device: ${resolvedMode} right now.`
              : "Applies to every solid and gradient theme. Pride themes are fixed."}
        </p>
      </section>

      <section aria-labelledby={`${searchId}-intensity`} className="flex flex-col gap-2">
        <h3 id={`${searchId}-intensity`} className="text-sm font-semibold">
          Gradient intensity
        </h3>
        <div role="group" aria-labelledby={`${searchId}-intensity`} className="glass-pill grid w-full max-w-md grid-cols-3 gap-1 p-1">
          {GRADIENT_INTENSITIES.map((id) => {
            const active = gradientIntensity === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`intensity-option-${id}`}
                aria-pressed={active}
                onClick={() => setGradientIntensity(id)}
                className={cn(
                  "relative flex h-10 items-center justify-center rounded-full px-3 text-sm font-medium transition-colors",
                  active ? "text-[var(--color-primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                )}
              >
                {active && (
                  <motion.span layoutId="intensity-pill" transition={spring} className="absolute inset-0 -z-10 rounded-full" style={{ background: "var(--theme-gradient)", boxShadow: "0 4px 18px -4px rgba(var(--glow), 0.6)" }} />
                )}
                {INTENSITY_LABEL[id]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">How strongly the background gradient shows behind your panels. Applies to gradient and pride themes; solid themes have no gradient.</p>
      </section>

      <section className="flex flex-col gap-4" aria-label="Themes">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
          <Input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search themes" aria-label="Search themes" className="pl-10" />
        </div>

        {groups.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No theme matches &ldquo;{query}&rdquo;.</p>}

        {groups.map((group) => (
          <div key={group.kind} className="flex flex-col gap-3" data-testid={`theme-group-${group.kind}`}>
            <h3 className="text-sm font-semibold">
              {group.label} <span className="font-normal text-[var(--muted-foreground)]">· {group.themes.length}</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {group.themes.map((t) => (
                <ThemeCard key={t.id} theme={t} mode={resolvedMode} active={t.id === themeId} onSelect={() => setThemeId(t.id)} />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/** A mini glass card painted with the theme's own tokens (in the mode that is showing), so each card is a live preview. */
function ThemeCard({ theme, mode, active, onSelect }: { theme: ThemeDefinition; mode: ColorMode; active: boolean; onSelect: () => void }) {
  const t = tokensFor(theme, mode);
  const glow = (hex: string) => rgbTriple(parseHex(hex));
  const page =
    t.pageStops.length === 1
      ? `radial-gradient(circle at 15% 15%, ${t.blobs[0]}, transparent 62%), radial-gradient(circle at 90% 85%, ${t.blobs[2]}, transparent 60%), ${t.background}`
      : pageBackground(t);
  const gradient = `linear-gradient(135deg, ${t.gradient.join(",")})`;

  return (
    <motion.button
      type="button"
      data-testid="theme-card"
      data-theme-id={theme.id}
      data-kind={theme.kind}
      aria-pressed={active}
      aria-label={`${theme.name}${active ? " (selected)" : ""}`}
      onClick={onSelect}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className="relative flex flex-col gap-2 rounded-2xl border border-[var(--glass-border)] bg-[var(--surface-solid)] p-2 text-left"
      style={active ? { boxShadow: `0 0 0 2px var(--focus-ring), 0 0 26px 2px rgba(${t.glow}, 0.45)` } : undefined}
    >
      {/* The preview: page background, a glass card on it, a gradient button, and a few lines of text, all in the theme's colors. */}
      <span className="relative flex h-24 flex-col justify-end overflow-hidden rounded-xl p-2" style={{ background: page, colorScheme: t.colorScheme }}>
        <span
          className="flex flex-col gap-1.5 rounded-lg border p-2"
          style={{ background: t.glassBgStrong, borderColor: t.glassBorder, boxShadow: `0 6px 18px -8px rgba(${glow(t.primary)}, 0.5)` }}
        >
          <span className="h-1.5 w-3/5 rounded-full" style={{ background: t.foreground, opacity: 0.85 }} />
          <span className="h-1.5 w-2/5 rounded-full" style={{ background: t.mutedForeground, opacity: 0.7 }} />
          <span className="mt-0.5 flex h-5 w-16 items-center justify-center rounded-full text-[10px] font-semibold" style={{ background: gradient, color: t.primaryForeground }}>
            Aa
          </span>
        </span>
        {active && (
          <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full" style={{ background: gradient, color: t.primaryForeground }}>
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="px-0.5 pb-0.5">
        <span className="block truncate text-sm font-semibold">{theme.name}</span>
        <span className="block truncate text-[11px] text-[var(--muted-foreground)]">{theme.tagline}</span>
      </span>
    </motion.button>
  );
}
