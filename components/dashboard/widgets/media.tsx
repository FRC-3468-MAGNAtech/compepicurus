"use client";

import { useState } from "react";
import { Camera, Check, Copy, Sparkles } from "lucide-react";
import { Widget } from "@/components/dashboard/widget";
import { AllianceChip, ResultBadge, TeamLink } from "@/components/dashboard/shared";
import { scheduleErrorText } from "@/components/dashboard/widgets/schedule-widgets";
import { Button } from "@/components/ui/button";
import { useOurTeamEvent } from "@/lib/dashboard/data";
import { eventHighlights } from "@/lib/dashboard/insights";
import { matchShareText, recentOurResults, upcomingOurMatches } from "@/lib/dashboard/schedule";
import { cn } from "@/lib/utils";

/** The names and numbers of the teams we're about to face — what a caption needs. */
export function OpponentNamesWidget() {
  const t = useOurTeamEvent();
  const upcoming = upcomingOurMatches(t.ourMatches, 3);
  const code = t.event?.code ?? null;

  return (
    <Widget
      title="Upcoming opponents"
      icon={Camera}
      size="medium"
      status={t.first.loading ? "loading" : upcoming.length === 0 && t.first.error ? "error" : upcoming.length === 0 ? "empty" : "ready"}
      href="/analytics/match-breakdown"
      linkLabel="Match Breakdown"
      errorText={scheduleErrorText}
      emptyText="No upcoming matches to prepare captions for."
    >
      <div className="flex flex-col gap-2">
        {upcoming.map((m) => (
          <div key={m.match.eventCode + m.label} className="rounded-xl border border-[var(--glass-border)] px-3 py-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-xs font-semibold">{m.label}</span>
              <AllianceChip color={m.alliance} className="py-0.5 text-[10px]" />
            </div>
            {m.opponents.length === 0 ? (
              <span className="text-xs text-[var(--muted-foreground)]">Opponents not published yet</span>
            ) : (
              <div className="flex flex-col gap-0.5 text-sm">
                {m.opponents.map((o) => (
                  <div key={o} className="flex items-baseline gap-2">
                    <TeamLink teamNumber={o} eventCode={code} className="text-sm" />
                    <span className="truncate text-xs text-[var(--muted-foreground)]">{t.teamNames.get(o) ?? "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Widget>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (insecure context, permissions): fall back to a hidden textarea.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/** Recent results as ready-to-paste text (`Q12: Red 85 - Blue 70 (W)`), one Copy button each. */
export function ShareResultsWidget() {
  const t = useOurTeamEvent();
  const results = recentOurResults(t.ourMatches, 5);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    if (await copyText(text)) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    }
  };

  return (
    <Widget
      title="Results to share"
      icon={Copy}
      size="wide"
      status={t.first.loading ? "loading" : results.length === 0 && t.first.error ? "error" : results.length === 0 ? "empty" : "ready"}
      href="/analytics/match-breakdown"
      linkLabel="Match Breakdown"
      errorText={scheduleErrorText}
      emptyText="We haven't played a match at this event yet."
    >
      <div className="flex flex-col gap-2">
        {results.map((m) => {
          const key = m.match.eventCode + m.label;
          const text = matchShareText(m.match, t.ourNumber);
          if (!text) return null;
          const done = copied === key;
          return (
            <div key={key} className="flex items-center gap-3 rounded-xl border border-[var(--glass-border)] px-3 py-2">
              {m.result && <ResultBadge result={m.result} />}
              <code className="min-w-0 flex-1 truncate font-mono text-sm">{text}</code>
              <Button size="sm" variant={done ? "primary" : "glass"} className={cn("h-10 min-w-24 gap-1.5", done && "pointer-events-none")} onClick={() => void copy(key, text)} aria-label={`Copy ${text}`}>
                {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {done ? "Copied" : "Copy"}
              </Button>
            </div>
          );
        })}
      </div>
    </Widget>
  );
}

/** The event's highest official alliance score and our own best match. */
export function EventHighlightsWidget() {
  const t = useOurTeamEvent();
  const h = eventHighlights(t.officialMatches, t.ourNumber);
  const code = t.event?.code ?? null;

  return (
    <Widget
      title="Event highlights"
      icon={Sparkles}
      size="medium"
      status={t.first.loading ? "loading" : !h.highest && t.first.error ? "error" : !h.highest ? "empty" : "ready"}
      href="/analytics/match-breakdown"
      linkLabel="Match Breakdown"
      errorText={scheduleErrorText}
      emptyText="Highlights appear once matches have been played."
    >
      {h.highest && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Highest official score</div>
          <div className="text-3xl font-semibold tabular-nums tracking-tight">{h.highest.score}</div>
          <div className="text-xs text-[var(--muted-foreground)]">
            {h.highest.label} · {h.highest.color} alliance ·{" "}
            {h.highest.teams.map((tm, i) => (
              <span key={tm}>
                {i > 0 && ", "}
                <TeamLink teamNumber={tm} eventCode={code} className="text-xs" />
              </span>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">Our best match</div>
        {h.ourBest ? (
          <div className="text-sm">
            <strong className="text-xl tabular-nums">{h.ourBest.score}</strong> <span className="text-xs text-[var(--muted-foreground)]">in {h.ourBest.label} ({h.ourBest.color} alliance)</span>
          </div>
        ) : (
          <div className="text-sm text-[var(--muted-foreground)]">We haven&apos;t played yet</div>
        )}
      </div>
    </Widget>
  );
}
