import { mulberry32, seededShuffle } from "./rng";
import { SLOT_IDS, type MatchInput, type ScheduleResult, type ScheduleSettings, type ScheduleSlot, type SlotId } from "./types";

const DEFAULT_INTERVAL_SIZE = 4;
const BATCH_SIZE = 4;
/** A scout counts as "recently used" (soft-avoided for the next pick) if they were assigned in this many of the immediately preceding matches. */
const CONSECUTIVE_WINDOW = 2;

type SlotDescriptor = { slot: SlotId; teamNumber: number };

function matchSlotDescriptors(match: MatchInput): SlotDescriptor[] {
  const descriptors: SlotDescriptor[] = [];
  if (match.red) {
    descriptors.push({ slot: "red1", teamNumber: match.red[0] }, { slot: "red2", teamNumber: match.red[1] });
  }
  if (match.blue) {
    descriptors.push({ slot: "blue1", teamNumber: match.blue[0] }, { slot: "blue2", teamNumber: match.blue[1] });
  }
  return descriptors;
}

/** Ensures SLOT_IDS order in output regardless of which alliances exist. */
function sortDescriptors(descriptors: SlotDescriptor[]): SlotDescriptor[] {
  return [...descriptors].sort((a, b) => SLOT_IDS.indexOf(a.slot) - SLOT_IDS.indexOf(b.slot));
}

/** Picks up to `size` distinct scouts from `pool`, preferring the fewest assignments so far and not recently (consecutively) used, with seeded random tie-breaking. */
function pickBatch(pool: string[], counts: Record<string, number>, recentlyUsed: Set<string>, rng: () => number, size: number): string[] {
  const shuffled = seededShuffle(pool, rng);
  const sorted = [...shuffled].sort((a, b) => {
    const recentA = recentlyUsed.has(a) ? 1 : 0;
    const recentB = recentlyUsed.has(b) ? 1 : 0;
    if (recentA !== recentB) return recentA - recentB;
    return counts[a] - counts[b];
  });
  return sorted.slice(0, size);
}

/** One match's recently-used-scout set, from the sliding window of the last `CONSECUTIVE_WINDOW` matches' assignees. */
function recentlyUsedSet(history: string[][]): Set<string> {
  if (history.length < CONSECUTIVE_WINDOW) return new Set();
  // A scout is "recently used" only if they appear in EVERY one of the last
  // CONSECUTIVE_WINDOW matches — that's what "3+ consecutive" (this match
  // would be their 3rd) actually means, not merely having scouted recently.
  const recent = history.slice(-CONSECUTIVE_WINDOW);
  const [first, ...rest] = recent;
  return new Set(first.filter((uid) => rest.every((batch) => batch.includes(uid))));
}

/**
 * `size` consecutive scouts from `order`, starting at `pickIndex * size`,
 * wrapping cyclically. This is what "Constant Same Order" and "Custom
 * Interval" both build their batches from (one pick per match, one pick per
 * interval, respectively) instead of partitioning scouts into fixed,
 * disjoint groups — a sliding window keeps batch sizes exactly `size`
 * whenever `order.length >= size` (no floaters ever needed to top up an
 * "undersized" group), and its overlap between consecutive picks is what
 * gives it provably even fairness: over one full cycle
 * (`order.length / gcd(size, order.length)` picks), every scout is picked
 * the exact same number of times. See docs/ASSUMPTIONS.md (P6) for why a
 * naive fixed-disjoint-group partition (uneven group sizes needing
 * per-match floater top-ups) was replaced with this.
 */
function cyclicWindow(order: string[], pickIndex: number, size: number): string[] {
  const n = order.length;
  if (size >= n) return order;
  const start = (pickIndex * size) % n;
  const window: string[] = [];
  for (let i = 0; i < size; i++) window.push(order[(start + i) % n]);
  return window;
}

/**
 * Fills one match's slot descriptors from `batch`, falling back to
 * "floaters" (the fewest-assigned scouts not already used in this exact
 * match) when the batch runs out — never double-books the same scout
 * twice within one match.
 */
function assignMatch(
  descriptors: SlotDescriptor[],
  batch: string[],
  allScouts: string[],
  counts: Record<string, number>
): { scoutUid: string | null; slot: SlotId; teamNumber: number }[] {
  const used = new Set<string>();
  const results: { scoutUid: string | null; slot: SlotId; teamNumber: number }[] = [];

  for (const descriptor of descriptors) {
    const fromBatch = batch.find((uid) => !used.has(uid));
    const floaters = allScouts.filter((uid) => !used.has(uid)).sort((a, b) => counts[a] - counts[b]);
    const candidate = fromBatch ?? floaters[0] ?? null;
    if (candidate) {
      used.add(candidate);
      counts[candidate] += 1;
    }
    results.push({ ...descriptor, scoutUid: candidate });
  }
  return results;
}

/**
 * The one scheduling entry point — pure, deterministic given `settings.seed`.
 * See docs/ARCHITECTURE.md (P6) for the rotation-pattern semantics and
 * docs/ASSUMPTIONS.md (P6) for the judgment calls baked in here
 * (prioritized teams excluding, not just preferring, other slots; the
 * "recently used" soft constraint meaning the last 2 matches specifically).
 */
export function generateSchedule(matches: MatchInput[], settings: ScheduleSettings): ScheduleResult {
  const scouts = [...new Set(settings.scoutUids)];
  const counts: Record<string, number> = Object.fromEntries(scouts.map((uid) => [uid, 0]));

  if (scouts.length === 0) {
    const slots = matches.flatMap((m) =>
      sortDescriptors(matchSlotDescriptors(m)).map((d) => ({ ...d, matchType: m.matchType, matchNumber: m.matchNumber, scoutUid: null }))
    );
    return { slots, counts, fair: true, warning: matches.length > 0 ? "No scouts selected." : null };
  }

  const rng = mulberry32(settings.seed);
  // Shared by both "constant-same-order" (one window pick per match) and
  // "custom-interval" (one window pick per interval) — see cyclicWindow's
  // own doc comment for why a sliding window over one shuffled order
  // replaces a fixed, disjoint group partition.
  const order = seededShuffle(scouts, rng);
  const windowSize = Math.min(BATCH_SIZE, scouts.length);
  const intervalSize = settings.intervalSize ?? DEFAULT_INTERVAL_SIZE;

  const slots: ScheduleSlot[] = [];
  const history: string[][] = [];
  let matchIndex = 0;

  for (const match of matches) {
    let batch: string[];
    if (settings.pattern === "constant-same-order") {
      batch = cyclicWindow(order, matchIndex, windowSize);
    } else if (settings.pattern === "custom-interval") {
      batch = cyclicWindow(order, Math.floor(matchIndex / intervalSize), windowSize);
    } else {
      batch = pickBatch(scouts, counts, recentlyUsedSet(history), rng, windowSize);
    }
    matchIndex++;

    const allDescriptors = sortDescriptors(matchSlotDescriptors(match));
    const descriptors =
      settings.prioritizedTeams && settings.prioritizedTeams.length > 0
        ? allDescriptors.filter((d) => settings.prioritizedTeams!.includes(d.teamNumber))
        : allDescriptors;
    const skipped = settings.prioritizedTeams && settings.prioritizedTeams.length > 0 ? allDescriptors.filter((d) => !settings.prioritizedTeams!.includes(d.teamNumber)) : [];

    const assigned = assignMatch(descriptors, batch, scouts, counts);
    for (const a of assigned) slots.push({ matchType: match.matchType, matchNumber: match.matchNumber, ...a });
    for (const s of skipped) slots.push({ matchType: match.matchType, matchNumber: match.matchNumber, ...s, scoutUid: null });

    history.push(assigned.map((a) => a.scoutUid).filter((uid): uid is string => uid !== null));
    if (history.length > CONSECUTIVE_WINDOW) history.shift();
  }

  const values = Object.values(counts);
  const fair = values.length === 0 || Math.max(...values) - Math.min(...values) <= 1;
  const warning = fair ? null : `Assignment counts range from ${Math.min(...values)} to ${Math.max(...values)} — perfect fairness wasn't possible with these settings.`;

  return { slots, counts, fair, warning };
}
