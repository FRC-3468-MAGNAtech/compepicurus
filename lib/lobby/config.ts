export const LOBBY_CONFIG = {
  /** How often an open lobby room writes its own (player or host) heartbeat. */
  HEARTBEAT_INTERVAL_MS: 20_000,
  /** A player with no heartbeat for this long shows as "disconnected" (can still rejoin). */
  PLAYER_STALE_MS: 90_000,
  /** The host with no heartbeat for this long shows the lobby as abandoned — client-derived only, never an actual status write (see docs/ASSUMPTIONS.md, P8). */
  HOST_STALE_MS: 5 * 60_000,
  /** A lobby in "waiting"/"scouting" with no activity this long is treated as expired by readers. */
  LOBBY_EXPIRE_MS: 6 * 60 * 60_000,
  /** After the match video's own duration elapses past `startsAt`, wait this much longer for stragglers before auto-resolving results. */
  RESULTS_GRACE_AFTER_VIDEO_END_MS: 3 * 60_000,
  /** The countdown shown to every player once the host starts the match. */
  COUNTDOWN_SEC: 3,
};
