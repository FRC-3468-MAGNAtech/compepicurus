export type SubmittedEntry = { uid: string; submittedAt: string };

/**
 * Whether a fully-scouted alliance (exactly one submitted entry per robot)
 * is eligible to notify once scores post — per the prompt: either two
 * different scouts each covered one robot, or one scout covered both
 * within `windowMinutes` of each other (in practice, before scores post).
 * Anything else (fewer than 2 entries, or one scout's two entries too far
 * apart) means accuracy can't be meaningfully attributed, so no notify.
 */
export function isAllianceReadyToNotify(entries: SubmittedEntry[], windowMinutes: number): boolean {
  if (entries.length !== 2) return false;
  const [a, b] = entries;
  if (a.uid !== b.uid) return true;
  const diffMs = Math.abs(new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
  return diffMs <= windowMinutes * 60 * 1000;
}
