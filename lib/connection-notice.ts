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
