// What the offline safety signal says (FIX3). P1 added an online/offline/"N pending
// sync" indicator so a scout never loses a submission without knowing. The words
// "Online" are gone from the sidebar, so the signal is now silent when everything is
// fine and an amber badge on the droplet button when it isn't. Pure.

export type ConnectionNotice = {
  tone: "offline" | "syncing";
  /** Unsynced submissions, for the badge's number (0 while merely offline). */
  pending: number;
  /** The sentence shown when the badge is tapped. */
  message: string;
};

const submissions = (n: number) => `${n} submission${n === 1 ? "" : "s"}`;

/** Null when the app is online and nothing is waiting to sync — then nothing is shown at all. */
export function connectionNotice(online: boolean, pending: number): ConnectionNotice | null {
  const waiting = Math.max(0, Math.floor(pending));
  if (!online) {
    return {
      tone: "offline",
      pending: waiting,
      message: waiting > 0 ? `Offline: ${submissions(waiting)} will sync when you're back online.` : "Offline: anything you submit will sync when you're back online.",
    };
  }
  if (waiting > 0) return { tone: "syncing", pending: waiting, message: `${submissions(waiting)} still syncing to the server.` };
  return null;
}

// ---------------------------------------------------------------------------
// P18: the always-visible status chip. FIX3 hid the signal while everything was fine; P18 shows all three states,
// in its own spot with a solid backing, so a scout can always see whether they're connected.

export type ConnectionStatus = {
  tone: "online" | "offline" | "syncing";
  /** The chip's text: "Online", "Offline", "Offline · 3", "Syncing 3". */
  label: string;
  /** The sentence read to screen readers and shown in the collapsed-sidebar tooltip. */
  detail: string;
};

export function connectionStatus(notice: ConnectionNotice | null): ConnectionStatus {
  if (!notice) return { tone: "online", label: "Online", detail: "Online. Everything you submit syncs right away." };
  if (notice.tone === "offline") return { tone: "offline", label: notice.pending > 0 ? `Offline · ${notice.pending}` : "Offline", detail: notice.message };
  return { tone: "syncing", label: `Syncing ${notice.pending}`, detail: notice.message };
}
