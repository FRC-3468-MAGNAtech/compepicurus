import { EVENT_VETERAN_EVENTS, STREAK_BADGE_DAYS } from "@/lib/profile/config";

// P25: achievements. Computed in the browser from data that already exists (no collection, nothing stored), from
// this one list. To add or retune a badge, edit BADGES; the profile renders whatever it returns.

/** The facts badges are computed from — gathered once by computeProfileStats(). */
export type BadgeFacts = {
  /** Completed solo practice sessions (Trial + Competitive), exclusions NOT removed. */
  sessionCount: number;
  /** Highest accuracy (0-100) over non-excluded completed sessions, or null. */
  bestSessionAccuracy: number | null;
  /** Any category whose status is Excellent. */
  hasExcellentStatus: boolean;
  longestStreakDays: number;
  eventsAttended: number;
  /** A non-excluded Real Event entry whose alliance accuracy is 100%. */
  hasPerfectAlliance: boolean;
};

export type BadgeDef = {
  id: string;
  label: string;
  description: string;
  /** A glyph name the profile knows (components/profile/profile-badges.tsx). */
  icon: string;
  earned: (f: BadgeFacts) => boolean;
};

export const BADGES: BadgeDef[] = [
  { id: "first-session", label: "First Session", description: "Completed a first practice session.", icon: "flag", earned: (f) => f.sessionCount >= 1 },
  { id: "ten-sessions", label: "10 Sessions", description: "Completed 10 practice sessions.", icon: "layers", earned: (f) => f.sessionCount >= 10 },
  { id: "fifty-sessions", label: "50 Sessions", description: "Completed 50 practice sessions.", icon: "medal", earned: (f) => f.sessionCount >= 50 },
  { id: "perfect-session", label: "100% Session", description: "A practice session at 100% accuracy.", icon: "target", earned: (f) => f.bestSessionAccuracy !== null && Math.round(f.bestSessionAccuracy) >= 100 },
  { id: "excellent", label: "Excellent status", description: "Excellent accuracy status in a category.", icon: "sparkles", earned: (f) => f.hasExcellentStatus },
  { id: "streak", label: `${STREAK_BADGE_DAYS}-Day Streak`, description: `Practiced ${STREAK_BADGE_DAYS} days in a row.`, icon: "flame", earned: (f) => f.longestStreakDays >= STREAK_BADGE_DAYS },
  { id: "event-veteran", label: "Event Veteran", description: `Attended ${EVENT_VETERAN_EVENTS} or more events.`, icon: "calendar", earned: (f) => f.eventsAttended >= EVENT_VETERAN_EVENTS },
  { id: "perfect-alliance", label: "Perfect Alliance", description: "A Real Event alliance scouted at 100% accuracy.", icon: "trophy", earned: (f) => f.hasPerfectAlliance },
];

export type BadgeResult = { badge: BadgeDef; earned: boolean };

/** Every badge, earned or not, in the config's order (the profile shows the earned ones and dims the rest). */
export function computeBadges(facts: BadgeFacts): BadgeResult[] {
  return BADGES.map((badge) => ({ badge, earned: badge.earned(facts) }));
}
