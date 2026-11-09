# Architecture

This is a living document. Every prompt that touches data, auth, or shared
modules extends it so later prompts can reference things by name instead of
re-reading the whole codebase.

## Vocabulary

- **Alliance**: 2 robots (Red or Blue). Accuracy is always per alliance.
- **Event match type**: P / Q / F (practice, qualification, finals matches at
  a competition). Stored as `matchType: "Practice" | "Qualification" |
  "Playoff"`. This is *not* "practice scouting".
- **Scouting category**: **Trial** (practice), **Competitive** (practice), or
  **Real Event**. Modeled by `ScoutEntry.source` / `mode` (both widened in
  P3 to actually carry `"practice"`/`"live"` and `"trial"`/`"competitive"`)
  and by `PracticeSession.kind`/`mode` — `getCategory()` in
  `lib/practice-sessions.ts` derives the category from either. `source:
  "event"` and `kind: "live"` both mean "Real Event".
- **Session**: one practice-scouting run, identified by a Session ID
  (`practiceSessions/{sessionId}` — P3). Started/resumed from
  `/practice-scouting` (P4) for `kind: "solo"`; `"live"`/`"lobby"` kinds
  have no scout-facing way to start one yet (P5+).
- **Library match**: an imported official match used for practice scouting
  — `libraryMatches/{id}` (P3).
- **Scout entry**: one submitted match scout form for one robot —
  `scoutEntries/{entryId}`.
- **Scout form schema**: the versioned, data-driven description of a form's
  sections/fields and their point values (`lib/scout-form/schema.ts`) that
  both `<ScoutForm/>`'s UI and `calculateScore()` are generated from (P2).

## Stack

Next.js App Router (not Vite/React Router — see `docs/ASSUMPTIONS.md`,
P1-1), React, Tailwind, Framer Motion, Firebase (Auth + Firestore). Deployed
on Vercel; see `docs/DEPLOYMENT.md`. FIRST/FTC Events API calls go through
Next.js Server Actions (`lib/ftc/actions.ts`, `"use server"`) so the API key
never reaches the browser bundle, with no Firebase Cloud Function needed
(see P1-2) — Vercel runs Server Actions and Route Handlers as serverless
functions on its own.

Those Server Actions also require a signed-in user before serving any FIRST
API data (see "Auth proxy" below) and cache upstream responses for a few
minutes server-side to stay under FIRST's rate limit (`lib/ftc/http.ts`).

## Firestore collections

All collections are scoped by `teamId`. P1 assumed a single fixed team doc;
P1b replaced that with a real (if still usually-one-row) `teams` collection
once "create another team later" became an explicit possibility — see
docs/ASSUMPTIONS.md, P1b-1.

### `teams/{teamId}`

| Field | Type | Notes |
|---|---|---|
| `number` | `number` | FTC team number. Since P19 it mirrors the first entry of `fieldTeams` (still read as a fallback until the migration has run) |
| `name` | `string \| null` | Optional team name (P1b). Since P19 it mirrors the first FTC team's name |
| `fieldTeams` | `{ id, number, name }[]` (P19, optional) | The account's FTC teams, the admin's order, 1 to 10. Absent before the migration; read through `readFieldTeams()`. See "P19 — Several FTC teams under one account" |
| `fieldTeamIdList` | `string[]` (P19, optional) | The ids of `fieldTeams`, same order: a rules-only mirror that members' `fieldTeamIds` writes are checked against. Always written together with `fieldTeams` |
| `accountName` | `string \| null` (P19, optional) | Display name for the account itself (at most 60 characters), separate from the FTC teams |
| `fieldTeamNumbers` | `number[]` (P19/P20, optional) | The numbers of `fieldTeams`, same order: a queryable mirror (an application checks `array-contains` to see whether an account already has an FTC team); `fieldTeamsWrite()` and the migration keep it in step |
| `ownerUid` | `string` (P20, optional) | The TEAM owner. Authoritative for ownership; server-written only (rules refuse it from every client). Set at creation/approval, by the sync-roles bootstrap (only while absent), and by the transfer routes |
| `pendingTransfer` | `{ id, fromUid, fromName, toUid, toName, requestedAt, expiresAt }` (P20, optional) | A pending ownership transfer (7 days). Server-written only; read by every member (the recipient's banner) |
| `applicationId` | `string` (P20, optional) | On an account an approved application created |
| `joinCode` | `string` | Random 6-char code (no ambiguous 0/O/1/I). No longer publicly readable (P1b — see `firestore.rules` and P1b-1); only a team's own members can read it, mainly so Team Management can show it to admins |
| `activeEventCode` | `string \| null` | FIRST API event code of the **primary** active event. Since FIX1 a team can have several active events; this stays pointed at the primary so pre-FIX1 readers keep working |
| `activeSeasonId` | `number \| null` | FIRST API season year |
| `activeEvent` | `FtcEvent \| null` | Denormalized full event object (P1-5) so pages don't need a second API round-trip just to show the active event's name/dates — the primary event |
| `activeEventCodes` | `string[]` (FIX1, optional) | Every active event's code, in selection order, **always including the primary** (`activeEventCode`); empty iff there is no primary. At most 10. Absent on pre-FIX1 teams — `readActiveEvents()` reads those as `[activeEventCode]` and an admin's session persists it. Validated in `firestore.rules` (`validActiveEvents()`) |
| `activeEvents` | `FtcEvent[]` (FIX1, optional) | Denormalized event objects for `activeEventCodes`, same order and length (same reason as `activeEvent`) |
| `usePlaceholderVideo` | `boolean` (P3, optional) | Admin Panel > Match Library's "Use placeholder video for testing" — absent on teams created before this field existed, treat as `false` |
| `createdAt` | `Timestamp` | |

Auto-generated document id, created only via `app/api/team/create`'s
transaction (P1b) — never directly by a client (`firestore.rules` denies
client creates outright). P1's `firstAdminClaimed` bootstrap-race field is
gone: the transaction makes team + first-admin creation properly atomic, so
the workaround it existed for no longer applies.

### `appSettings/global` (P1b)

| Field | Type | Notes |
|---|---|---|
| `teamCreationEnabled` | `boolean` | Whether Signup/Finish Setup may offer "Create a team". Defaults to `true` only if no team exists yet; flipped to `false` inside `app/api/team/create`'s transaction, flippable back by an owner via `app/api/admin/team-creation` |

Denied to every client, read and write, no exceptions (`firestore.rules`) —
only ever touched by the Admin SDK from `app/api/public/config`,
`app/api/team/create`, and `app/api/admin/team-creation`.

### `users/{uid}`

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | |
| `email` | `string` | Mirrors the Firebase Auth email |
| `teamId` | `string` | References a `teams/{teamId}` doc |
| `primaryRole` | `RoleId` | One of `lib/roles.ts`'s `ROLES`; shown as a colored pill. Admin-editable in Team Management's editor (FIX1); `firestore.rules` requires a real role id |
| `secondaryRoles` | `RoleId[]` | Shown as neutral pills. Stored normalized since FIX1: primary removed, canonical `ROLES` order, at most 9 |
| `isAdmin` | `boolean` | Separate from roles — gates Admin Panel + team/event management. Changed by an admin or the owner (FIX2: never by the admin themself — the last-admin safeguard — and never on an owner's row; an owner's flag is pinned on). See `canEditMember` in `lib/member-access.ts` |
| `isOwner` | `boolean` (P1b, P20) | **P20: a mirror of `teams/{teamId}.ownerUid`** (the TEAM owner), written only by server routes in the same transaction as `ownerUid` (bootstrap, transfer, team creation/approval); immutable from any client. Authoritative is `ownerUid`: the rules ignore a stale flag once it exists. FIX2: an owner can edit their *own* roles (never this flag or their admin flag) — see "Owner role editing (FIX2)" |
| `isPlatformOwner` | `boolean` (P20, optional) | A PLATFORM owner (an email in `OWNER_EMAILS`): set and cleared by `app/api/auth/sync-roles` together with the `platformOwner` claim; pinned in both update rules |
| `themeId` | `string` | Any id in the `lib/themes.ts` registry (`team`, `biobuzz`, the P18 solid / gradient / `pride-*` ids). Applied by `ThemeProvider` as soon as the profile loads; the account's value wins over this browser's |
| `fieldTeamIds` | `string[]` (P19, optional) | The FTC teams (ids from `teams/{teamId}.fieldTeams`) this member is assigned to. Admin/owner-only to change, never the member's own (rules); checked against `fieldTeamIdList`. None recorded counts as all teams |
| `activeFieldTeamId` | `string \| null` (P19, optional) | The FTC team this user is "viewing as"; their own to write, resolved against their assigned teams |
| `colorMode` | `"light"`, `"dark"` or `"system"` (P18, optional) | Separate from `themeId`; absent until first chosen (then this browser's / the system's applies). Ignored while a `pride-*` theme is active. The own-doc update rule already allows it: no rules change |
| `createdAt` | `Timestamp` | |

Document id is the Firebase Auth `uid`. Created only via
`app/api/team/join` or `app/api/team/create` (Admin SDK) — P1b also removed
the client's ability to create its own doc directly, closing a gap where
the old create rule checked a target team *existed* but never that the
caller supplied a matching join code (see P1b-2).

### `scoutEntries/{entryId}`

| Field | Type | Notes |
|---|---|---|
| `teamId` | `string` | |
| `uid` | `string` | Who's allowed to write this doc per rules — for CSV imports this is the *importing admin's* uid, not a fabricated mapping from the free-text `scoutName` (see P1-7) |
| `source` | `"event" \| "practice" \| "live"` | Widened in P3 (was `"event"` only) — `"event"` is today's Match Scout Form, `"practice"`/`"live"` are for P4's `practiceSessions` |
| `mode` | `"trial" \| "competitive" \| null` | Widened in P3 (was always `null`) — only meaningful when `source: "practice"` |
| `formId` / `formVersion` | `string` / `number` | Matches `lib/analytics/game-schema.ts`'s `DEFAULT_GAME_ID` (`"biobuzz"`, version `1`) so entries can be rescored later even if the form changes |
| `scoutName` | `string` | Free-text display name, resolved from the scout's profile at submit time |
| `eventCode` | `string` | |
| `matchType` | `MatchType` | |
| `matchNumber` | `number` | |
| `teamNumber` | `number` | |
| `fields` | `ScoutEntryFields` | Raw per-field values, not just the score, so entries can be rescored |
| `score` | `ScoreBreakdown` | `{ auto, teleop, endgame, total }` |
| `comments` | `string` | |
| `submittedAt` | `string` (ISO) | Client-set, usable immediately (including offline, before `createdAt` syncs) |
| `createdAt` | `Timestamp` | Server-set |
| `excluded` | `boolean` | Excluded from stats, still visible |
| `autoFlags` | `AutoFlag[]` | `{ ruleId, dismissed }` — recomputed by `lib/analytics/recompute.ts` |
| `manualFlags` | `ManualFlag[]` | `{ id, reason, note?, addedAt }` |
| `accuracy` | `AccuracyResult \| null` | Recomputed alongside `autoFlags` |
| `sessionId` | `string \| null` (P3) | Set for `"practice"`/`"live"` entries — the `practiceSessions` doc this entry belongs to |
| `libraryMatchId` | `string \| null` (P3) | Set for `"practice"` entries scored against an imported `libraryMatches` doc |

### `libraryMatches/{id}` (P3)

Id format: `${eventCode}_${matchType prefix}${matchNumber}` (e.g.
`USWABON1_Q12`) via `lib/match-library.ts`'s `libraryMatchId()` — reuses
`lib/analytics/game-schema.ts`'s existing `MATCH_TYPE_PREFIX` (P/Q/F).
**Deliberately not `teamId`-scoped** — see P3-6.

| Field | Type | Notes |
|---|---|---|
| `seasonId` | `string` | A `lib/seasons.ts` id |
| `eventCode` / `eventName` | `string` | |
| `matchType` | `MatchType` | |
| `matchNumber` | `number` | |
| `alliances.red` / `.blue` | `{ teams: number[], score, penaltyPoints, difficulty }` | `difficulty` via `lib/difficulty.ts`'s `getDifficulty(score)`, computed per alliance |
| `video` | `{ youtubeUrl, startSec, endSec } \| null` | Admin-set in Admin Panel > Match Library; never written by the import itself except as `null` on first creation |
| `importedAt` | `string` (ISO) | Set once, on first import — never overwritten by a later re-import/refresh |
| `scoresUpdatedAt` | `string` (ISO) | Updated every time scores are (re-)imported |

Imported (and refreshed) via `lib/match-library.ts`'s `importLibraryEvent(seasonId, eventCode)` — idempotent by construction (deterministic doc id), and importing/refreshing never touches `video`/`importedAt` on an existing doc (see P3-3).

### `libraryEvents/{eventCode}` (P15)

One doc per library event — every API event that has been imported (`origin: 'api'`,
written by `importLibraryEvent`, or stamped by the one-time backfill) and every
hand-made one (`origin: 'manual'`). The doc id **is** the event code. Readable by
any signed-in user; admin-only writes. `origin` is fixed at creation (rules), so
a manual event's code can never be taken over by an API import, or the reverse.
Only a manual event can be deleted.

| Field | Type | Notes |
|---|---|---|
| `eventCode` | `string` | = the doc id. Manual codes are `MAN-` + a slug, or the admin's own: 3-24 chars of `A-Z 0-9 -`, no underscore (the match id is `${eventCode}_…`) |
| `eventName` | `string` | 1-120 chars; copied onto each match's own `eventName` |
| `seasonId` | `string` | A `lib/seasons.ts` id |
| `origin` | `'api' \| 'manual'` | |
| `date` | `string \| null` | `YYYY-MM-DD`, optional |
| `sourceUrl` | `string \| null` | `https://` link to where the scores came from, optional |
| `defaultVideoUrl` | `string \| null` | One long stream reused for every match of the event; a match with no link of its own uses it |
| `createdBy` | `string` | uid |
| `createdAt`, `updatedAt` | `string` (ISO) | |

### `libraryMatches` additions (P15)

`libraryMatches` also holds **hand-entered ("manual") matches** now — same
collection, same id format (`${eventCode}_${P|Q|F}${number}`), same shape, so
every practice flow, difficulty tier, lobby, accuracy screen, and Analytics
practice filter reads them without knowing the difference. New fields:

| Field | Type | Notes |
|---|---|---|
| `origin` | `'api' \| 'manual'` | Absent on a pre-P15 doc = `'api'` (`originOf()`). **Never changes** on an existing doc (rules), so an API import/refresh can't overwrite a manual match and a manual write can't overwrite an API match |
| `published` | `boolean` | Members read only `published == true`; admins read all. Manual matches entered one at a time start `true`; CSV/paste imports start `false` |
| `needsReview` | `boolean` (manual) | True for bulk-imported matches until an admin publishes them (the "Needs review" badge) |
| `createdBy` | `string` (manual) | uid of the admin who first entered it |
| `updatedAt` | `string` (ISO, manual) | |
| `notes` | `string` (manual) | ≤ 500 chars |

A manual match's `video` is `{ youtubeUrl, startSec, endSec } | null` like any
other; `youtubeUrl` is always stored in the canonical `https://www.youtube.com/watch?v=ID`
form whatever link the admin pasted. Difficulty is recomputed from the typed scores
with the shared `getDifficulty` every time the doc is built. Rules for a manual match
(`validManualMatch`): it may only sit under a **manual** `libraryEvents` doc, its id must
be the one its own fields give, scores are whole numbers 0-9999, each alliance's
penalty points ≤ its score, and `difficulty` is a real tier. Only manual matches can be deleted.

### `practiceSessions/{sessionId}` (P3; fields filled in and consumed starting P4; live-mode fields added P7)

The doc id **is** the Session ID — generated by `lib/practice-sessions.ts`'s
`generateSessionId(kind)` (pure: `PS-`/`LV-`/`LB-` + 6 unambiguous
characters) and reserved uniquely via `claimSessionId(teamId, uid, kind)`
(a Firestore transaction — see P3-4 for why this is a separate function
from `generateSessionId` itself). For `kind: "solo"`, the
`/practice-scouting` orchestrator (P4) follows `claimSessionId`'s minimal
stub write with an immediate `updatePracticeSession()` filling in
`seasonId`/`mode`/`difficulty`/`libraryMatchId`/`eventCode`/`alliance`/
`robots`/`platform` once the scout has picked all of those; `id` (the first
field of the `PracticeSession` TS type) is attached client-side from the doc
id, not stored as its own field.

| Field | Type |
|---|---|
| `teamId`, `uid`, `scoutName` | `string` |
| `kind` | `"solo" \| "live" \| "lobby"` |
| `seasonId` | `string` |
| `mode` | `"trial" \| "competitive" \| null` |
| `difficulty` | `Difficulty \| null` |
| `libraryMatchId` | `string \| null` |
| `eventCode` | `string \| null` |
| `alliance` | `"red" \| "blue" \| null` |
| `robots` | `number[]` |
| `status` | `"in-progress" \| "paused" \| "completed"` |
| `completedRobots` | `number[]` |
| `entryIds` | `string[]` |
| `accuracy`, `scoutedTotal`, `penaltyPoints`, `officialScore` | `number \| null` |
| `platform` | `"pc" \| "mobile"` |
| `flags` | `{ type, title, detail, dismissed }[]` |
| `excluded` | `boolean` |
| `lobbyId`, `pairId` | `string \| null` |
| `startedAt` | `string` (ISO) |
| `finishedAt` | `string \| null` (ISO) |
| `matchType` | `MatchType \| null` (P7) |
| `matchNumber` | `number \| null` (P7) |
| `allianceTeams` | `[number, number] \| null` (P7) — both robots on this session's alliance, regardless of which one `robots[0]` is |
| `streamUrl` | `string \| null` (P7) |
| `streamStartSec`, `streamEndSec` | `number \| null` (P7) — always `null` in this build; see docs/ASSUMPTIONS.md (P7-1) |

For `kind: "live"`, `robots` always holds exactly the one team this scout is
watching (`allianceTeams` carries both). `claimSessionId`/`updatePracticeSession`
are reused unchanged from solo mode — live mode just fills in the extra
fields above instead of `libraryMatchId`/`difficulty`.

`allow delete` (`firestore.rules`) lets the session's own owner delete it
while `in-progress`/`paused` (P4), and — P5 — lets an **admin** delete it
once `completed`, scoped to exactly that status: Scout Accuracy's "Hard
Reset Scout Data" needs this, but an admin still can't delete someone
else's in-progress/paused session (that stays owner-only, unchanged from
P4). See docs/ASSUMPTIONS.md (P5) for why this is scoped this narrowly
instead of a blanket `isAdmin()`.

### `eventAttendance/{teamId}_{eventCode}` (P5 shape guess; real shape and writer added P6)

Owned by the Assignments page (P6): one doc per (team, event), `uids` the
list of attending members, edited via its attendance checklist
(`lib/event-attendance.ts`'s `setEventAttendance`). P5 guessed a different
(read-only, one-doc-per-uid) shape for this collection before P6's own spec
existed — see docs/ASSUMPTIONS.md (P6) for the reconciliation, including
why `lib/scout-stats/engine.ts`'s Event filter check only needed a
one-line change despite the shape change.

| Field | Type |
|---|---|
| `teamId`, `eventCode` | `string` |
| `uids` | `string[]` |
| `updatedAt` | `Timestamp` |

`firestore.rules`: readable by the same team (drives Scout Accuracy's Event
filter and People's "Attending" badge); only admins can create/update;
delete denied outright (no "un-publish attendance" concept).
`lib/event-attendance.ts` exports both `useTeamEventAttendance(teamId)`
(every event's attendance — what the stats engine and Scout Accuracy read)
and `useEventAttendance(teamId, eventCode)` (one event's doc — what the
Assignments page's own checklist reads/edits).

### `assignments/{teamId}_{eventCode}` (P6)

The published scouting schedule for one event — who watches which robot in
which match. `current` is live; `previous` holds exactly one prior
version for undo (not a full history — see P6-3). Written only via
`lib/assignments.ts`'s `publishAssignments`/`undoAssignments`/
`swapAssignmentSlot`, all plain client `setDoc`/`updateDoc` calls gated by
`firestore.rules` (admin-only write, same pattern as every other
admin-managed collection here — no API route needed, since nothing here
needs the Admin SDK's bypass-the-rules capability).

| Field | Type |
|---|---|
| `teamId`, `eventCode` | `string` |
| `current` | `AssignmentVersion \| null` |
| `previous` | `AssignmentVersion \| null` |

`AssignmentVersion`: `{ generatedBy: string (uid), generatedAt: string
(ISO), settings: AssignmentSettings, slots: ScheduleSlot[], counts:
Record<uid, number>, fair: boolean, warning: string | null }`.
`ScheduleSlot`: `{ matchType, matchNumber, slot: "red1"|"red2"|"blue1"|
"blue2", teamNumber, scoutUid: string | null }` — one per robot per match,
`scoutUid: null` meaning deliberately unassigned (see the Prioritize-teams
note under `lib/scheduler/` below). `AssignmentSettings` records exactly
what was used to generate `slots` (match source, ranges/categories,
rotation pattern, the scout pool, prioritized teams, the RNG seed) so a
published schedule's provenance is always inspectable.

`firestore.rules`: readable by any team member (Match Scout Form and My
Scouting both read their own slots out of someone else's published
schedule); only admins can create/update; delete denied outright (undo
goes through `previous`, not deletion).

### `auditLog/{id}` (P5; read by the Admin Panel's Audit Log tab starting P9)

One entry per admin-only scout-data action (Hard Reset, Dismiss Flag,
Exclude/Include from P5; Edit Entry, Rescore Event, Rescore Sessions,
Refresh Official Scores, and Export Backup from P9 — see
`lib/scout-stats/actions.ts` and `lib/admin/`). Write-once: nobody,
including admins, can update or delete an entry, so it stays a trustworthy
record. `firestore.rules` never restricts the `action` value itself (only
`uid`/`teamId` on create), so P9 added its five new action strings purely
in `lib/audit-log.ts`'s `AuditAction` union — no rules change needed.
P12 added `edit-pick-list` (`target { eventCode, op }`, `before`/`after` `{ picked }`),
written in the same transaction as each pick-list change; because most pick-list
editors aren't admins, `firestore.rules` lets non-admin editors create *only*
that action's entries.
FIX1 added `edit-member-roles` (Team Management's role editor): `target`
`{ targetUid, targetName }`, `before`/`after` `{ primaryRole, secondaryRoles,
isAdmin }`, written in the same batch as the role change itself
(`lib/team-members.ts`'s `updateMemberAccess`, using `buildAuditEntry`/
`newAuditLogRef` from `lib/audit-log.ts`).

| Field | Type |
|---|---|
| `teamId`, `uid` (the actor), `actorName` | `string` |
| `action` | `AuditAction` — see `lib/audit-log.ts` for the full, current list |
| `target` | `Record<string, unknown>` — action-specific context (e.g. `{ targetUid, targetName, category }` for a reset) |
| `before`, `after` | `unknown` — whatever state changed |
| `createdAt` | `Timestamp` |

### `liveMatches/{eventCode_matchKey}/scouts/{uid}` (P7)

Presence only — who's actively watching which robot on which live match
right now, used to drive the Join rules and the "who's live" pill/panel.
The parent `liveMatches/{matchKey}` doc itself is never written (same
precedent as `libraryMatches`'s parent-less-document convention); the key
is `lib/match-library.ts`'s `libraryMatchId()` format
(`{eventCode}_{matchType}{matchNumber}`), reused via `liveMatchKey()` in
`lib/live-presence.ts` so live and library matches address the same match
the same way. Heartbeat-written every `LIVE_CONFIG.PRESENCE_HEARTBEAT_INTERVAL_MS`
(20s) while a scout has a live session's screen open, deleted on unmount;
a doc older than `LIVE_CONFIG.PRESENCE_STALE_MS` (90s) is treated as gone
by readers rather than actively cleaned up (no TTL/cron needed — see
docs/ASSUMPTIONS.md, P7-3).

| Field | Type |
|---|---|
| `uid`, `teamId`, `name` | `string` |
| `robot` | `number` (the team number this scout is watching) |
| `alliance` | `"red" \| "blue"` |
| `sessionId` | `string` |
| `lastSeen` | `Timestamp` |

`firestore.rules`: readable by the same team (a collection-group query
across every match's `scouts` subcollection — needs the composite index in
`firestore.indexes.json`); a scout may only create/update their own doc
(`uid` must match `request.auth.uid` both in the path and in the written
data) and may only delete their own.

### `notifications/{sessionId}` (P7)

One doc per resolved live session that got a push notification sent for
it — its existence is what makes `resolvePendingLiveMatches` idempotent
(see docs/ASSUMPTIONS.md, P7-6). Written only by the Admin SDK (the cron
route and the client-fallback route); never written or read by rules
-gated client code except the owning scout's own read, used by the
results screen/global watcher as a secondary signal.

| Field | Type |
|---|---|
| `teamId`, `uid` | `string` |
| `title`, `body` | `string` |
| `createdAt` | `Timestamp` |

`firestore.rules`: readable only by its own `uid`, scoped to the same
team; all client writes denied.

### `lobbies/{lobbyId}` and `lobbies/{lobbyId}/players/{uid}` (P8)

A Live Practice Lobby's own doc — one round, hosted by one scout, scouted by
however many players joined. The doc id **is** the shareable join code
(`LB-XXXXXX`, same alphabet/format as a Session ID — reserved via
`lib/lobby.ts`'s `claimLobbyId`, which calls `lib/practice-sessions.ts`'s
now-generic `claimUniqueDocId`). Per-pair accuracy is written by
`app/api/lobby/resolve-results` (Admin SDK), not by the client — see
docs/ASSUMPTIONS.md (P8) for why.

| Field | Type |
|---|---|
| `teamId`, `hostUid`, `hostName`, `seasonId` | `string` |
| `mode` | `"trial" \| "competitive"` |
| `status` | `"waiting" \| "scouting" \| "results" \| "closed"` |
| `libraryMatchId` | `string \| null` |
| `settings` | `{ hostScouts: boolean; hostIsDisplayer: boolean }` |
| `pairing` | `PairAssignment[] \| null` — set once, at Start |
| `startsAt` | `string \| null` (ISO) |
| `hostLastSeen` | `Timestamp` |
| `resolvedAt` | `Timestamp \| null` |

`PairAssignment`: `{ pairId, playerUids: [uid, uid], alliance, robotForUid:
Record<uid, teamNumber> }` — the full pairing for the round, computed once
by `lib/lobby/pairing.ts`'s `assignPairs` and written by the host alongside
`status: "scouting"`. Deliberately NOT stored per-player on the `players`
subdoc (even though the prompt's own schema sketch lists `pairId`/`robot`
there) — see docs/ASSUMPTIONS.md (P8) for why that would conflict with
"players write only their own player doc."

`players/{uid}`: `{ uid, teamId, name, joinedAt, lastSeen, submitted }` —
presence/roster only, each player's own doc, written only by themself
(join, heartbeat, marking their own submission, and resetting `submitted`
back to `false` on re-entering the waiting room for "Play Again" — see
docs/ASSUMPTIONS.md, P8).

`firestore.rules`: the lobby doc is readable by the whole team (so "Join
with code" can look one up before the joiner has a player doc of their
own) and writable only by its `hostUid`; `players/{uid}` is readable by
the whole team, writable only by that uid (create/update/delete).

### `pickLists/{teamId}_{eventCode}` (P12)

The shared alliance-selection board for one event: the teams we plan to pick,
in priority order. Edited live by several people (see "Pick List (P12)" below
for the transaction pattern that keeps concurrent edits from overwriting each
other); readable by the whole team, editable only by admins and Lead Strategists,
Lead Scouts, Team Coaches, and Drive Team members (primary *or* secondary
role). Never deleted — "Reset list" empties `picked`.

| Field | Type |
|---|---|
| `teamId`, `eventCode` | `string` (together = the doc id) |
| `picked` | `number[]` — team numbers, index 0 = first choice; at most 100 |
| `updatedBy` | `string` — uid of the last editor |
| `updatedByName` | `string` — their name at the time (denormalized for "Last edited by X") |
| `updatedAt` | `Timestamp` |

### `changelog/{id}` (P14)

Admin-written release notes. Members read **published** entries only; admins of
the team read and write everything, drafts included. Auto-id, except the starter
drafts, whose ids are `starter-{teamId}-{key}` so seeding is idempotent.

| Field | Type |
|---|---|
| `teamId` | `string` |
| `version` | `string` — "v1.4.0" or any label; 1-40 chars |
| `title` | `string` — 1-120 chars |
| `date` | `string` — `YYYY-MM-DD` (a plain day, not a timestamp, so it never shifts with a timezone) |
| `summary` | `string` — up to 1000 chars; may be empty. Safe minimal markup (see "Changelog & Credits (P14)") |
| `changes` | `{ type: "new" \| "improved" \| "fixed" \| "removed", text: string }[]` — 1-40 rows; `text` up to 400 chars, same markup |
| `status` | `"draft" \| "published"` |
| `pinned` | `boolean` — pinned entries sort above newer ones |
| `createdBy` | `string` — uid; never changes |
| `createdAt`, `updatedAt` | `Timestamp` |
| `publishedAt` | `Timestamp \| null` — when it first went live; `null` while a draft. Kept through edits, so fixing a typo doesn't re-light the unread dot; unpublishing clears it |

Rules can't loop over `changes`, so its elements aren't type-checked there —
only that it is a list of 1-40. The editor validates them, and `entryFromData()`
drops any malformed row on read.

### `credits/{teamId}` (P14)

The single Credits page for a team: ordered `sections`, each with ordered
`entries`. The doc id **is** the team id. Readable by the whole team (a team that
has never saved credits reads as "missing", which the page shows as the built-in
defaults); writable only by admins, only as themselves, and only through the
transaction in `lib/credits/store.ts`. Never deleted.

| Field | Type |
|---|---|
| `teamId` | `string` (= the doc id) |
| `sections` | `{ id, title, order, entries[] }[]` — at most 20 |
| `sections[].entries` | `{ id, name, description, link, imageUrl }[]` — at most 60 per section. `description` supports the safe markup; `link` and `imageUrl` are `https://` URLs or `null` |
| `updatedBy`, `updatedByName` | `string` — the last editor |
| `updatedAt` | `Timestamp` |

Rules check the shape of the doc (a list of at most 20) but not the contents of
`sections`; the editors enforce https-only links and `sanitizeSections()`
discards a malformed row, or a non-https link/image, on read.

### Fields added to existing docs (P14)

- `users/{uid}.lastSeenChangelogAt` (`Timestamp`, optional) — written by the user
  themself when they open the Changelog; drives the unread dot. The existing
  self-update rule already allows it (it can't be used to change a role).
- `teams/{teamId}.changelogSeeded` (`boolean`, optional) — set in the same
  transaction that creates the starter changelog drafts, so they're created once
  and never come back after an admin deletes them. Written by an admin under the
  existing team-update rule.

## Shared modules

- `lib/firebase/client.ts` — initializes the Firebase app once, exports
  `auth`/`db` (Firestore with `persistentLocalCache` +
  `persistentMultipleTabManager` for offline support), and
  `isFirebaseConfigured()`. Every real consumer checks that first so a
  missing `.env.local` config doesn't crash the whole app on import.
- `lib/auth.tsx` — `AuthProvider`/`useAuth()`. Firebase `onAuthStateChanged`
  + a live `onSnapshot` on the signed-in user's own `users/{uid}` doc.
  Exposes `login`, `loginWithGoogle`, `linkGoogle`, `signup` (account
  creation only — see "Accounts & roles (P1b)" below for team enrollment),
  `logout`, `resetPassword`, `changePassword`, `updateUserProfile`,
  `resendVerificationEmail`, `linkedProviders`, and the Google
  account-linking-conflict pair `pendingGoogleLink`/`completeGoogleLink`.
- `lib/team.ts` — `useTeamDoc(teamId)` (realtime `onSnapshot` on a specific
  `teams/{teamId}` — `teamId` comes from the caller's own profile, not a
  fixed id; see P1b-1), `setActiveEvents(teamId, state)` (FIX1: writes the
  whole multi-event selection plus the legacy primary fields) and
  `setActiveEvent(teamId, event)` (replaces the selection with one event).
  Admin-gated at call sites via `usePermissions()`, enforced again in
  `firestore.rules`.
- `lib/active-event.tsx` — **`useActiveEvents()`** (FIX1) → `{ events,
  primary, primaryCode, isActive(code), loaded }`, realtime, resolves
  `teamId` from `useAuth().profile`; also persists the one-time
  `activeEventCodes` migration from an admin's session. Everything that
  picks or filters by event uses this. `useActiveEvent()` remains as a shim
  returning just the primary.
- `lib/active-events.ts` (FIX1, pure, tested) — `readActiveEvents(team)`,
  `toggleActiveEvent`/`setPrimaryActiveEvent` (selection rules: first
  selected is primary, removing the primary promotes the next, max
  `MAX_ACTIVE_EVENTS = 10`), `buildActiveEventsFields(state)` (the exact
  fields written to the team doc), `needsActiveEventsMigration`,
  `orderPrimaryFirst`, and `pickDefaultActiveEvent(state, now)` (an In
  Progress active event, else the primary — the default for the Scout Form,
  Match Analytics, and Live Practice).
- `lib/ftc/event-status.ts` (FIX1, pure, tested) — `getEventStatus(event,
  now)` (calendar-day comparison in the event's timezone — the single
  definition; the FIRST API server action uses it too), `sortEvents(events,
  "status" | "newest" | "oldest", now)`, `countEventsByStatus`. Display code
  recomputes status with this instead of trusting the frozen `FtcEvent.status`.
- `lib/team-members.ts` — `useTeamMembers(teamId)` (realtime roster) plus
  `updateMemberAccess(actor, member, changes)` (FIX1: the editor's save — the
  role/admin change and its `edit-member-roles` audit entry in one atomic
  batch; replaces the old `setMemberPrimaryRole`/`setMemberSecondaryRoles`/
  `setMemberAdmin`). Backs both Team Management (editable) and People
  (read-only). `TeamMember` now carries `isOwner` too (P1b).
- `lib/member-access.ts` (FIX1, reworked FIX2; pure, tested) — `canEditMember(actor,
  target)` (the single "may this actor edit this member?" check, the TypeScript
  twin of the `users/{uid}` update rule), `getMemberEditState(actor, member,
  adminCount)` (Edit button state + the admin switch's block: `owner`, `self`,
  `last-admin`; the last-admin block only ever affects the switch), `diffMemberAccess`,
  `normalizeSecondaryRoles`. The actor is `{ uid, isAdmin, isOwner }`.
- `lib/roles.ts` — the 9-role config (`ROLES`, `RoleId`, `getRole`,
  `DEFAULT_ROLE_ID`), each with a fixed Tailwind color token.
- `lib/permissions.ts` — `usePermissions()` → `{ isAdmin, isOwner,
  can(action) }`. Actions: `"manageTeam"`, `"manageScoutData"` (admin-only),
  `"toggleTeamCreation"` (owner-only, P1b).
- `lib/scout-entries.ts` — Firestore-backed `saveEntry`, `getEntries`,
  `getEntriesForEvent`, `subscribeEntries` (realtime; also reports
  `pendingWrites` via `doc.metadata.hasPendingWrites`, driving the
  Online/Offline/"N pending sync" indicator), `updateEntry`, `deleteEntry`.
  All but `subscribeEntries` are `async` and `teamId`-scoped.
- `lib/analytics/recompute.ts` — `recomputeForEvent(teamId, eventCode,
  season)`: recomputes accuracy + auto flags for every entry in an event
  against live official match data.
- `lib/use-connection-state.ts` + `lib/connection-notice.ts` (FIX3, replacing the nav "Online" label
  in `components/layout/connection-status.tsx`) — the offline / "N pending sync" signal, scoped to the
  active events' entries (summed). FIX3 showed it as an amber badge on the droplet; **P18 replaced that** with the always-visible
  `ConnectionChip` (see "P18 — Themes, Appearance, sidebar" below) and removed the badge.
- `components/team/member-row.tsx` — member display for Team Management:
  coloured primary pill, uncoloured secondary pills, and (admins) an Edit
  button / "Locked" marker driven by `getMemberEditState`.
- `components/team/member-editor-dialog.tsx` (FIX1) — the admin role editor:
  primary select, secondary toggles, admin switch, Save/Cancel, glow on save.
  Mount with a fresh `key` per open.
- `components/event/selected-events-panel.tsx` (FIX1) — the Event
  Selection "Selected events" panel and its condensed sticky bar (zero-height
  sticky slot + IntersectionObserver; never moves content). Also exports
  `STATUS_BADGE`/`formatDateRange`. Render it as a direct child of the page's
  `flex flex-col gap-6` root.
- `components/layout/page-transition.tsx` — fade-in-only route wrapper
  (FIX1-1): no `AnimatePresence`/exit, so an outgoing page can never linger in
  flow and push the new one down. `lib/motion.ts`'s `pageTransitionVariants`
  is `opacity` + a 4px nudge, `cardEntranceVariants` is `y: 4`.

### Auth proxy (server-side)

Server Actions can't read an `Authorization` header the way a Route Handler
can, so the FIRST API proxy uses a Firebase session cookie instead:

- `lib/firebase/admin.ts` — initializes the Firebase **Admin** SDK from a
  service-account credential (`FIREBASE_ADMIN_*` env vars — server-only,
  never `NEXT_PUBLIC_`). Exports `getAdminAuth()` (`Auth | null` — null when
  unconfigured) and `isFirebaseAdminConfigured()`. Never imported from a
  client component (`"server-only"`-guarded).
- `app/api/auth/session/route.ts` — `POST` exchanges a fresh Firebase ID
  token (minted client-side) for an HttpOnly session cookie (`verifyIdToken`
  → `createSessionCookie`, 5-day expiry); `DELETE` clears it.
- `lib/server/session-cookie.ts` — the shared cookie name/max-age constants
  (kept out of the route file itself, since Next.js route handlers only
  expect HTTP-method exports).
- `lib/server/require-user.ts` — `requireUser()`: reads + verifies the
  session cookie, returns `{ uid } | null`. Never throws — callers fold
  "not signed in" into the same `ActionResult` error shape every other
  failure already uses (`code: "unauthorized"`).
- `lib/auth.tsx`'s `AuthProvider` calls a `syncServerSession(user)` helper
  every time `onAuthStateChanged` fires (covers password login, Google
  sign-in, and restoring a session on page load) to keep this cookie in
  sync with the client Firebase SDK's auth state, and also awaits it
  explicitly inside `login`/`signup`/the Google sign-in paths before they
  return — so a caller that redirects immediately after doesn't race the
  cookie write and see a spurious "unauthorized" error on the very next
  FIRST API call.
- `lib/server/require-user.ts` also exports `verifyBearerToken(request)` —
  verifies an `Authorization: Bearer <idToken>` header instead of the
  session cookie, returning the full decoded token (uid, email,
  email_verified, custom claims). Used by the P1b API routes below, which
  the client calls directly with a fresh ID token rather than relying on
  the cookie (those calls can happen before a user doc, or even the cookie
  sync, exists yet).

### Scout form schema & reusable form (P2)

- `lib/scout-form/schema.ts` — the forms registry. `ScoutFormSchema` is a
  list of `ScoutFormSection`s (H1 headers — Autonomous/Teleoperated/Endgame/
  General), each either flat `fields` or named `groups` (H2 sub-headers,
  e.g. Teleoperated's Hive/Flower/Garden). A `ScoutFormField` has a `type`
  (`"toggle" | "counter" | "checkbox" | "pick" | "readonly" | "text"`), a
  `label`, and — for the two scored types only — `points` (toggle: awarded
  when on; counter: × the tally) and `phase` (`"auto" | "teleop" |
  "endgame"`, which score subtotal it feeds). `BIOBUZZ_FORM_SCHEMA` is the
  current (and only) registered form, `FORMS` keyed by `formId` with
  `DEFAULT_FORM_ID = "biobuzz"`.
  - `calculateScore(schema, values)` is the single scoring function used
    everywhere (the live Scout Form, CSV import): sums `points` for every
    `toggle`/`counter` field into a `ScoreBreakdown` — the pre-existing
    `{ auto, teleop, endgame, total }` shape (kept as `auto`, not
    `autonomous`, to avoid a rename rippling through every module and stored
    Firestore document that already reads `.score.auto` — see
    `docs/ASSUMPTIONS.md`, P2).
  - `defaultValuesForSchema`, `valuesToScoutEntryFields`,
    `scoutEntryFieldsToValues` convert between a schema's generic
    `FormValues` (`Record<string, boolean | number | string>`) and the
    strongly-typed `ScoutEntryFields` Firestore stores — safe because
    BIOBUZZ's field keys are exactly `ScoutEntryFields`'s own property
    names.
- `components/scout/scout-form.tsx` — `<ScoutForm/>`, the reusable,
  schema-driven form component used by the Match Scout Form page today and
  meant for practice/live/lobby scouting later (P4/P7/P8/P9). Renders a
  fixed "Assigned Match" section (skippable via `hideMatchPicker`) and a
  fixed "Pre-Match" section (Scout Name, always read-only; Team Number, a
  `pick` via `TeamPickerDialog`) ahead of the schema's own sections — those
  two aren't schema fields themselves, since their UI (bracket picker,
  alliance rosters, FIRST API-backed team search) doesn't fit the six
  generic field types. Props: `schema`, `mode` (`'event' | 'practice' |
  'live' | 'lobby'` — informational today, surfaced as `data-scout-form-mode`
  for future use), `activeEvent`, `prefill` (`match`/`teamNumber`/
  `scoutName`/`fields`), `lockedFields` (key names rendered read-only —
  `"match"`, `"teamNumber"`, or any schema field key), `hideMatchPicker`,
  `showSubmitButton`, `layout` (`'page' | 'side-panel'`), `onChange`/
  `onSubmit` (both `(values: ScoutFormValues, score) => void`, where
  `ScoutFormValues = { fields, teamNumber, match, scoutName }`), plus a ref
  handle (`validate`, `getValues`, `reset`). The component never writes to
  Firestore in any mode — event mode (`app/(app)/scout/page.tsx`) supplies
  an `onSubmit` that calls `saveEntry()` + `recomputeForEvent()`; the
  success animation and auto-reset only fire once that resolves, so a
  failed save leaves the form untouched for the parent to handle.
  `FieldToggle`/`CounterControl`/`CheckboxTile` (all pre-existing) gained a
  `disabled` prop to support `lockedFields`.

### Accounts & roles (P1b)

Google sign-in, a server-enforced team-creation lock, and owner/admin
accounts driven by env vars — patching P1's accounts system in place
(nothing from P1's data model changed shape except the two notes above:
`teams` moved off a fixed id, and `users` gained `isOwner`).

- `lib/firebase/admin.ts` also exports `getAdminFirestore()` — Firestore via
  the Admin SDK, used only by the API routes below (bypasses
  `firestore.rules` entirely, by design — these routes *are* the
  authoritative check the rules can't express, e.g. "has anyone already
  created a team").
- `lib/server/owner-admin.ts` — `isOwnerEmail(email)` /
  `isPreconfiguredAdminEmail(email)`, reading the server-only
  `OWNER_EMAILS`/`ADMIN_EMAILS` env vars (comma-separated, compared
  case-insensitively).
- `lib/server/team-settings.ts` — `randomJoinCode()` (moved here from
  `lib/auth.tsx` now that team creation is server-only),
  `getTeamCreationEnabled(db)` (plain read, computing + persisting the
  default the first time), and `getTeamCreationEnabledInTransaction(db,
  txn)` (the transaction-safe read `app/api/team/create` uses, per
  Firestore's reads-before-writes rule).
- `lib/team-enrollment.ts` — the client-side functions that call the API
  routes below with the current user's fresh ID token: `joinTeam`,
  `createTeam`, `fetchTeamCreationEnabled`, `setTeamCreationEnabled`,
  `syncRoles`. Deliberately outside `lib/auth.tsx`'s context (plain
  functions reading `auth.currentUser` directly), matching how
  `lib/team.ts`/`lib/team-members.ts` aren't context-based either.
- `components/auth/team-enrollment.tsx` — `useTeamEnrollment()` (Join/Create
  tab + field state, fetches `teamCreationEnabled` on mount),
  `<TeamEnrollmentFields/>` (the tab/field UI, shared), and
  `<TeamEnrollmentScreen/>` (the full "you're signed in, now join or
  create" screen — used standalone by `/finish-setup` and rendered in
  place of Signup's pre-auth form once a Google sign-in there has no
  profile yet). See P1b-4 for why Signup and Finish Setup share this
  instead of being two separate implementations.
- `components/auth/google-button.tsx` — the glass "Continue with Google"
  button (inline multi-color G mark, no external asset).
- `components/layout/verify-email-banner.tsx` — shown in the app shell only
  for password-auth users (`linkedProviders.includes("password")`) who
  haven't verified; never for Google users (inherently verified) and never
  blocks anything — only owner/admin auto-grants require verification.

**API routes** (all Route Handlers, all using the Admin SDK, all called by
the client with `Authorization: Bearer <idToken>` except the public one):

- `GET /api/public/config` → `{ teamCreationEnabled }`. The *only* way an
  unauthenticated visitor learns this — `teams` and `appSettings` are both
  fully locked down to clients in `firestore.rules`.
- `POST /api/team/create` — body `{ teamNumber, teamName?, name? }`. One
  Firestore transaction: confirms `teamCreationEnabled`, creates the team
  doc (auto id), creates the caller's own user doc as admin, flips
  `teamCreationEnabled` to `false` — all atomically, so two simultaneous
  attempts can't both succeed (the loser's transaction retries against the
  now-`false` flag). Replaces P1's client-side `firstRunSetup()` and
  `/setup` page entirely.
- `POST /api/team/join` — body `{ joinCode, name? }`. Looks up the team by
  `joinCode` (an Admin SDK query, unaffected by rules) and creates the
  caller's own user doc as a non-admin. Not explicitly asked for by P1b —
  added alongside team creation to close the join-code-bypass gap in P1's
  rules (see P1b-2).
- `POST /api/auth/sync-roles` — called right after every sign-in (from
  `lib/auth.tsx`'s `onSignedIn`). Requires `email_verified === true` on the
  token; otherwise a no-op. Grants (never revokes admin; can revoke
  `isOwner` if the email drops out of `OWNER_EMAILS`) `isOwner`/`isAdmin`
  per `OWNER_EMAILS`/`ADMIN_EMAILS`, mirrors the result onto Firebase custom
  claims (`{ owner, admin }`), and — the "owner convenience" case — if a
  verified owner has no profile yet and exactly one team exists, attaches
  them to it automatically, no join code needed. `lib/auth.tsx` force
  -refreshes the ID token (`getIdToken(true)`) whenever this reports
  `changed: true`, so new claims apply immediately rather than waiting for
  the ~1 hour natural refresh.
- `POST /api/admin/team-creation` — body `{ enabled }`. Owner-only, gated on
  the `owner` custom claim read straight off the verified token (no
  Firestore read needed) — backs Admin Panel's "Allow team creation"
  switch.

**Custom claims vs. the Firestore fields** — rules can only ever read the
*caller's own* token claims (`request.auth.token.x`), never another user's;
checking whether the *target* of a write is protected (e.g. "is this doc an
owner's") still has to read that document's own Firestore field
(`resource.data.isOwner`). So claims drive the two places that specifically
need a fast, no-Firestore-read check of the caller (`/api/admin/team-
creation`'s owner gate, and client-side UI like the Admin Panel toggle),
while `firestore.rules` and `usePermissions()` continue to key off the
`users/{uid}` Firestore fields — which is also the only source of truth for
admins promoted through Team Management, since they never get a custom
claim at all. `sync-roles` keeps both in sync for owner/`ADMIN_EMAILS`
grants specifically.

### Owner role editing (FIX2)

FIX1 and P1b locked an owner's row for *everyone*, the owner included, so a sole
owner couldn't edit their own roles. FIX2's matrix (`canEditMember`, mirrored by the
`users/{uid}` update rule):

| Actor | Edits roles of | Changes the admin flag of |
|---|---|---|
| Owner | their own row + every non-owner member | any non-owner member; never their own |
| Admin (not owner) | any non-owner member, themself included | any non-owner member; never their own |
| Everyone else | nobody | nobody |

An owner's row is editable only by that owner (a second owner included); nobody writes
`isOwner` from a client or moves a member off the team (`teamId` is immutable); an
owner's `isAdmin` must stay `true`. **Rules:** `isOwner()` = the `owner` custom claim
*or* the caller's own doc `isOwner == true`, and `canManageMembers()` = `isAdmin() ||
isOwner()`, so a missing or stale token can't lock the owner out. **UI:**
`components/team/member-row.tsx` always shows an Edit button — disabled, with a
`HoverTip` reason, when the viewer can't edit that row; the editor
(`member-editor-dialog.tsx`) shows an owner's Admin switch locked on with a lock icon
and the tooltip "Owner access can't be removed.". **Unverified owner email:**
`POST /api/auth/sync-roles` returns `ownerPendingVerification` (the email matches
`OWNER_EMAILS` but isn't verified; nothing is granted); `useAuth()` exposes it plus
`recheckOwnerAccess()`, and `components/layout/verify-email-banner.tsx` says "Verify your
email to activate owner access." with Resend and "I've verified — refresh". Role/admin
changes keep writing their `edit-member-roles` audit entry in the same batch.

### Accuracy engine, difficulty, seasons & the match library (P3)

Shared foundations for every practice-scouting feature — no scout-facing
practice UI exists yet (that's P4); this is the data layer and admin
tooling it'll be built on.

- `lib/accuracy/engine.ts` — the one accuracy module.
  `computeAllianceAccuracy({ robotScores, penaltyPoints, officialScore })`
  is pure (no entry-lookup — the caller already knows which robots'
  scores to use) and returns a **0-100** `accuracy`, `scoutedTotal`,
  `difference` (signed: `scoutedTotal - officialScore`). `getStatus(accuracy)`
  buckets into 4 tiers (Mentor Intervention/Student Intervention/Good/
  Excellent — red/orange/cyan/lime); `getPercentColor(accuracy)` is a
  simpler, differently-banded 4-color scale (red/orange/yellow/green) for
  contexts that just want shading, not the status wording. Both round to
  the nearest integer first, and return complete literal Tailwind class
  names (not built with template strings) so the compiler picks them up —
  same convention as `lib/roles.ts`. `rankWithTies(items, valueFn)` ranks
  descending (higher = better), ties share a rank with the next rank
  skipping (1, 2, 2, 4), and items with no value always sort last with
  `rank: null`.
  `lib/analytics/accuracy.ts`'s existing `computeAllianceAccuracy` (the one
  everything in Match Analytics already calls) is now a thin wrapper:
  it still does its own entry-lookup and still returns its own
  `needs-robots`/`awaiting-results`/`not-applicable` states (concepts the
  generic engine doesn't have), but delegates the actual math to the new
  engine. Unchanged signature, unchanged 0-1 `AccuracyResult.value` scale,
  unchanged behavior for every existing caller — see P3-1 for why the new
  engine's scale differs instead of the old one being changed to match.
- `lib/difficulty.ts` — `getDifficulty(officialAllianceScore)`: easy ≤ 40,
  medium 41-79, hard ≥ 80 (`DIFFICULTY_THRESHOLDS`), computed per alliance.
- `lib/seasons.ts` — `SEASONS` (today: just `biobuzz`, `apiSeason: 2026` —
  see P3-2), `getSeason(id)`, `getEnabledSeasons()`.
- `lib/match-library.ts` — `importLibraryEvent(seasonId, eventCode)` fetches
  every Practice/Qualification/Playoff match for an event (via the existing
  `lib/ftc/actions.ts`), skips matches without posted scores or without
  exactly 2 teams per alliance, and upserts one `libraryMatches` doc per
  scored match. Doubles as the "refresh scores" action (re-running it is
  exactly "re-fetch and update what changed" — see P3-3). Also:
  `useLibraryMatches(eventCode)` (realtime), `setLibraryMatchVideo(id,
  video)`, `parseVideoCsv`/`importVideoCsv` (bulk `matchKey,url,startSec,
  endSec` import, reusing `lib/analytics/csv.ts`'s RFC4180 parser).
  `useLibraryMatchesBySeason(seasonId)` (P4, realtime, every match in a
  season regardless of event — what Match Select and the session/results
  screens read, vs. `useLibraryMatches`'s per-event admin view).
- `components/admin/match-library-panel.tsx` — the Admin Panel > Match
  Library section: season + event code → Import/Refresh, a table of the
  viewed event's matches (score, difficulty pill, inline-editable video
  fields, a missing-video indicator), the bulk CSV button, and the "Use
  placeholder video for testing" switch (`teams/{teamId}.
  usePlaceholderVideo`, via `lib/team.ts`'s `setUsePlaceholderVideo`).
- `components/video/` — `VideoPlayerHandle` (`play`/`pause`/`seek`/
  `getCurrentTime`) is the one interface both players implement.
  `<MockVideoPlayer/>` simulates a ~2:30 timeline with
  `requestAnimationFrame`, clearly labeled "Placeholder video".
  `<YouTubePlayer/>` loads the real YouTube IFrame API (`youtube.ts`'s
  `loadYouTubeIframeAPI()`, memoized across instances) and honors
  `startSec`/`endSec`, with a polling safety net since the `end` playerVar
  alone isn't always reliable right at the boundary. `<VideoPlayer/>` picks
  between them (or an "unavailable" notice) based on whether the match has
  a `video` and whether the team's placeholder setting is on — matching
  "when off, matches without video are unavailable in practice flows."
  Both support `lockPause` (Competitive mode, P4): YouTube hides native
  controls, disables its keyboard shortcuts (`disablekb`), and immediately
  resumes if paused anyway (no official "disable pause" API); Mock just
  no-ops `pause()`.
- `lib/practice-sessions.ts` — `PracticeSession` type (`id` is the doc id,
  attached client-side, not stored), `generateSessionId(kind)` (pure,
  unit-tested), `claimSessionId(teamId, uid, kind)` (the actual
  Firestore-transaction uniqueness guarantee — see P3-4),
  `updatePracticeSession`/`getPracticeSession`/`usePracticeSession`, and
  `getCategory(entryOrSession)` (shared with `ScoutEntry` — see P3-5). P4
  additions: `useTeamPracticeSessions(teamId)` (realtime, every `solo`
  session for the team — what Match Select's status computation reads),
  `useOwnPausedSession(teamId, uid)` (realtime, the caller's own paused
  session if any — the landing screen's Resume/conflict banner), `hasCompletedAttemptBefore(teamId, uid, libraryMatchId, alliance)` (one-shot,
  backs the "Repeat Attempt" auto-flag), `deletePracticeSession(sessionId)`
  (backs Change Match/Cancel/End Session/Discard — see P4-2 for the rules
  change this needed).
- `lib/platform.ts` — `detectPlatform()`, lifted out of `lib/auth.tsx` so
  `PracticeSession.platform` (P4) and the auth flow share one user-agent
  check instead of duplicating it.
- `lib/practice-flags.ts` (P4) — `evaluatePracticeSessionFlags({ entries,
  mode, videoProgressAtFinish, priorCompletedAttempt })`: reuses
  `lib/analytics/flags.ts`'s `evaluateAutoFlagRuleIds` for the
  scoring-based auto-flags, and separately flags "Repeat Attempt" and
  "Finished Early" (`videoProgressAtFinish` below
  `PRACTICE_FLAG_THRESHOLDS.FINISHED_EARLY_MIN_PROGRESS`, 0.8). Flags are
  computed once, at Finish Session, and stored on the session doc
  (`dismissed: false`) — no scout-facing UI reads/dismisses them yet (P5).
- `lib/practice-match-rows.ts` (P4) — `buildMatchRows(matches, sessions,
  uid, difficulty)`: one `MatchRow` per (library match, alliance) matching
  `difficulty`, with a team-wide Fresh/Opened/Scouted `status` and a
  `byYou` flag (see P4-4). `sortMatchRows`/`pickRandomMatchRow` (Fresh
  before Opened before Scouted, both for display order and for
  "Randomize"'s fallback preference).
- `components/practice/` (P4) — the Practice Scouting screens, each a
  controlled, stateless-as-possible step driven by
  `app/(app)/practice-scouting/page.tsx`: `SeasonSelect`, `ModeSelect`,
  `DifficultySelect`, `MatchSelect` (reads `useLibraryMatchesBySeason` +
  `useTeamPracticeSessions` itself), `ResumeBanner`, `SessionScreen` (owns
  the video/form/Break-Menu flow and all entry-saving — see P4-1),
  `ResultsScreen`, `BreakMenu`, `ChipSummary` (the `BIOBUZZ · Trial ·
  Medium`-style breadcrumb reused across steps).
- `app/(app)/practice-scouting/page.tsx` (P4) — the step-state-machine
  orchestrator: `season → mode → difficulty → match-select → session →
  results`, owns `claimAndStart()` (fills in the session doc after
  `claimSessionId`, see the `practiceSessions` schema note above), and the
  landing-screen paused-session conflict check (P4-5). Replaces the
  pre-P4 sandbox placeholder that wrote nothing anywhere.
- `ScoutEntry.source`/`.mode` (`lib/scout-entries.ts`) widened from P1's
  `"event"`/`null`-only to the full `ScoutEntrySource`/`ScoutEntryMode`
  unions; `sessionId`/`libraryMatchId` added. `saveEntry()`'s input gained
  these as optional fields, defaulting to today's exact behavior
  (`source: "event", mode: null, sessionId: null, libraryMatchId: null`)
  so the existing Scout Form call site needed no changes.
  `getEntriesForEvent`/`subscribeEntries` now also filter `source ==
  "event"` (P4-3 — a latent leak this prompt fixed before it could ever
  trigger). `getEntriesForSession(teamId, sessionId)` (P4) is what
  `SessionScreen`/`ResultsScreen` read back the two just-saved robot
  entries from, once both exist, to compute alliance accuracy.
- `lib/scout-entries.ts`'s `useTeamScoutEntries(teamId)` (P5) — realtime,
  every entry for the team regardless of source/mode, unlike
  `subscribeEntries`'s one-event/"event"-only scope. What the Scout Stats
  engine (below) reads; team size is small enough that one unfiltered
  subscription is simpler than one per category.
- `lib/match-library.ts`'s `useAllLibraryMatches()` (P5) — realtime, every
  library match regardless of season/event, for labeling a practice
  session's match ("Q12") when a scout's sessions can span more than one
  season/event.
- `lib/accuracy/engine.ts`'s `AccuracyStatusInfo` gained a `guidance` field
  (P5) — the paragraph + suggested next step ("Pair this scout with a
  mentor...") shown under a scout's status in Scout Accuracy's View
  Details, kept on the one shared status-tier config rather than
  duplicated wherever status is shown.

### Scout Accuracy, My Scouting & the stats engine (P5)

One computation module backs both pages, so neither duplicates the other's
math — see the Acceptance Checklist's own "don't duplicate logic" ask.

- `lib/scout-stats/types.ts` — the shared shapes: `ScoutCategory`
  (`"trial" | "competitive" | "real-event"`), `RankingBasisId`
  (`"preserve" | "role" | "event" | "both"` — see below),
  `RealEventCalculationScope`, `ScoutLeaderboardRow`, `ScoutCategoryDetail`
  (View Details' full data), `ScoutStatsSummary`.
- `lib/scout-stats/real-event-accuracy.ts` — the one tunable, pure,
  unit-tested file the prompt asks for the Real Event math to live in.
  `REAL_EVENT_ACCURACY_CONFIG` holds the named constants (`PLAIN_PRIOR_K:
  2`, `MODE_PRIOR_K: 4`, `FALLBACK_PRIOR: 0.75`). `computeTeamAveragePrior`
  is the plain mean of every real-event observation (0-1) across the team.
  `computeRealEventEstimates(observations, variant, teamAveragePrior,
  modePriors)` runs the two-pass algorithm: pass 1 computes every scout's
  *unweighted* prior-blended estimate (ignoring partners — used only to
  judge partner quality); pass 2 re-weights each observation by
  `0.5 + 0.5 * partnerPass1Estimate` and blends with the prior (team
  average for the plain variant; the scout's own practice-mode average,
  `modePriors`, with `K=4`, for the Trial/Competitive variants — falling
  back to the team average when a scout has no practice data in that
  mode). A scout with zero observations gets `null` ("?"), never the bare
  prior.
- `lib/scout-stats/engine.ts` — the data-assembly + per-category math,
  pure given already-fetched Firestore data (fully unit-tested without an
  emulator). `buildRealEventObservations(entries, eventCode)` turns
  `scoutEntries` into `RealEventObservation[]` **without any FIRST API
  roster lookup**: two entries in the same match that share the exact same
  `accuracy.value` are alliance partners *by construction*
  (`lib/analytics/recompute.ts` computes and stores one alliance-level
  value per match, written onto every entry for that match) — see
  docs/ASSUMPTIONS.md (P5) for why this was chosen over re-fetching
  official rosters. `computePracticeAverageAccuracy(sessions, uid, mode)`
  is a scout's own Trial/Competitive average (0-100) — both a leaderboard
  number and the Real Event mode-variant's prior. `computeScoutStats(input)`
  is the one entry point: given `members`/`sessions`/`entries`/
  `libraryMatchesById`/`attendance` plus the current `category`/
  `roleFilter`/`eventFilter`/`rankingBasis`/`realEventScope`, it returns
  `{ rows, summary, detailsByUid }`. Ranking basis is the one subtlety:
  role/event filters always control which rows are *visible*, but
  `rankingBasis` separately controls which *population* the rank number is
  computed over (`"preserve"` ranks the whole team so a visible scout keeps
  their true team-wide rank even when the table is narrowed; `"role"`/
  `"event"`/`"both"` re-rank within just that filtered subset) — accuracy
  values themselves never change, only which rank number a scout shows.
- `lib/scout-stats/use-scout-stats.ts` — the realtime wiring:
  `useScoutStatsSources(teamId)` combines `useTeamMembers`,
  `useTeamPracticeSessions`, `useTeamScoutEntries`, `useAllLibraryMatches`,
  `useEventAttendance` into one `loaded` flag + the inputs
  `computeScoutStats` needs; `useRealEventOptions(entries)` is the Real
  Event Calculation dropdown's per-event options (distinct event codes
  from the team's own `scoutEntries`, most-recently-scouted first — see
  docs/ASSUMPTIONS.md, P5, for why this reads entries instead of the P6
  Assignments page); `useScoutStats(options)` memoizes
  `computeScoutStats` against a live `useScoutStatsSources` subscription.
- `lib/scout-stats/actions.ts` — the three admin-gated mutations, each
  logging to `auditLog`: `dismissSessionFlag` (matches by the flag's
  `type`, not array index, since the caller only ever sees the *active*
  subset), `setSessionExcluded` (Exclude/Include), and
  `hardResetScoutData` (deletes every completed session, and each
  session's own `scoutEntries` via its `entryIds`, for one scout+practice
  category — Real Event data is never bulk-deletable this way, since it's
  the team's own match records, not personal practice history).
- `lib/audit-log.ts` / `lib/event-attendance.ts` — the two new
  collections' thin Firestore wrappers (see their collection docs above).
- `components/scout-stats/` — `CategoryTabs`, `SummaryStats`, `FiltersBar`
  (role-filter chips, event-filter chips, the ranking-basis `<Select/>`,
  and — only when `category === "real-event"` — the Calculation
  `<Select/>`), `LeaderboardTable` (client-side re-sortable by any column;
  the *rows themselves*, including rank, come pre-computed from the
  engine), `ScoutDetailsDialog` (View Details — practice sessions'
  Dismiss/Exclude/Hard Reset only render when `canManage` is true; Real
  Event's own recent entries are always read-only, linking to Match
  Analytics instead), `MyScoutingCard`, `PlatformBadge`.
- `app/(app)/scout-accuracy/page.tsx` (rewritten) and
  `app/(app)/my-scouting/page.tsx` (new) — both call `useScoutStats`/
  `computeScoutStats` directly; My Scouting computes all three categories
  at once (one `useScoutStatsSources` call, three pure `computeScoutStats`
  calls) for its three cards, sharing the same filter/ranking-basis/
  Calculation state so a card's rank matches what Scout Accuracy would
  show under the same settings.

### The scheduler & Assignments (P6)

- `lib/scheduler/types.ts` — `MatchInput` (one match's teams, generic
  across sources — a `null` alliance means "excluded for this source," not
  "unknown"), `SlotId`/`SLOT_IDS` (`red1`/`red2`/`blue1`/`blue2`, in that
  fixed display order), `RotationPattern`, `ScheduleSettings`,
  `ScheduleSlot`, `ScheduleResult` (`{ slots, counts, fair, warning }`).
- `lib/scheduler/rng.ts` — `mulberry32(seed)` (a tiny seeded PRNG) and
  `seededShuffle(items, rng)`, so the whole scheduler is deterministic
  given a seed; `randomSeed()` is what the UI's Randomize/Re-roll buttons
  call to get a fresh one.
- `lib/scheduler/ranges.ts` — `parseMatchRanges("P12-14, Q17-18")` (chip
  text → `MatchRange[]`, reporting unrecognized chips as errors instead of
  dropping them), `filterMatchesByRanges`/`filterMatchesByCategories`
  (warns about range bounds with no corresponding match, e.g. `Q20` when
  only 16 quals exist).
- `lib/scheduler/sources.ts` — `ftcMatchesToInputs(matches)` (Event
  schedule/Live — skips matches without exactly 2 teams per alliance, same
  convention as `lib/match-library.ts`'s import) and
  `libraryMatchesToInputs(matches, difficulty)` (Practice library — only
  the alliance(s) matching the chosen difficulty get slots at all).
- `lib/scheduler/scheduler.ts` — `generateSchedule(matches, settings)`, the
  one pure, unit-tested entry point. Builds each match's batch of
  candidate scouts per `pattern`:
  - **Rotate Each Match**: a fresh greedy pick every match (fewest
    assignments so far, soft-avoiding anyone in *both* of the last 2
    matches — i.e. about to hit their 3rd in a row).
  - **Custom Interval**/**Constant Same Order**: both built from
    `cyclicWindow(order, pickIndex, size)` — `size` consecutive scouts
    from one seeded-shuffled cyclic order, sliding by `size` each pick
    (one pick per match for Constant Same Order, one pick per `x`-match
    interval for Custom Interval). This replaced an earlier
    fixed-disjoint-group-partition design — see P6-2 for why a sliding
    window is what actually achieves the fairness target.
  - Whichever batch is chosen, `assignMatch` fills that match's slots from
    it, "floating" in whoever has the fewest assignments overall if the
    batch runs short, and never double-books the same scout across two
    slots in the same match (a human can't watch two robots at once — a
    pool smaller than 4 leaves some slots `null` rather than reusing
    someone).
  - **Prioritized teams**, when set, aren't merely filled *first* — every
    *other* slot is skipped outright, never attempted (see P6-1).
  - `fair` is `max(counts) - min(counts) <= 1`; `warning` explains it when
    not. Exact ±1 is always achievable for Rotate Each Match and Constant
    Same Order; Custom Interval's achievable bound is the interval size
    (see P6-2) — the prompt's own "show counts and warn" escape hatch
    exists for exactly this case.
- `lib/assignments.ts` — `AssignmentMatchSource`, `AssignmentSettings`,
  `AssignmentVersion`, `AssignmentsDoc` (mirrors the Firestore shape
  above). `useAssignments(teamId, eventCode)` (realtime),
  `publishAssignments` (writes `current`, demotes the old `current` to
  `previous`), `undoAssignments` (swaps them back, one level only),
  `swapAssignmentSlot` (one manual cell edit — read-modify-write on the
  whole `slots` array, since Firestore has no indexed-array-element
  update), and the pure `evaluateSlotSwap(version, ...)` (the
  double-booking/fairness warnings a manual swap shows *before* writing —
  it warns, per the prompt, rather than blocking the edit).
- `components/assignments/` — `MemberMultiSelect` (checkbox roster +
  select-all/none + role quick-select; shared by Attendance and the
  Randomize modal's Scouts picker), `RandomizeModal` (ranges/categories,
  pattern + interval, scouts, prioritized teams → calls `generateSchedule`
  and hands the result back as an unpublished draft), `ScheduleGrid`
  (matches × 4 slot columns, per-scout totals; click-to-swap only when
  given an `onSwap` — omitted for the read-only view non-admins/a draft
  before publish get).
- `app/(app)/assignments/page.tsx` — the orchestrator: event selector
  (defaults to the team's active event — see `useActiveEvent()`),
  attendance (admin-only edit, `setEventAttendance`), match source tabs
  (Event schedule/Practice library/Live — see P6-5 for why Live reuses
  Event schedule's data), the Randomize → draft preview → Save/Publish
  flow, and Undo (shown whenever `previous` exists). Non-admins see a
  read-only "your assignments" list instead of any of the above.
- **Integrations**: `app/(app)/scout/page.tsx` reads the signed-in scout's
  `assignments` slots for the active event, finds the first one (in
  match-type/number order, via `lib/analytics/game-schema.ts`'s
  `matchSortValue`) without a matching submitted `scoutEntry` yet, and
  shows it as a "Next assignment" banner with a **Load this assignment**
  button that fills `ScoutForm`'s `prefill.match`/`prefill.teamNumber` (a
  synthetic `FtcMatch`, same convention as the Match Picker's own manual
  -entry mode — see P6-6). `app/(app)/my-scouting/page.tsx` shows "My
  upcoming assignments" for the active event (Dashboard itself stays
  untouched placeholder content — see P6-7).
  `app/(app)/people/page.tsx` shows an "Attending" badge per member, from
  the active event's `eventAttendance` doc.

### Live Practice Mode (P7)

- `lib/live/config.ts` — `LIVE_CONFIG`: presence heartbeat/stale timings,
  the "both robots live within N minutes" notify window, the client-side
  score-poll interval. One place to retune any of these.
- `lib/live/stream.ts` — `parseStreamUrl`/`embedUrlFor` (YouTube
  watch/live/`youtu.be` + Twitch channel URLs → an embeddable iframe URL).
- `lib/live/matching.ts` — `matchEventFromText(text, events)`: exact
  event-code match is confident; otherwise a word-overlap score against
  each event's name, confident at `>= 0.6`. Powers the Link step's
  auto-detected event with a manual-override fallback for anything it
  doesn't confidently resolve (see docs/ASSUMPTIONS.md, P7-2).
- `lib/live/join-rules.ts` — `determineJoinOption(covered, redTeams,
  blueTeams)`: `"forced"` (the other robot on an already-half-covered
  alliance), `"choice"` (pick any of the 4, with a fully-covered alliance's
  tiles disabled), or `"none"` (all 4 covered). See docs/ASSUMPTIONS.md
  (P7-4) for the both-alliances-partially-covered edge case.
- `lib/live/notify.ts` — `isAllianceReadyToNotify(entries, windowMinutes)`:
  both alliance robots submitted, within the configured window of each
  other.
- `lib/live/scoring.ts` — `resolveLiveAllianceScoring(match, alliance,
  entries)`: once official FIRST API data exists for the match, computes
  both entries' accuracy via `computeAllianceAccuracy` (the same engine
  Real Event scoring uses — `lib/analytics/accuracy.ts`) and re-evaluates
  auto-flags via `evaluateAutoFlagRuleIds`, preserving any flag a scout
  already dismissed. See docs/ASSUMPTIONS.md (P7-5) for the
  `sameTeamEntries: []` scope simplification.
- `lib/live/pending.ts` — `computePendingLiveRobots(sessions, uid)`: this
  scout's own alliance robots left uncovered by anyone, across every live
  match they've taken part in, surfaced as "Pending robots" on the Practice
  Scouting landing page.
- `lib/live/resolve-pending.ts` — `resolvePendingLiveMatches(db, messaging,
  uid?)`: the one Admin-SDK function both the cron route and the
  client-fallback route call. Groups completed-but-unscored sessions by
  `(teamId, eventCode, matchType, matchNumber, alliance)`, fetches official
  match data once per `(eventCode, matchType)` per run via
  `fetchMatchesForEventInternal`, resolves and batch-writes both sessions +
  entries, then sends push via the Admin SDK's `messaging.sendEachForMulticast`
  — idempotent by construction (see docs/ASSUMPTIONS.md, P7-6).
- `lib/ftc/matches-internal.ts` — `fetchMatchesForEventInternal(eventCode,
  matchType, season?)`, extracted out of `lib/ftc/actions.ts`'s Server
  Action so server contexts with no browser session (the cron route;
  the client-fallback route, which must look up a *different* scope than
  "the current session's own cookie") can reuse the identical FIRST API
  fetch+merge logic. See docs/ASSUMPTIONS.md (P7-9).
- `lib/live-presence.ts` — `liveMatchKey`, `upsertPresence`/`removePresence`,
  `useLiveMatchScouts(matchKey)` (one match), `useTeamActiveLiveScouts(teamId)`
  (collection-group query across every match's `scouts` subcollection,
  filtered client-side to non-stale docs).
- `lib/notifications.ts` — `requestAndRegisterPush(uid)` (Notification
  permission → FCM service-worker registration → token saved onto
  `users/{uid}.fcmTokens`), `isLikelyUnsupportedIOSBrowser()`,
  `onForegroundLiveScorePush(callback)`. See docs/ASSUMPTIONS.md for what's
  unverifiable here (P7-10).
- `app/firebase-messaging-sw.js/route.ts` — the FCM service worker, served
  from a Route Handler (not a static `public/` file) so it can read
  `NEXT_PUBLIC_FIREBASE_*` env vars at request time.
- `app/api/live/detect-event/route.ts` — given a stream URL, fetches
  YouTube oEmbed title/author (Twitch: channel name only — low confidence,
  see P7-2) and runs it through `matchEventFromText` against the season's
  events.
- `app/api/cron/poll-live-scores/route.ts` — `CRON_SECRET`-bearer-gated,
  sweeps the whole team via `resolvePendingLiveMatches`. `vercel.json`
  schedules it daily (Hobby-plan cron is daily-only); a real-time-ish cadence
  needs an external scheduler — see docs/DEPLOYMENT.md.
- `app/api/live/check-scores/route.ts` — session-authed, scoped to the
  signed-in user's own sessions, with a best-effort in-memory rate limiter
  (see docs/ASSUMPTIONS.md, P7-7). Called from the global
  `ScoresReadyWatcher` (while the scout has any pending live session) and,
  redundantly but harmlessly, from `LiveSessionScreen` right after
  submitting and from `LiveResultsScreen` while open.
- `components/practice/live/` — `LiveFlow` (the Link → Event → Match →
  Robot → Session → Results step machine; also handles "resume a pending
  robot" and "view results" entry points via the shared `ResumePendingRobot`
  type — see docs/ASSUMPTIONS.md, P7-8), `LiveSessionScreen` (stream embed
  + `<ScoutForm mode="live" layout="side-panel">`, presence heartbeat),
  `LiveResultsScreen` (accuracy once scored, else a "waiting" panel with
  push opt-in), `PresencePanel` ("join the scout who's live"),
  `PendingRobotsList`.
- `components/layout/live-match-pill.tsx` — a dismissible top-of-app pill
  wherever exactly one team scout is live on some match and needs a
  partner; dismissal is per-session only, not persisted.
- `components/layout/scores-ready-watcher.tsx` — mounted once in
  `app/(app)/layout.tsx`: runs the client-fallback poll while any of the
  signed-in scout's own live sessions are still waiting on scores, listens
  for foreground FCM push, and shows a "Scores are available" popup either
  way, routing to Practice Scouting on "Look."
- `components/practice/difficulty-select.tsx` — the "Live" tile is now
  live (`onSelectLive`); "Live Practice Lobby" stays a disabled placeholder
  (that's P8).

### Live Practice Lobby (P8)

- `lib/lobby/config.ts` — `LOBBY_CONFIG`: heartbeat/stale timings (player,
  host), the lobby expiry window, the post-video results grace period, the
  start countdown length.
- `lib/lobby/match-select.ts` — `sortMatchesByDifficultyTarget(matches,
  target)` (the host's "Pick Match" ordering — both alliances matching the
  target first, then one matching per the spec's own tiebreak order, then
  — a gap the spec's three tiers don't cover — anything matching neither,
  last; see docs/ASSUMPTIONS.md, P8), `pickRandomLobbyMatch(matches)` (the
  default "random match, any difficulty").
- `lib/lobby/pairing.ts` — `assignPairs(playerUids, allianceTeams, rng)`:
  seeded-shuffle (reusing `lib/scheduler/rng.ts`'s `mulberry32`/
  `seededShuffle`), chunk into pairs, alliances alternate red/blue/red/
  blue... across pairs in shuffled order, and each pair's two team numbers
  are randomly split between its two players. Pure and unit-tested.
- `lib/lobby/scoring.ts` — `resolveLobbyPairScoring(match, alliance,
  entries, mode, priorCompletedAttempt)`: pure, reuses
  `lib/accuracy/engine.ts`'s `computeAllianceAccuracy` (same 0-100 scale as
  solo mode, since a library match's official score is always already
  known — never the richer "awaiting results" case live mode needs) and
  `evaluatePracticeSessionFlags` (Zero Entries / Unrealistic Entry / Repeat
  Attempt only — "Finished Early" never applies, see docs/ASSUMPTIONS.md,
  P8).
- `lib/lobby/resolve-results.ts` — `resolveLobbyResults(db, lobbyId)`: the
  Admin-SDK core behind `app/api/lobby/resolve-results`. Groups the
  lobby's completed sessions by `pairId` (from `lobby.pairing`), resolves
  each complete pair via `resolveLobbyPairScoring`, and batch-writes both
  of that pair's sessions — this is Admin-SDK, not a client write, because
  a pair's two sessions belong to two different players and
  firestore.rules never lets one teammate write another's session (see
  docs/ASSUMPTIONS.md, P8). Idempotent via the lobby's own `status`
  (`"results"`/`"closed"` short-circuits immediately).
- `lib/lobby.ts` — the client data layer: `LobbyDoc`/`LobbyPlayer` types,
  `claimLobbyId`, `updateLobby` (host-only writes), `useLobby`/
  `useLobbyPlayers` (realtime), `joinLobby`/`heartbeatPlayer`/
  `heartbeatHost`/`markPlayerSubmitted`/`resetPlayerSubmitted`/
  `leaveLobbyPlayer`, `isPlayerActive`/`isHostActive` (client-derived
  staleness, same convention as P7's live presence), `useLobbySessions`
  (every `practiceSessions` doc for one lobby), and `useMyActiveLobbyId`
  (a `players` collection-group query — needs the composite index in
  `firestore.indexes.json` — for "you're still in a lobby" reconnect).
- `app/api/lobby/resolve-results/route.ts` — session-authed (no
  `CRON_SECRET` route like P7 needs one: a library match's official score
  is already known, so there's nothing to wait on or sweep for). Called by
  whichever open client first notices every scouting player has submitted,
  by the host's "End Scouting," or after the post-video grace period.
- `components/practice/lobby/` — `LobbyFlow` (the orchestrator: "Host a
  Lobby" or an already-known `lobbyId`, then renders whichever screen
  matches `lobby.status`; also runs the one shared heartbeat loop for the
  whole time a lobby room is open), `LobbyWaitingRoom` (join code, match
  selection, host settings, player list, Start), `LobbySessionScreen`
  (countdown, video + `<ScoutForm mode="lobby" layout="side-panel">` for
  paired players, a spectator view for the host-not-scouting/unpaired
  case, auto-resolve trigger), `LobbyResultsScreen` (winner spotlight,
  leaderboard, did-not-finish list, per-pair breakdown dialog, host's Play
  Again/Close Lobby).
- `components/practice/difficulty-select.tsx` — the "Live Practice Lobby"
  tile is now live (`onSelectLobby`).
- `app/(app)/practice-scouting/page.tsx` — the landing step gained a "Join
  Lobby" code input and a "You're still in a Live Practice Lobby — Rejoin"
  banner (from `useMyActiveLobbyId`); the Difficulty screen's Lobby tile
  routes to a new `"lobby"` step rendering `<LobbyFlow/>`.

### Match Analytics practice data & Admin Panel session tools (P9)

No new Firestore collections or rules — every P9 write lands on
`scoutEntries`/`practiceSessions`/`auditLog` through the exact admin-only
paths P1–P8 already wrote rules and tests for (`isAdmin()` can already
update any team session regardless of status, and update/create any
team's scout entries). See docs/ASSUMPTIONS.md (P9) for the write-up of why
this needed no new rules.

- `lib/analytics/game-schema.ts` — `withPracticeColumns(schema)`: inserts a
  Session ID column and a source/mode badge column right after the sticky
  Scout column, for Match Analytics' "Practice Scouted Matches" toggle. The
  real-event schema itself is never mutated. Two new `ColumnType`s support
  this generically: `"text"` (plain muted text) and `"badge"` (a
  `getBadgeClassName`-colored pill) — both rendered in
  `components/analytics/data-table.tsx`.
- `lib/scout-entries.ts` — `getEventEntries` (P9): a documented, literal
  alias for `getEntriesForEvent` — the canonical name every analytics page
  should call for "this event's real data, practice excluded." See
  docs/ASSUMPTIONS.md (P9) for why this is a rename-in-waiting rather than
  a multi-page refactor (every other Analytics page still runs on
  `lib/mock-data.ts`, not Firestore, as of P9).
- `lib/analytics/recompute.ts` — split into `computeEventRescorePlan`
  (pure given one FIRST API fetch — the match/accuracy/flag computation)
  and `applyEventRescorePlan` (the writes); `recomputeForEvent` is now just
  those two calls in sequence, unchanged for existing callers. This is
  what lets the Admin Panel's Rescore tab dry-run preview and its Apply
  step always agree — same plan either way.
- `lib/admin/rescore-sessions.ts` — `buildSessionRescorePlan(sessions,
  entries, libraryMatchesById, liveMatchesByKey, filter)`: the equivalent
  split for solo/lobby/live practice sessions. Reuses `lib/lobby/scoring.ts`'s
  `resolveLobbyPairScoring` for BOTH solo and lobby sessions (it's generic
  over any two same-alliance entries against a `LibraryMatch`, despite the
  name) and `lib/live/scoring.ts`'s `resolveLiveAllianceScoring` for live
  sessions, against freshly-fetched `FtcMatch` data. Every entry's `score`
  is recalculated from its stored `fields` first, via the schema's own
  `calculateScore` — never trusts a possibly-stale stored score.
  `applySessionRescorePlan` batches writes in chunks of 400 and reports
  progress. Pure and unit-tested (`rescore-sessions.test.ts`).
- `lib/admin/backup.ts` — `exportAllDataJson`/`exportEntriesCsv`: plain
  client-side `getDocs` reads across the prompt's named collections (see
  its own doc comment for the exact list and what's deliberately left
  out), downloaded via `lib/download.ts`'s shared `downloadTextFile`
  helper (also now used by Match Analytics' own CSV export). Both log an
  `"export-backup"` audit entry, which is also how "last export" is
  derived — no new field anywhere.
- `lib/audit-log.ts` — `AuditAction` extended with `edit-entry`,
  `rescore-event`, `rescore-sessions`, `refresh-official-scores`,
  `export-backup`; `useAuditLog` is now actually read, by the Audit Log tab.
- `lib/practice-sessions.ts` — `useAllTeamPracticeSessions(teamId)`:
  realtime, every session regardless of `kind`/`status` — what both Match
  Analytics' practice view (session-derived accuracy/exclusion lookups)
  and the Admin Panel's Sessions/Rescore tabs need, unlike
  `useTeamPracticeSessions`/`useTeamLiveSessions`'s one-kind-at-a-time scope.
- `components/analytics/toolbar.tsx` — gained the "Practice Scouted
  Matches" checkbox (`practiceMode`/`onPracticeModeChange`).
- `components/analytics/practice-filters.tsx` — Mode/Source `<Select/>`s
  plus a toggle-chip row for the library's imported events (multi-select,
  empty = all) — shown only under the Practice toggle.
- `components/analytics/config-modal.tsx` — optional `sessionExcluded`/
  `onToggleSessionExclude` props: when set (practice/live rows), the
  Stats Exclusion section exclude/includes the *session* instead of the
  entry, "consistently with P5" per the prompt's own wording, since that's
  what Scout Accuracy's practice averages actually read.
- `app/(app)/analytics/match-scout/page.tsx` — the Practice toggle swaps
  the data source from the active event's `subscribeEntries` to
  `useTeamScoutEntries` filtered to `source !== "event"`, applies the
  Mode/Source/Event filters, and stamps each displayed entry's `accuracy`
  with its owning session's `accuracy` (a shallow, display-only copy —
  never written back) so the existing "Alliance Accuracy"/"Script Status"
  columns need no changes at all. Import CSV and Recalculate Accuracy are
  hidden under the toggle (real-event-specific tools); Export CSV always
  works, via the new shared columns.
- `components/admin/` — `SessionsPanel` (lookup by Session ID or
  browse/filter by scout/kind/mode/flags; a detail dialog with flags,
  session-level exclude, Hard Reset, and per-entry Edit), `EntryEditDialog`
  (reuses the Scout Form's own field components — `CounterControl`/
  `FieldToggle`/`CheckboxTile` — against `getFormSchema(entry.formId)`;
  always recalculates `score` on save; writes a full before/after
  `auditLog` entry, never losing the original values since the log is
  write-once), `RescorePanel` (Real Event Entries and Practice/Live/Lobby
  Sessions sub-tabs, each dry-run-then-confirm, plus a "Refresh official
  scores" shortcut to `importLibraryEvent`), `AuditLogPanel` (filter by
  actor/action/session-or-entry-id, read-only, expandable before/after),
  `BackupsPanel` (the two download buttons + last-export time).
- `app/(app)/admin/page.tsx` — now a `Tabs`-driven shell: Match Library
  (unchanged from P3), Sessions, Rescore, Audit Log, Backups. The
  Owner-only "Allow team creation" toggle stays outside the tabs,
  unchanged.

### Analytics foundation, Team Profile, Team Averages & Rankings (P10)

No new collections, fields, or rules. P10 adds a shared client-side layer that
every Analytics subpage reads, plus three pages. Everything below lives under
`lib/analytics/` and `components/analytics/` unless noted.

**Routes.** `/analytics/team-averages`, `/analytics/rankings`, and
`/analytics/teams/[teamNumber]` (Team Profile — nested under Analytics so
filters carry over; the tab bar keeps "Team Averages" lit for it).
`/analytics/match-scout` was retrofitted onto the same filters. Scout Status,
Match Breakdown, Team Breakdown, and Pick List are still placeholders.

**Mounted once, in the Analytics layout** (`components/analytics/analytics-shell.tsx`,
a client component the server layout renders): `<Suspense>` →
`AnalyticsFilterProvider` → `AnalyticsDataProvider` → tabs + `AnalyticsFilterBar`
+ the page. Next keeps the layout mounted across subpages, so filters and the
subscription persist.

**Filter state — `filters.ts` (pure, tested) + `filter-context.tsx`.**
`AnalyticsFilters = { gameId, events: EventScope, practice, practiceMode,
practiceSource, accuracy }`; `EventScope = {kind:"active"} | {kind:"all"} |
{kind:"custom", codes}`; `accuracy` is `null` (ALL) or a whole percent 1-100.
The **URL is the source of truth**:

| Param | Meaning | Default (omitted) |
|---|---|---|
| `game` | game/season id | `biobuzz` |
| `events` | `all`, or comma-separated event codes | the active events |
| `practice` | `1` = practice/live data | off |
| `mode` / `source` | `trial`\|`competitive` / `practice`\|`live` (only with `practice=1`) | both |
| `acc` | accuracy threshold, 1-100 | ALL |

Pure helpers: `parseFilters`, `serializeFilters`, `filtersToQuery`,
`mergeFilterParams` (keeps non-filter params), `resolveEventCodes(filters,
activeCodes)` (→ codes, or `null` = unrestricted), `resolveSingleEventCode`,
`clampAccuracy`/`sanitizeAccuracyText`/`parseAccuracyText`, `ACCURACY_PRESETS`.
Hooks/components: `useAnalyticsFilters()` → `{ filters, setFilters(patch,
"push"|"replace"), resetFilters, query, singleEvent }`;
`useAnalyticsHref()` and `<AnalyticsLink href params>` (**use these for every
link between Analytics pages** — a bare `<Link>` drops the filters);
`useSingleEventMode()` (a page's request that the Event control be a single
select — Match Scout Analytics uses it).

**Entry selection — `entries.ts` (pure, tested).** `AnalyticsEntry =
ScoutEntry & { allianceAccuracy: number | null /* 0-100 */, isExcluded }`.
`toAnalyticsEntry(entry, session?)` joins accuracy **without recomputing it**:
real-event entries use their stored engine result, practice/live entries their
session's (and take its `accuracy` and exclusion). `isInScope` (Game / Event /
Practice mode+source), `passesAccuracy(entry, threshold)` (compares the
displayed whole percent; `null` threshold = ALL keeps uncomputable entries; a
threshold drops them), and `selectAnalyticsEntries({ entries, sessionsById,
filters, activeEventCodes }, { applyAccuracy = true, includeExcluded = false })`
→ `{ scope, used }`. `scope` is "M" in "N of M entries shown"; `used` is what
pages may use (excluded always dropped unless `includeExcluded`).

**Data layer — `data-context.tsx`.** `AnalyticsDataProvider` holds the one
team-wide `scoutEntries` subscription (plus `practiceSessions` only while
Practice is on, and the library for practice event names), the FIRST-API event
directory, the event options for the filter bar, the shared `selection`, and
the shared `teamStats`. Hooks: `useAnalyticsEntries(filters?, options?)` →
`{ entries, scope, usedCount, scopeCount, loaded, filters, schema }` (no args =
the already-computed shared selection; Match Scout Analytics passes
`{ applyAccuracy: false, includeExcluded: true }`); `useTeamStats()` →
`{ teamStats, teamNames, loaded, schema, entries }`; `useSingleEvent()` →
`{ code, event }`; `useAnalyticsData()` for the extras (`sessionsById`,
`eventOptions`, `activeEvents`, `eventDirectory`, `season`).

**Team stats — `team-stats.ts` (pure, tested, schema-driven).**
`buildTeamStats(entries, schema, { teamNumber?, teamName? })` → `TeamStats`
(`teamNumber`, `teamName`, `entryCount`, `matchesScouted[]`, `avgTotal`,
`medianTotal`, `highTotal`, `lowTotal`, `stdDev` (sample), `consistency` (100 −
coefficient of variation, 0-100), `avgAuto`/`avgTeleop`/`avgEndgame`,
`fieldStats{ key → { avg, high, rate, avgPoints, ... } }`, `incidentRates`,
`elementBreakdown[]`, `avgAccuracy`, `trend`). `buildAllTeamStats` groups by
team. Ranking: `rankTeams(teamStats, metric, minEntries = 2)` →
`RankedTeam[]` (`rank` via `rankWithTies`; teams below `minEntries` are
flagged, listed last, and have `rank: null`), `lowSample(stats, min)`,
`RANK_METRICS`, `metricValue`, `schemaFieldMeta(schema)`, `TREND_RECENT_COUNT`,
`DEFAULT_MIN_ENTRIES`. `ScoutFormField` gained an optional **`element`**
(`lib/scout-form/schema.ts`) that groups points by game element across phases.
`chart.ts` has `niceTicks` (axis ticks).

**FIRST API joins — `use-event-data.ts`.** `useTeamNames(requests)` (team
number → name) and `useEventRankings(requests)` (event code → rankings), both
with a tab-level cache and silent failure. New server action
`getRankingsForEvent(eventCode, season)` in `lib/ftc/actions.ts` (type
`FtcRanking` in `lib/ftc/types.ts`) — unverified against the live API.

**Components.** `filter-bar.tsx` (`AnalyticsFilterBar`, `isRawAnalyticsRoute`),
`event-multiselect.tsx`, `team-table.tsx` (`TeamTable` — virtualized, sticky
header + sticky columns, rows are `AnalyticsLink`s to the profile),
`team-bits.tsx` (`TeamCell`, `InlineBar`, `LowSampleBadge`), `score-chart.tsx`
(SVG line chart), `analytics-link.tsx`, `analytics-shell.tsx`; and
`components/ui/info-tip.tsx` (a hover/focus/tap tooltip on `.glass-overlay`).
`components/analytics/practice-filters.tsx` was removed (the shared bar's
Mode/Source replace it) and `toolbar.tsx` lost its Game/Practice controls.

### Match Breakdown & Team Breakdown (P11)

No new collections, fields, or rules. Both pages read the P10 shared layer
(`AnalyticsDataProvider`, `useAnalyticsEntries`, `useTeamStats`) and the filter
bar; Scout Status is untouched.

**Match Breakdown — `lib/analytics/match-breakdown.ts` (pure, tested).**
`OfficialMatch` (`eventCode`, `matchType`, `matchNumber`, `played`, `red`/`blue`
= `{ teams, score, penaltyPoints }`) with `ftcMatchToOfficial(eventCode, FtcMatch)`
and `libraryMatchToOfficial(LibraryMatch)`.
`buildMatchBreakdowns({ matches, entries, accuracyThreshold, practice })` →
`MatchBreakdown[]` sorted P, Q, F then number then event:
`{ key, match, label, red, blue, robotsScouted, robotsTotal, scouted, winner,
winnerBasis, redFraction }`, each alliance an `AllianceBreakdown` (`teams:
TeamSlot[]`, `scoutedCount`, `visibility: "shown" | "not-scouted" |
"below-accuracy"`, `scoutedTotal`, `accuracy` (engine, 0-100), `official`,
`hiddenReason`). **`entries` must be pre-accuracy-filter** (Game/Event/Practice
scoped, excluded dropped — `useAnalyticsEntries(undefined, { applyAccuracy:
false })`): the threshold is applied here per alliance, and a withheld alliance
comes back with its numbers already stripped. Also `matchKey`, `matchHasTeam`,
and `summarizeEntry(entry, schema)` (counters by game element, toggles, incidents).

**Official matches hook — `lib/analytics/use-event-data.ts`.**
`useEventMatches(requests)` → `{ matches: OfficialMatch[], loading }` (all three
match types per event, 3-minute tab cache, failures cached as empty).
`AnalyticsDataProvider` now also exposes `libraryMatches` (Practice mode's
official matches).

**Team Breakdown — `lib/analytics/team-card.ts` (pure, tested).**
`buildKeyStats(stats, schema)` → `{ counters, rates }` (counters summed by label
across phases, each scored toggle its own rate), `reliabilityLevel`
(`RELIABLE_AT` 90 / `SOME_ISSUES_AT` 75), `reliabilityIncidents`, `sortTeams(teams,
key)` with `TEAM_SORTS`, `teamMatchesSearch`. `TeamStats` (P10) gained
**`reliability`** (share 0-100 of entries with none of the schema's
reliability incidents; null if none flagged), and `ScoutFormField` gained an
optional **`reliability`** flag (BIOBUZZ: died, never started, disabled, froze,
tipped).

**Components** (`components/analytics/`): `alliance-bar.tsx` (`AllianceBar` — the
animated red/blue bar), `match-row.tsx` (`MatchRow` + expandable detail,
`matchRowId`), `phase-bars.tsx` (`PhaseStackedBar`, `PhaseMiniBars`,
`PhaseLegend`, `PHASES`). The phase colors are CSS variables `--phase-auto`,
`--phase-teleop`, `--phase-endgame` in `globals.css` (dataviz categorical slots
1-3, validated on both theme surfaces).

### Pick List (P12)

`/analytics/pick-list` — a shared, realtime board to plan alliance selection.
Collection: **`pickLists/{teamId}_{eventCode}`** (above). Reads the P10 shared
layer (filter bar in single-event mode, `useAnalyticsEntries`, `buildAllTeamStats`)
and the FIRST API hooks.

**`lib/epa` (pure, tested)** — `computeEpa(matches, { passes? })` → `{ epa:
Map<team, number>, matchesPlayed }`; online alliance-rating update (init = average
alliance score / 2; `learningRate(n) = max(0.1, 1/(n+1))`;
`DEFAULT_EPA_PASSES = 2`); `epaMatchesFromOfficial(OfficialMatch[])` (played
Qualification matches in match-number order, scores with awarded penalty points
removed); `rankEpa`.

**`lib/pickLikelihood` (pure, tested; constants in `config.ts`)** —
`pickLikelihood(candidateRank, ourRank, teamCount)` → 0-1 or null; `pickScale`,
`formatPickLikelihood`, `pickLikelihoodColor`, `describePickGap`,
`PICK_ESTIMATE_LABEL`.

**`lib/pick-list/`** — `ops.ts` (`PickOp` = place/remove/move/reset, `applyPickOp`,
`placeOpFromList`, `sanitizePicks`, `MAX_PICKS` 100); `rows.ts`
(`buildPickBoard({ teamNumbers, teamNames, rankings, teamStats, epa,
ourTeamNumber })` → `{ rows, ours, teamCount }` of `PickRow`s; `sortPickRows`,
`PICK_SORTS`, `pickRowMatches`); `permissions.ts` (`canEditPickList`,
`PICK_LIST_EDITOR_ROLES`); `store.ts` (client: `usePickList(teamId, eventCode,
actor)` → `{ list, picked, loaded, edit(op), error }`, `editPickList` — the
transactional read→apply-op→write plus its `edit-pick-list` audit entry, and
`useEpaMode(uid)`, the per-browser EPA setting).

**Permissions & rules.** `usePermissions().can("editPickList")` (admins, or a
primary/secondary role of Lead Strategist, Lead Scout, Team Coach, Drive Team).
`firestore.rules`: `canEditPickList()` + the `pickLists` rules (team-wide read keyed
on the doc id's team prefix; editor-only create/update; no delete) and a carve-out
letting non-admin editors create `edit-pick-list` `auditLog` entries (and only
those). New `AuditAction` `"edit-pick-list"`.

**FIRST API.** `FtcRanking` gained `rankingPoints` (`getRankingsForEvent`);
`use-event-data.ts` gained `useEventTeams`, `useEventRankingsStatus` (rankings +
`loading`); `useSingleEventMode(enabled, includePractice)` /
`useAnalyticsFilters().singleEventInPractice` let a page keep the Event control
single-select even in Practice mode.

**Components** (`components/pick-list/`): `pick-board.tsx` (`PickBoard` — @dnd-kit
two-column board, cards, tabs on phones), `pick-stats.tsx` (`PickStats`,
`EPA_TOOLTIP`), `column-settings.tsx`, `our-team-card.tsx`; plus
`components/ui/hover-tip.tsx` (`HoverTip`, hover/focus/tap tooltip on
`.glass-overlay`). Dependencies added: `@dnd-kit/core`, `@dnd-kit/sortable`,
`@dnd-kit/utilities`.

### Role dashboards (P13)

`/dashboard` shows each role its own set of bite-sized widgets. No new
collections, fields, or rules.

**Registry — `components/dashboard/registry.tsx`.** `dashboardRegistry:
Record<RoleId, DashboardWidget[]>`; `DashboardWidget = { id, title, size:
"small" | "medium" | "wide", render: () => ReactNode }` (`lib/dashboard/types.ts`).
**Adding a widget = one entry here** (plus its component); `render` returns the
widget's element and the widget reads its own data from context. If it needs a
Firestore source the role doesn't load yet, add that source to `ROLE_SOURCES`.
Roles whose feature doesn't exist yet get exactly one "Coming soon" card (an id
ending `-soon`). The registry's structure is unit-tested.

**Provider & hooks — `lib/dashboard/data.tsx`.** `<DashboardProvider role>` holds
every subscription and derived value once. `useDashboard()` → the whole
`DashboardData` (identity, `role`, `ourNumber`; `events`/`event`/`eventStatus`/
`setEventCode`/`timeZone`; `first` `{ loading, error }`, `officialMatches`,
`rankings`, `teams`, `teamNames`, `ourMatches`, `nextMatch`, `ourRanking`,
`record`, `fieldSize`; `allEntries`, `eventEntries`, `usedEntries`, `schema`,
`teamStats`, `ranked`, `ourStats`, `ourScoutedRank`; the optional sources
`members`/`sessions`/`libraryById`/`attendance`+`attendingUids`/`assignments`/
`pickList` each with a `…Loaded` flag; and `scoutStats` — `computeScoutStats` per
category, My Scouting's defaults). **`useOurTeamEvent()`** → the schedule/record/
rank slice plus `lastMatch`. Which Firestore sources are live is decided by
`lib/dashboard/roles.ts`: `DashboardSource` (`members` `sessions` `library`
`attendance` `assignments` `pickList`), `ROLE_SOURCES`, `sourcesFor(role,
isAdmin)`; entries and the FIRST API are always loaded. `resolveViewRole` /
`userRoles` / `isRoleId` pick the role shown (admin preview > the user's saved
choice among their own roles > primary). `lib/dashboard/prefs.ts`
(`useSavedDashboardRole`, per-user localStorage) and `lib/dashboard/admin.ts`
(`useLastBackup` — a narrow `auditLog` query — and `useTeamCreationEnabled`, via
the public config route; both used only by the admin strip).

**Pure logic (tested).** `lib/dashboard/time.ts` — `parseEventTime` (event-local
wall time + the event's timezone → an instant; DST-safe), `tzOffsetMs`,
`formatScheduled`, `formatClock`, `formatCountdown`, `timeAgo`.
`lib/dashboard/schedule.ts` — `buildOurMatches` (`OurMatch`: alliance, partner,
opponents, `startMs`, official scores, `result`), `nextOurMatch`,
`upcomingOurMatches`, `recentOurResults`, `ourRecord`, `formatRecord`,
`matchShareText` (`Q12: Red 85 - Blue 70 (W)`). `lib/dashboard/insights.ts` —
`computeCoverage`, `computeTeamCoverage`, `flaggedEntries`, `countByStatus`,
`assignmentStatus`, `practiceActivity`, `countFlaggedSessions`, `averageAccuracy`,
`phaseAverages`, `nextAssignment` (also used by the Scout Form), `findHiddenGems`
(`HIDDEN_GEM_*`), `strengthBullets` (`STRENGTH_*`), `eventHighlights`.

**Components** (`components/dashboard/`): `widget.tsx` (`Widget` — loading / empty /
error / ready card with a footer detail link; `WidgetBoundary` — render-error
boundary with Retry; `WIDGET_GRID_CLASS`), `shared.tsx` (`Countdown` — always
"Scheduled", `useNow`, `AllianceChip`, `ResultBadge`/`ResultRow`, `TeamLink`/
`teamHref`, `KeyNumber`, `TeamPreviewRow`, `ComingSoonCard`), `header-strip.tsx`
(event + switcher, our rank/record, next match), `role-switcher.tsx` (own roles +
admin "View as role"), `admin-strip.tsx`, and `widgets/` — `match-scout`,
`pit-scout`, `pit-team`, `drive-team`, `lead-scout`, `lead-strategist`,
`team-coach`, `media`, `judge`, plus `schedule-widgets` (`NextMatchWidget`,
`UpcomingMatchesWidget`, `OurResultsWidget`, shared by several roles). A
**smoke harness** (`widgets.smoke.test.tsx`) renders every role's widgets against
rich, loading, and empty fixtures.

**Touched elsewhere.** `OfficialMatch.startTime` (optional; `ftcMatchToOfficial`
fills it); `useEventMatches` / `useEventRankingsStatus` / `useEventTeams` return
`error`; `useAllLibraryMatches(enabled)`; `ReliabilityPill` extracted to
`components/analytics/reliability-pill.tsx`; the Match Scout Form page reads
`?event=` and `?load=next`.

### Changelog & Credits (P14)

Two admin-editable pages that replace the placeholder ones: `/changelog` and
`/credits`, plus a small footer (Credits and Changelog links) on every page.
Data model: "`changelog/{id}`" and "`credits/{teamId}`" above.

**Safe text — `lib/rich-text.ts`.** Admin-written text may use `**bold**`,
`*italic*` (or `_italic_`), and `[label](https://link)`. `parseRichText()` turns
it into a four-node whitelist tree (text / bold / italic / link) and
`components/ui/rich-text.tsx` renders that as **React elements**. No HTML string
is ever produced and `dangerouslySetInnerHTML` is not used, so `<script>` and
`<img onerror=…>` are just escaped characters — there is nothing to sanitize
after the fact. A link becomes a link only if `isSafeHttpsUrl()` accepts it
(canonical `https://`, a host, no credentials, no whitespace or control
characters, at most 2048 chars); `javascript:`, `data:`, `http:`, and `//host`
stay visible, inert text. Links open in a new tab with `rel="noopener noreferrer"`.
The editors also reject (rather than silently save) a `[label](url)` whose URL
isn't https, via `findUnsafeLinks()`. The same `isSafeHttpsUrl()` validates the
credits entry link and image URLs.

**Changelog — `lib/changelog/`.** `index.ts` is pure and tested: ordering
(pinned, then newest date, then publish time, then version), filter + search
(search ignores markup, so "docs" finds `[the docs](…)`), grouping into New /
Improved / Fixed / Removed, per-type counts, "latest two expanded", the unread
rule `hasUnread()`, draft validation, and `entryFromData()` (defensive read).
`seed.ts` has the five starter entries. `store.ts` has the Firestore side:
`useChangelog(teamId, isAdmin)` (admins listen to everything; **everyone else's
query includes `status == "published"`**, because rules aren't filters and an
unfiltered list is rejected, not trimmed), `saveEntry` / `patchEntry` /
`deleteEntry` (each a transaction that writes its `auditLog` entry in the same
transaction), `seedChangelogIfNeeded`, `useChangelogUnread`, and
`markChangelogSeen`.

- **Unread dot.** `components/layout/sidebar.tsx` shows a dot on the Changelog
  item when any published entry's `publishedAt` is later than the user's
  `lastSeenChangelogAt` (never opened = everything published is unread). The page
  stamps `lastSeenChangelogAt` when opened and again if something is published
  while it is open. Hidden while you're on the page.
- **Starter drafts.** The first time an admin opens the page, one transaction
  creates the five starter entries **as drafts** and sets `teams.changelogSeeded`.
  Nothing is published for anyone.
- **Page.** Glass timeline; type filter chips (counts), search, Expand all /
  Collapse all; the newest two entries start open (while filtering, every match
  opens). The filter bar and skeleton cards are the same size as the real content,
  so nothing shifts while loading. Admins also get New entry and per-entry Pin,
  Publish/Unpublish, Edit, and Delete (a confirmation that names the entry);
  drafts are dashed and labeled "Draft · only admins can see this".
- **Editor** (`components/changelog/entry-editor.tsx`) — a glass dialog: version,
  date, title, summary, change rows (type + text, add / remove / move up / move
  down), Published and Pinned switches, inline validation, live preview of markup.

**Credits — `lib/credits/`.** `ops.ts` is pure and tested: `CreditsOp` (add /
edit / delete / move a section; add / edit / delete / move an entry) and
`applyCreditsOp()`, which never throws — an op that refers to something another
admin already deleted simply changes nothing. `store.ts`'s `editCredits()` runs
in a **transaction**: read the latest stored sections (or the defaults, if none
are saved), apply the op to *those*, write them back with an `edit-credits`
audit entry. As with the pick list, that makes two admins editing at once
compose rather than overwrite. `seed.ts`'s `DEFAULT_CREDITS` (Built with AI,
Team, Built with, Data) is what the page shows until the first edit, which saves
it; its ids are fixed so an edit made on the defaults replays on the stored copy.
The board (`components/credits/credits-board.tsx`) uses `@dnd-kit` for dragging
sections and entries (grip handle, touch long-press, keyboard) and has up / down
buttons for each; sections collapse; the add/edit/delete dialogs are in
`credit-dialogs.tsx`.

**Rules.** `changelog/{id}`: members read published only; admins read and write
all; the doc shape is validated (`validChangelog()`: exact key set, limits,
`publishedAt` set iff published); `teamId`, `createdBy`, `createdAt` never change;
`publishedAt` can't move while an entry stays published. `credits/{teamId}`:
members read; admins create/update their own team's doc as themselves; never
deleted. `users/{uid}.lastSeenChangelogAt` needs no rule change. Covered by 34
new emulator tests.

**Audit log.** New actions `create-changelog-entry`, `edit-changelog-entry`,
`delete-changelog-entry`, `edit-credits` (labels in the Admin Panel's Audit Log
tab). Edits to the changelog log the full before/after content; credits edits
log a compact description of the op (`describeOp()`).

### Manual library matches (P15)

Admin Panel > Match Library now has two tabs: **Imported (FIRST API)** (the P3
import, unchanged apart from the rules below) and **Manual events**. Data model:
"`libraryEvents/{eventCode}`" and "`libraryMatches` additions" above.

**Pure modules — `lib/library/` (all unit tested).**
- `youtube-url.ts` — `parseYouTubeUrl(input)` → `{ videoId, startSec }` for `youtu.be/ID`,
  `watch?v=`, `/embed/`, `/shorts/`, `/live/`, `/v/`, mobile/music/nocookie hosts, with or
  without a scheme, with extra parameters (`si`, `feature`, `list`…) or a bare id; a
  `t=`/`start=`/`#t=` value becomes the start time. Any other host is rejected. `canonicalYouTubeUrl`.
  `components/video/youtube.ts`'s `extractYouTubeId` delegates to it, so any link the helper
  accepts is one the player can play.
- `time.ts` — `parseTimeInput` (`90`, `1:30`, `1:02:30`, also `90s` / `1m30s` / `1h2m3s`),
  `formatTime`, `validateVideoWindow` (start before end).
- `ids.ts` — `libraryMatchId` (moved here from `match-library.ts`, which re-exports it),
  `parseMatchType`, `originOf`, **`decideMatchWrite(existing, writer)`** (create / update /
  skip-other-origin — the one rule both write paths share), `generateManualEventCode`
  (`MAN-` + slug, made unique), `validateEventCode`, `normalizeEventCode`.
- `manual-match.ts` — `RawMatch` (a row as strings), **`validateRawMatch`** (the single
  validator for the form, fast entry, and bulk import: type, number, four distinct 1-5 digit
  teams, whole-number scores and penalty points with penalty ≤ its own alliance's score, video
  link + times + start < end, notes), `buildManualMatchFields` / `buildManualMatchDoc` (the exact
  doc that gets written, difficulty recomputed), `matchWarnings` (non-blocking: replaces an
  existing match, a score far from the event's others via Tukey fences, a clip over 10 minutes).
- `bulk.ts` — `validateBulk` / `summarizeBulk` for CSV or tab-separated paste, with or without a
  header, columns matched by name in any order; event defaults (YouTube link, match type, blank
  penalty = 0); an optional `eventCode` column must match the target event; per-row errors
  with line numbers; create-vs-update against the event's existing matches; a later duplicate row
  wins; `bulkTemplateCsv`. `parseCsv` gained an optional delimiter for this.
- `event-form.ts` — `validateEventForm`.

**Firestore side — `lib/library/store.ts`.** `useLibraryEvents`, `createManualEvent` (checks the
code against every event, any matches under it, and — for an admin-typed code — the FIRST API),
`updateManualEvent` (a rename is copied onto the event's matches), `deleteManualEvent` (refuses
while it has matches), **`upsertManualMatches`** (reads the event's matches, runs
`decideMatchWrite` per match so an API match is skipped and reported, writes in batches of 400
with one audit entry), `setMatchesPublished` (also clears Needs review), `setMatchesVideoLink`,
`deleteManualMatches`, `countCompletedSessionsForMatch` (the "N sessions used this match"
warning), and `backfillLibraryMetadata` + `useLibraryBackfill`. Every admin write logs one
`edit-match-library` audit entry in the same batch.

**API import — `lib/match-library.ts`.** `importLibraryEvent` now refuses an event code that
belongs to a manual event, writes the event's `libraryEvents` doc (`origin: 'api'`), runs
`decideMatchWrite` per match (a manual match is **skipped and reported** in
`ImportSummary.skippedManual`, shown in the Match Library and Rescore panels), and stamps
`origin: 'api'` and (for new matches) `published: true`. Its subscription hooks now take
`published == true` into the query: `useLibraryMatches(eventCode, { includeUnpublished })`,
`useLibraryMatchesBySeason` (always published only — a scout's match list, admins included),
`useAllLibraryMatches(enabled, { includeUnpublished })` (the Rescore tab passes true).

**UI — `components/admin/library/`.** `manual-library-panel.tsx` (event picker, details, table
with search / status filter / select-many / Origin + status badges, bulk Set video link,
Publish, Unpublish, Delete with confirmation, "Needs review → Publish all"),
`manual-event-dialog.tsx`, `manual-match-dialog.tsx` (full form, live validation, sanity
warnings, the rescore warning), `fast-entry.tsx` (one editable row; Tab/Enter; "Save and add
next" bumps the number and keeps type + link), `bulk-import-dialog.tsx` (pick/create the event once →
defaults → CSV upload / paste → validation preview → import), `video-marker.tsx` (the P3
`VideoPlayer` with **Set start here** / **Set end here** / **Go to start**). Practice Match
Select and the Results screen show a small **Manual** tag; `components/admin/library-backfill.tsx`
runs the one-time backfill for admins.

**Rules (`firestore.rules`).** `libraryMatches`: read `published == true` or admin (read
**strictly** — see P15-3); create/update admin-only with `origin` immutable and API writes
barred from a manual event's code; manual matches validated (`validManualMatch`); delete only
manual. `libraryEvents`: read any signed-in; admin create (origin fixed, manual codes
`^[A-Z0-9-]{3,24}$`), update with `origin`/`createdBy` fixed, delete only manual. Covered by
emulator tests, including one that feeds the rules the documents the real builders produce.

### Practice queries, errors, optional video times, glass level (FIX3)

**Practice queries — `lib/practice-queries.ts`.** Every Firestore query the Practice Scouting flows
make is a builder here (`librarySeasonQuery`, `libraryEventQuery`, `libraryAllQuery`,
`teamSoloSessionsQuery`, `teamLiveSessionsQuery`, `teamSessionsQuery`, `ownPausedSessionQuery`,
`completedAttemptQuery`, `lobbySessionsQuery`, `liveMatchScoutsQuery`, `teamLiveScoutsQuery`,
`lobbyPlayersQuery`, `myLobbyPlayersQuery`). The hooks use them and the rules regression suite
(`firestore.rules.test.ts`, "FIX3: practice queries…", once per user type) runs the same builders, so a
query can't drift from its rule. **Rules aren't filters:** every list must carry the constraint its
rule needs (`published == true`, `teamId == …`, `uid == you`). `lib/claim-doc.ts` `tryClaimDoc` is the
id-reservation transaction (Session IDs and lobby codes); it reads a doc that doesn't exist yet, so the
`practiceSessions` and `lobbies` rules allow `get` on a missing doc (`resource == null ||
sameTeam(...)`), and `list` stays team-scoped. Collection-group queries (`scouts`, `players`) are allowed
by recursive-wildcard rules (`match /{path=**}/scouts/{uid}`). `firestore.indexes.json` declares the
two collection-group single-field indexes as `fieldOverrides` (the CLI rejects them as composite indexes).

**Friendly errors.** `lib/firestore-errors.ts` — `describeFirestoreError(context, err, path)` →
`FirestoreFailure { context, code, message, path, at }`, `failureExplanation`, `failureDetails` (what
"Copy details" copies), `reportFirestoreError` (logs `[firestore] … — code — path: message`).
`components/practice/load-error.tsx` `<LoadError failure onRetry />` is the on-theme card (Retry, Copy
details). `useLibraryMatchesBySeason`, `useTeamPracticeSessions`, and `useCredits` return `error` and
`retry`; the practice flows' action errors use it too.

**Optional video times — `lib/library/video-window.ts`.** `LibraryVideo.startSec`/`endSec` are optional
(null = blank): blank start = from the beginning, blank end = until the video ends. Helpers:
`windowStart`, `windowEnd`, `clipDurationSec(video, mediaDurationSec)` (end − start; or video duration −
start when there is no end; null if unknown), `clipDurationOrFallback` (10-minute bound for the lobby
deadline), `clipProgress` (the "Finished Early" input; null → the flag is skipped),
`youTubeWindowVars`, `hasReachedEnd`. `VideoPlayerHandle.getDuration()` was added (the YouTube player
reports the video's length once loaded; the mock player its 2:30). Validation only compares start < end
when both are present. `lib/library/video-csv.ts` is the bulk video CSV parser (blank times allowed).

**Glass level — `lib/glass-layer.tsx` / `lib/glass-layer-level.ts`.** `useGlassLayerLevel()` → `{ level,
setLevel, reset }`, applied as the `--glass-shade` multiplier, remembered in localStorage
(`compepicurus.glass-shade`, the pre-FIX3 key) and saved per user in `users/{uid}.glassLayerLevel`
(0.3–2, debounced). `GlassLayerProvider` sits inside `AuthProvider`. `components/theme/glass-layer-slider.tsx`
has `<GlassLayerSlider />` (the slider) and `<GlassLayerButton compact side />` (the circular
droplet button + popover; since P18 it has no `connection` prop and no badge), used by the sidebar, the mobile top bar, and the
home page header. `lib/connection-notice.ts` (`connectionNotice(online, pending)`, pure) and
`lib/use-connection-state.ts` (`useConnectionNotice()`, run once in the app shell) compute the offline / unsynced signal; since P18
it is shown by `components/layout/connection-chip.tsx`, not on the droplet.

### `scoutTargets/{teamId}_{eventCode}` (P16)

The saved setup behind the Scout Status page, one doc per event. Every team member reads it (as a
team-scoped query); admins and Lead Scouts (primary or secondary role) write; never deleted.

| Field | Type | Notes |
|---|---|---|
| `teamId`, `eventCode` | `string` | together = the doc id |
| `ranges` | `{ practice?, qualification?, semi?, final?: string }` | range text per category (`2-4, 8, 10-12`); blank/absent = every match. A non-blank `final` also overrides which playoff matches are the Finals |
| `maxOverrides` | `{ [category]: number }` | manual "max matches" per category; absent = read from the schedule |
| `individual` | `{ [uid]: { [category]: number } }` | manual per-scout targets; absent = prefilled from Assignments (when a schedule is published) |
| `extraScouts` | `string[]` | uids added to the targets table by hand |
| `updatedBy` | `string` | uid |
| `updatedAt` | `Timestamp` | |

### Scout Status (P16)

`/analytics/scout-status`: how each Match Scout is doing against their targets, and which robots in which
matches were scouted. Everything is counted from `useAnalyticsEntries()` (the shared filters).

**Pure modules — `lib/scout-status/` (tested).** `categories.ts` — `StatusCategory` (`practice |
qualification | semi | final`), `classifyMatch` / `finalsMatchNumbers` (Finals = the matches sharing the highest
playoff `series`, else the highest-numbered playoff match, or an explicit override), labels `P12 / Q12 / SF5 /
F14`. `ranges.ts` — `parseRangeText` (`2-4, 8, 10-12`, merged; blank = all), `inRanges`, `rangeNumbers`.
`compute.ts` — `buildEventContext` (classify + ranges + category filter for one event), `maxTargets`,
`summarizeAssignments`, `individualTargets`, `sumTargets` (across events), `targetScouts` (who is in the
table), `buildScoutRows` (matches scouted vs entries, per-category chips, last entry, avg accuracy, flagged,
missing assigned, status), `scoutStatusPill`, `totalsRow`, `playedFractionOf`, `buildCoverage` (a check per
scout per robot; upcoming matches muted). `config.ts` (`ON_TRACK_FACTOR`, caps), `form-types.ts` (registry —
only Match Scout enabled), `permissions.ts` (`canEditScoutTargets`, also `usePermissions().can("editScoutTargets")`).

**Data hooks.** `store.ts` — `useScoutTargets(teamId)` (realtime, team-scoped query), `saveScoutTargets`,
`setupFromData`; `use-assignments.ts` — `useTeamAssignmentSlots` (every event's published slots, one query);
`use-scout-status.ts` — `useScoutStatus(enabledCategories)` joins the entries, the schedule (FIRST API, or the
library's matches in Practice mode), Assignments, attendance, members, and the setup.

**UI — `components/scout-status/`.** `setup-panels.tsx` (`RangeEntry`, `MaxTargets`, `IndividualTargets`),
`status-table.tsx` (sortable, searchable, expandable, totals row), `coverage-list.tsx` (grouped, "Show only
missing", paged), and the page composes them with the form-type tabs and the category chips.

### Mobile and installability (P17)

**Global rules live in one unlayered block at the end of `app/globals.css`** (Tailwind 4 puts utilities in a
cascade layer, so unlayered CSS wins over a component's `h-8` / `text-sm` without `!important`):
`overflow-x: clip` on `html, body` (clip, not hidden, so `position: sticky` keeps working); the coarse-pointer
44px floor for buttons/selects/summaries/text inputs (opt out with `.touch-compact`; small Radix checkbox /
switch / radio get a `::after` hit-area expansion instead of growing); 16px form text under 1024px (iOS zoom);
under 768px lighter `backdrop-filter` and still background blobs; `prefers-reduced-transparency` solid panels;
`.safe-bottom` / `.safe-x` helpers. New components should reach for the helpers or `env(safe-area-inset-*)`
directly and use `dvh`, never `100vh` / `min-h-screen` (`lib/mobile.test.ts` enforces this in the layout files).

**Dialogs** (`components/ui/dialog.tsx`) are bottom sheets under `sm` via `max-sm:` classes — same component,
same solid backing, so every existing dialog (pickers, break menu, admin forms) gets it.

**Viewport and metadata** are in `app/layout.tsx` (`viewport` export: `viewportFit: "cover"`,
`interactiveWidget: "resizes-content"`, theme color; metadata `icons` + `appleWebApp`).
`components/layout/motion-provider.tsx` wraps the app in `<MotionConfig reducedMotion="user">` so Framer Motion
transforms are skipped for users who ask.

**Installable app.** `app/manifest.ts` (standalone, start `/dashboard`, scope `/`) + `public/icons/*.png`
(generated by `node scripts/generate-icons.mjs`, a dependency-free PNG encoder; rerun it only to change the
art). The manifest registers **no service worker**; the only worker is the Firebase Messaging one served from
`app/firebase-messaging-sw.js/route.ts`, so push is unaffected. `components/ui/add-to-home-screen-hint.tsx`
(`AddToHomeScreenHint`) shows the iPhone "Add to Home Screen" note only in an iOS browser tab (not when already
installed, not on Android/desktop); it replaced the inline text on the live results screen.

**Verification.** `lib/mobile.test.ts` (static guards: manifest/icon validity, viewport, CSS rules, dialog sheet
classes, safe-area bars, no `100vh`). Browser checks are `scripts/mobile-audit.mjs` (Playwright: screenshots at
five sizes, fails on horizontal scroll); findings and the open checklist are in `docs/mobile-audit.md`.

## P18 — Themes, Appearance, sidebar

**Theme model — `lib/theme-color.ts`, `lib/theme-tokens.ts`, `lib/themes.ts`.** `ThemeDefinition` = `{ id, name, kind: "solid" | "gradient" | "flag",
tagline, accents, gradientStops (raw), glowColor, glassTint, textOnAccent?, backgroundGradient, tokens }`, where `tokens` is
`{ light, dark }` (solid, gradient) or `{ fixed }` (flag). `ThemeTokens` is the complete set of values the CSS needs (background, foreground,
muted, primary / secondary / accent + `primaryForeground`, fitted `gradient` stops, glow, blobs, `pageStops`, glass bg / strong / border / shadow,
overlay color + alpha + border, `surfaceSolid`, `focusRing`, `tint`, three status colors). Registry exports: `themes`, `themeGroups`
(Solid / Gradients / Pride), `defaultThemeId = "team"`, `getTheme`, `isThemeId`, `isFlagTheme`, `hasModes`, `tokensFor(theme, mode)`.
Factories `solidTheme`, `gradientTheme`, `flagTheme` build tokens through `buildTokens`, which nudges every fill that carries text (all gradient
stops, primary, accent) in HSL lightness only until the text on it is >= 4.5:1 and it stands >= 3:1 off the page (`fitLuminance`), picks white or
near-black text by the smaller change, re-samples the gradient so the blended middle passes, and scales the background wash down until body text
passes on the worst-case glass surface. Catalog: 9 solid (Team Colors, BIOBUZZ, Evergreen, Ocean, Amethyst, Blossom, Obsidian, Pearl, Slate), 12 gradient
(Nebula, Lagoon, Ember, Sunset, Aurora, Cotton Candy, Midnight, Twilight, Glacier, Citrus, Tropical, Rose Gold), 18 `pride-*` flags. Ids `team` and
`biobuzz` are unchanged and keep their original dark surfaces exactly.

**Generated CSS — `lib/theme-css.ts`.** `themeCss()` (server-side, once) writes every theme x mode as
`html[data-theme="id"][data-mode="light|dark"]{...}` (flags: `html[data-theme="id"]{...}`), the default also as `:root`, into
`<style id="theme-tokens">` in `app/layout.tsx`; `themeInitScript()` is the pre-paint script that sets `data-theme` / `data-mode` from localStorage
(`compepicurus.theme`, `compepicurus.colorMode`) and the system preference (flags force `dark`). `app/globals.css` no longer holds theme values, only
what is shared: `--theme-gradient` / `--theme-gradient-h` (built from `--theme-stops`), the light-mode remaps of hardcoded `bg-white/N` tints and pastel
`text-red-300`-style shades, a base `:focus-visible` ring (`--focus-ring`, in `@layer base`), and the `.theme-animating` fade. New variables:
`--theme-stops`, `--page-bg`, `--surface-solid`, `--focus-ring`, `--tint-rgb`, `--status-online|offline|syncing`. The hardcoded
`linear-gradient(135deg, var(--color-primary), var(--color-accent))` in 23 files is now `var(--theme-gradient)` (`--theme-gradient-h` for the 90deg progress bars).

**Preferences — `lib/theme-prefs.ts` (pure) and `components/theme/theme-provider.tsx`.** `ThemeProvider` now sits **inside** `AuthProvider`.
`useAppTheme()` -> `{ theme, themeId, setThemeId, colorMode, setColorMode, resolvedMode, modeLocked, toggleColorMode }`. Theme and mode are independent;
a flag theme applies `dark` but leaves the saved mode alone (restored on leaving). Saves `users/{uid}.themeId` / `.colorMode` when signed in, localStorage
always. Applying sets two attributes, plus a ~450ms `theme-animating` class on `<html>` that transitions colors on elements only (no View Transition).

**Contrast guard — `lib/theme-contrast.ts`.** `auditAllThemes()` measures the final tokens of every theme x mode: foreground and muted text on page / glass
(one layer and nested) / overlay (also over pure black and white) / solid surfaces (4.5), text on every point of the gradient + primary + accent (4.5), fills
against the page (3), secondary (3), the focus ring on every surface (3), the status dots on the solid chip (3). Run by `lib/themes.test.ts` and by
`npm run check:themes` (`scripts/check-theme-contrast.ts`), which `prebuild` runs, so a failing theme fails `npm run build`.

**UI.** `components/theme/appearance-panel.tsx` (`<AppearancePanel />`, used in Account Settings > Appearance; Mode control, search, grouped live-preview cards);
`components/theme/color-mode-toggle.tsx` (sun/moon, sidebar footer, top bar, marketing header; disabled on flags);
`components/layout/connection-chip.tsx` (`<ConnectionChip connection collapsed fixedWidth />`; solid `--surface-solid` backing, Online / Offline [· N] / Syncing N,
dot + tooltip when the sidebar is collapsed, in the desktop sidebar, the mobile top bar and the drawer) + `connectionStatus()` in `lib/connection-notice.ts`.
`components/theme/theme-switcher.tsx` is deleted. **Sidebar structure:** the outer `motion.aside` only positions and sizes; the `glass-panel` (which clips its
scrolling content) is an inner box and the collapse arrow is its sibling, so it can straddle the edge instead of being clipped.

**Glass blur in the build.** In `app/globals.css` every `-webkit-backdrop-filter` is written *before* `backdrop-filter`, and Tailwind's `backdrop-blur-*` is not used
(`.scrim-blur` instead): see ASSUMPTIONS P18-12. `lib/glass-css.test.ts` guards the order and runs the real Lightning CSS transform.

**Browser tests — `playwright.config.ts`, `e2e/`.** `npm run test:e2e` (projects chromium-desktop, webkit-desktop, chromium-phone, webkit-phone). It starts its own Next server with
`E2E_THEME_CHECK=1`, which enables the test-only page `app/e2e/theme-check` (the real Sidebar, Topbar, PageTransition and Appearance panel signed-out, plus one sample of each
glass class; a 404 otherwise). Covers: every theme x mode keeps non-`none` backdrop filters equal to the baseline with no backdrop-root ancestor, theme/mode independence,
flag lock + restore, no flash on the first frame, the sidebar arrow hit-test at 3 widths expanded and collapsed, and the chip's states with no layout shift.

## P19 — Several FTC teams under one account

**Terms.** The **team account** is the existing `teams/{teamId}` doc (join code, owner, shared data). An **FTC team** is a competing team (number
and name) that belongs to the account. All scouting data stays shared across the whole account; assigning a member to an FTC team only changes
display, defaults and filters, never data access.

**Data model.**
- `teams/{teamId}.fieldTeams`: `{ id, number, name }[]`, the admin's order, 1 to 10 entries. `id` is stable (the migrated first team is `ft-<number>`,
  teams added in Settings are `fteam_<8 chars>`), so editing a number never breaks assignments. `name` may be `""`.
- `teams/{teamId}.fieldTeamIdList`: `string[]`, the ids of `fieldTeams` in the same order. A rules-only mirror: `firestore.rules` can't project a list of
  maps, so a member's `fieldTeamIds` is checked against this list. Always written together with `fieldTeams` (`fieldTeamsWrite()`).
- `teams/{teamId}.accountName`: optional string (at most 60), shown under the CompEpicurus name in the sidebar.
- The legacy `teams/{teamId}.number` / `.name` are kept and mirror the first FTC team on every save; every reader goes through `readFieldTeams()`, which
  falls back to them while `fieldTeams` is absent.
- `users/{uid}.fieldTeamIds`: `string[]`, the FTC teams the member is assigned to. Only an admin or the owner can change it (never the member's own);
  writes are checked against `fieldTeamIdList` (`getAfter`, so one batch can add a team and assign people to it). **None recorded, or only ids of removed
  teams, counts as "all teams"** (`assignedFieldTeams()`).
- `users/{uid}.activeFieldTeamId`: the team the user is "viewing as". Their own to write; resolved against their assigned teams, so a stale id is harmless.
- Audit (`auditLog`, no rules change): `edit-field-teams` (Team Settings save, with member reassignments), `edit-member-teams` (bulk assign, one entry per
  member), and the existing `edit-member-roles` now carries `fieldTeamIds` in before/after when the member editor changed them.

**Pure logic: `lib/field-teams.ts`** (no React, no Firebase; 35 unit tests). `FieldTeam`, `readFieldTeams`, `fieldTeamLabel` ("FTC 35792"),
`fieldTeamFullLabel`, `parseFieldTeamNumber` (1 to 5 digits), `assignedFieldTeams`, `isImplicitlyAllTeams`, `resolveActiveFieldTeam`, `isOurTeam`,
`validateFieldTeamDrafts` / `draftsToFieldTeams` / `toDrafts` (the editor's validation: unique numbers, bounded names, at least one team), `moveItem`,
`fieldTeamsWrite`, `membersAssignedTo`, `planRemovals` (reassignment when teams are removed; follows a target that is itself removed),
`applyBulkAssignment`, `matchesTeamFilter`, `sameIdSet`, and the migration planners `planTeamMigration` / `planMemberMigration` /
`defaultMemberFieldTeamIds`.

**Hooks: `lib/field-teams-context.tsx`.** `<FieldTeamsProvider>` (one team-doc subscription, mounted in `app/(app)/layout.tsx`), `useFieldTeams()`
(`{ loaded, fieldTeams, assignedFieldTeams, accountName }`), `useActiveFieldTeam()` (`{ loaded, activeFieldTeam, setActiveFieldTeam, assignedFieldTeams,
canSwitch }`: the saved choice while still assigned, else the first assigned team) and `useIsOurTeam()` (the hook-bound `isOurTeam(number)`, true for
**any** FTC team on the account). They return an empty value outside the provider, so isolated component tests keep working. `buildFieldTeamsValue()` is
the pure assembly the tests exercise. Writes: `lib/field-teams-actions.ts` (`saveTeamSettings`, `assignMembersToFieldTeams`, both one batch with their
audit entries).

**Migration (server).** `POST /api/team/sync-field-teams` (`app/api/team/sync-field-teams/route.ts` and `lib/server/field-teams-sync.ts`), called best-effort
by `lib/auth.tsx` after every sign-in (`syncFieldTeams()` in `lib/team-enrollment.ts`). The account is the caller's own (from their profile). In a transaction
it gives the team doc `fieldTeams` (from the legacy number/name) and the id mirror if either is missing or stale; then it gives every member **without a
`fieldTeamIds` list** all the account's teams. Idempotent, never overwrites an existing assignment. `/api/team/create` starts a team with its number as the
first FTC team; `/api/team/join` and the owner auto-attach in `/api/auth/sync-roles` start new members on every FTC team.

**FIRST lookup.** `getTeamByNumber(teamNumber, season?)` in `lib/ftc/actions.ts` (a Server Action like the others; signed-in only; `null` when FIRST has no such
team, an ordinary error result when the call fails).

**Rules (`firestore.rules`).** `teams` update: `sameTeam && canManageMembers() && validActiveEvents() && validFieldTeams()` (an admin or the owner;
`validFieldTeams()` = 1 to 10 entries, the id mirror present and the same length, `accountName` null or at most 60 characters). `users` own-doc update pins
`fieldTeamIds` with `.get()` (pre-migration docs lack the field); the admin/owner member-edit rule adds `validMemberFieldTeams(teamId)` (unchanged, or a
list of at most 10 ids all in the team's post-batch `fieldTeamIdList`).

**UI.**
- `/team-settings` (`app/(app)/team-settings/page.tsx`, `components/team/field-teams-editor.tsx`): its own page, in the sidebar above Account Settings. Admins
  and the owner edit; everyone else gets a read-only view. Account name; FTC teams (add, remove, reorder with up/down buttons, number 1 to 5 digits and
  unique, optional name); a typed number is looked up through FIRST after 500 ms (confirms it exists and fills the name; a manual name always works). The last
  team can't be removed; removing a team that has members opens a "move them to" dialog, applied atomically on Save.
- Sidebar (`components/layout/field-team-switcher.tsx`): under the wordmark, "FTC 35792" over the name; a popover switcher when assigned to more than one;
  collapsed it is the number; the drawer has it too. The old hard-coded "FTC 3468 MAGNAtech" line is gone.
- Team Management (`app/(app)/team-management/page.tsx`): per-member FTC team checkboxes in the editor (`member-editor-dialog.tsx`), chips on each row
  (`components/team/field-team-chips.tsx`), a team filter (`team-filter-select.tsx`), row checkboxes plus a floating bulk bar (`bulk-assign-bar.tsx`: add to /
  remove from a team). Edit rights are the FIX2 matrix, unchanged.
- "Our team" highlight (`OurTeamTag`, `OUR_TEAM_ROW_CLASS` in `components/analytics/team-bits.tsx`): every FTC team on the account, in Team Averages, Rankings,
  Team Breakdown, Match Breakdown and Match Scout Analytics.
- Dashboard (`lib/dashboard/data.tsx`) and the Pick List's "our team" use the active team; the Pick List card has a switcher among the account's teams. People,
  Scout Accuracy and the Assignments scout picker show chips and a Team filter (hidden when the account has one FTC team).

**Tests.** `lib/field-teams.test.ts`, `lib/field-teams-context.test.tsx` (hook behaviour: default, persistence, removal of the viewed team),
`lib/member-access.test.ts` and `lib/scout-stats/engine.test.ts` (additions), `firestore.rules.test.ts` ("P19 FTC teams", 16 tests) and
`api-routes.emulator.test.ts` ("P19 FTC teams", migration idempotent, only the caller's account), `e2e/field-teams.e2e.ts` (Playwright, the sidebar
switcher expanded, collapsed and in the drawer).

## P20 — Team applications, the two kinds of owner, and ownership transfer

**Two kinds of owner (`lib/team-owner.ts`).**
- **Platform owner**: an email in the server-only `OWNER_EMAILS` (verified). Carried as the `platformOwner` custom claim (plus the `users.isPlatformOwner` mirror for
  the UI), set by `app/api/auth/sync-roles`, removed again if the email leaves the list (the pre-P20 `owner` claim is stripped on the next sync). Approves applications,
  switches public team creation, force-transfers an account for recovery, and is always an admin of their own account. Every platform-only server route also checks
  the live list (`isPlatformOwnerToken()` in `lib/server/owner-admin.ts`), so revoking takes effect on the next request. The claim opens the application collections
  and nothing else (rules: `isPlatformOwner()`); it gives no access to any account's scouting data.
- **Team owner**: `teams/{teamId}.ownerUid`: authoritative for the Owner badge, the FIX2 protections (`canEditMember`, the rules' owner-row check) and ownership transfer.
  `users.isOwner` is only a **mirror** of it (so the roster can show the badge without a second read), written by server routes in the same transaction as `ownerUid`.
  Rules: `isOwner()` = `ownerUid` equals the caller, or, **only while the team has no `ownerUid`**, the legacy per-user flag (so the existing owner is never locked out
  before the bootstrap runs). A stale flag counts for nothing once `ownerUid` exists.
- **Bootstrap** (`bootstrapTeamOwner` in sync-roles, `chooseBootstrapOwner` in `lib/team-owner.ts`): runs only when an account has no `ownerUid` (re-checked inside a
  transaction): the user already flagged `isOwner` keeps it (earliest-created if several; the rest are demoted to plain admins), else a signing-in platform owner of that
  account takes it, else nobody. It can't take ownership back after a transfer because `ownerUid` is never absent again. Team creation and approval set `ownerUid` directly.

**Collections (all written only by server routes; see `firestore.rules`).**
- `teamApplications/{id}`: `applicantUid`, `applicantName`, `applicantEmail`, `emailKey` (hash of the canonical email), `teamNumber`, `teamName`, `officialTeamName`, `role`,
  `verification`, `link`, `status` (`pending|approved|rejected|blocked`; `expired` is derived: a pending one past `expiresAt`), `rejectionReason`, `decidedAt/By`, `teamId`
  (once approved), `createdAt`, `expiresAt` (+30 days). Readable by platform owners, and by the applicant for their own (queries filter on `applicantUid`). Nothing private is on it.
- `applicationPrivate/{id}` (same id): `signals` (`ApplicationSignals`: email verified, sign-in provider, account age, FIRST lookup result and name match, CAPTCHA, fill
  seconds, applications from the IP in the last hour, email domain, an existing account for the number), `ipHash`, `notes`. Platform owners only.
- `applicationBlocks/{email_<hash>|team_<number>}`: `type`, `value`, `reason`, `applicationId`. Platform owners read; `unblock` deletes.
- `platformAuditLog/{id}`: `action` (`submit-application`, `approve-application`, `reject-application`, `block-application`, `unblock`, `force-transfer-ownership`),
  `actorUid`, `details`. Platform owners only, because it can hold applicant details that must not appear in any team's Audit Log.
- `rateLimits/{key}_{window}`: fixed-window counters (`count`, `expiresAt`) keyed by **hashes** of the IP / email: no raw IP or email is stored.
- On `teams/{teamId}`: `ownerUid`, `pendingTransfer` (`{ id, fromUid, fromName, toUid, toName, requestedAt, expiresAt }`; rules refuse both from any client, admins and owners
  included), `fieldTeamNumbers` (a queryable mirror of the FTC numbers, `fieldTeamsWrite()` keeps it in step), `applicationId` (on an account an application created).
- On `users/{uid}`: `isPlatformOwner` (pinned in both update rules). New audit actions in `auditLog`: `approve-team-application`, `request-ownership-transfer`,
  `transfer-ownership`, `decline-ownership-transfer`, `cancel-ownership-transfer`, `force-transfer-ownership`.

**Application flow.**
- UI: `/apply` (`app/(marketing)/apply/page.tsx`): not signed in (sign in / create an account), signed in but email unverified (resend / "I've verified"), then
  `components/applications/apply-form.tsx` (name, verified email, FTC team number with a FIRST lookup that fills the name, role from the existing roles, "How can we verify
  you're on this team?", optional link, a hidden honeypot, Turnstile when a site key is set), then `application-status-card.tsx` (pending / approved / rejected with the
  reason / expired). Signup and Finish Setup offer **Apply to create a team** while creation is off, and anyone with an application sees its status instead of the join form.
- `GET /api/applications/start` issues a signed start token (the minimum time-to-submit check can't trust a browser timestamp). `POST /api/applications` runs, in order: sign-in
  and `email_verified`, body cap (16 KB), a per-IP attempts counter (40/hour), the honeypot, the start token (4 s to 2 h), validation and sanitizing (`lib/applications.ts`),
  disposable-email list (`lib/disposable-domains.ts`), blocks, Cloudflare Turnstile (`lib/server/turnstile.ts`, skipped and flagged when `TURNSTILE_SECRET_KEY` is unset), rate
  limits (3/hour per IP, 3/hour per email, both hashed), already-a-member, one pending (non-expired) per applicant / canonical email / team number, an existing account for the
  number, the FIRST lookup (`lib/server/first-team.ts`, a signal, never a gate), then writes the application, its private doc and a platform log entry, notifies platform owners
  (push to `fcmTokens` plus email) and emails the applicant a receipt. Applications expire after 30 days (lazily).
- Review: `app/api/admin/applications` (`approve | reject | block | unblock | note`, platform owner only). **Approve is one transaction**: creates the team (join code, `fieldTeams`,
  `fieldTeamIdList`, `fieldTeamNumbers`, `ownerUid` = applicant), the applicant's user doc (admin, owner mirror, chosen role), marks the application approved and writes the audit
  entries (the new account's own `auditLog` gets a minimal one). It refuses an expired or decided application, an applicant who has joined a team meanwhile, an FTC number an
  account already has, and an applicant whose email lost verification. `application-config` reports which protections are configured (warnings in the panel).
- UI: Admin Panel > **Team Applications** (`components/admin/applications-panel.tsx`: status filters, signals via `describeSignals()`, notes, Approve / Reject / Block, block list;
  a count badge on the tab and on the sidebar's Admin Panel item) and > **Recovery** (`recovery-panel.tsx`). Both tabs are platform owners only.

**Ownership transfer** (`app/api/team/transfer`, all actions server-side, transactions that re-check their state; pure rules in `lib/team-owner.ts`).
`request` (team owner; target an existing **admin with a verified email**; typed FTC team number; a sign-in no older than 5 minutes, read from the token's `auth_time`; one live
pending transfer per account; expires in 7 days), `accept` (the recipient, still an admin with a verified email, and only while the requester is still the owner), `decline`,
`cancel` (the owner or the requester) and `force` (platform owner: reason, recent sign-in, typed number; clears any pending transfer; labelled "recovery" in the account's own Audit
Log and recorded in `platformAuditLog`). Accepting moves `ownerUid` in one transaction; the old owner stays an admin and loses the protections. Expiry is lazy. UI: Team Settings >
**Ownership** (`components/team/ownership-section.tsx`, with `lib/reauth.ts` for the re-authentication) and the recipient's banner (`components/layout/ownership-transfer-banner.tsx`).

**Email** (`lib/server/email.ts`, `email-templates.ts`): a thin Resend sender (no SDK), configured by `RESEND_API_KEY` + `EMAIL_FROM` (+ `APP_URL` for links); a no-op when unset, and a failure never fails a
request. Messages: application received, new application (to `OWNER_EMAILS`), approved, rejected with the reason, ownership transfer requested, ownership changed. Every user-supplied value is HTML-escaped.

**Tests.** `lib/applications.test.ts`, `lib/team-owner.test.ts`, `lib/server/security.test.ts` (token, Turnstile, email, templates, hashing), `firestore.rules.test.ts` ("P20 owner model, applications and
isolation": ownerUid-based protections, the new collections, cross-account isolation incl. platform-owner claims) and `api-routes.emulator.test.ts` ("P20": bootstrap, no-reclaim after a transfer, claims, the whole
application route, every review action, transfer happy path / decline / cancel / expiry / force).

## P21 — Form schema v2 and the form engine

Everything that used to be hard-coded for BIOBUZZ (the fields, the points, the analytics columns, the CSV, the flags, the team stats, the scout form's layout) is now derived from
a **form definition**. BIOBUZZ is the first built-in form; behaviour for it is unchanged, and a frozen copy of the old code is the regression oracle (see Tests).

**The schema (`lib/forms/types.ts`, validated by `lib/forms/validate.ts`).** A `Form` = `{ id, name, description, formType, tags, version, status, scoringEnabled, sections[], origin, keyAliases?,
phaseLabels?, … }`.
- `sections[]` are the form's categories. Each has a `phase` (`prematch | auto | teleop | endgame | misc`, or a custom key labelled in `phaseLabels`), optional `groups[]` (sub-headings; a field joins one via
  `groupId`) and `fields[]`.
- A field has a stable `id` (what the builder tracks), a unique `key` (storage, CSV, analytics), a `type` (`toggle | counter | checkbox | number | select | radio | rating | text | textarea`, plus the three
  **system** fields `matchPicker | teamPicker | scoutName`, which have the fixed keys `match` / `teamNumber` / `scoutName`, are always required, live in Pre-Match and can't be removed or retyped), type settings
  (`min/max/step`, `decimals`, `options[]`, `scale`), `required`, `default`, `visibleWhen`, `scoring`, `analytics`, `statRoles[]`, `unrealisticAbove`, `ui`.
- `scoring: { mode: none | whenOn | perTally | perUnit | byOption, value, cap? }`. `whenOn` (toggle/checkbox) and `perTally` (counter) are what BIOBUZZ uses; `perUnit` (number/rating) and `byOption`
  (select/radio: each option has its own `points`) are the others; `cap` bounds a field's points. A field's points go to its **section's phase** (so moving a field between categories moves its points). Custom
  phases count in `total` and `byPhase`, not in `auto/teleop/endgame`.
- `visibleWhen: { field, op: checked | equals | gt, value? }`. A field whose condition fails, or whose parent field is hidden, or whose category is hidden, is **not scored, not required, not exported as a
  value that counts** (its stored value is kept so toggling a condition back on doesn't lose input).
- `analytics: { include, label, category, aggregate (sum|avg|rate|last|list), csvHeader, element }` drives the Match Analytics column (three-tier header: section title > category > label), the CSV header and the
  team-stat aggregate. `element` groups points by game element on Team Profile.
- `statRoles` replace hard-coded keys: `primaryScoring`, `reliability` (a robot-failure incident, Team Breakdown's pill), `neverStarted`, `died`, `disabled`, `recoveredFromFreeze` (the auto-flag rules read these) and
  `comments` (the field whose text is mirrored to the entry's summary `comments`). A form without a role simply doesn't get that behaviour.
- `scoringEnabled: false` forms (pit scouting, driver feedback…) score zero and have **no** score or accuracy columns; their entries are written with `scored: false` and everything that depends on a score treats them as
  "n/a" (flags don't fire, accuracy is "n/a", never an error).
- `keyAliases: { oldKey: currentKey }` keeps old entries readable after a field's key is renamed (transitive, cycle-safe; the current key wins over an aliased old one).
- Validation is two layers: `parseForm` (zod, **strict**: unknown keys/types and size/length limits are errors) is what every store and the import run; `checkForm` is the semantic layer (unique keys/ids, system
  fields, scoring that fits the type, options, conditions that point at a real other field with no cycles, aliases, roles…) and returns `error`s (block publishing) and `warning`s (don't).
- `lib/forms/values.ts` (defaults, coercion/clamping, `normalizeValues`, `validateValues` for required-while-visible), `scoring.ts` (`calculateScore`, `maxScore`, `storableScore`), `visibility.ts`, `meta.ts` (roles,
  elements, phases per field), `hash.ts` (content hash of a form, used to notice a changed built-in).

**Entries.** New entries store `values` (keyed by field `key`) plus `formId` and `formVersion`. Pre-v2 entries have the typed `fields` object plus top-level `comments`: they are **never rewritten**.
`entryValues(entry, form?)` (`lib/forms/legacy.ts`) is the one reader: it returns `values` (with `keyAliases` applied) or, for an old entry, the legacy `fields` + `comments` in the same shape, so every consumer
(analytics, flags, stats, CSV, the entry editor) is written once. **Dual-write:** a form that still has BIOBUZZ's 15 legacy keys (`hasLegacyShape`) also writes the exact legacy `fields` object, so an old tab or
a rollback still reads new entries. `entryPayloadFor(form, values, score)` (`lib/scout-entries.ts`) builds `{ formId, formVersion, values, fields?, score, scored?, comments }` for every save path (scout, solo / live /
lobby practice, CSV import, the admin entry editor). `score` is `{ auto, teleop, endgame, total, byPhase? }` (`byPhase` only when a custom phase scored).

**The form store (`lib/forms/store.ts`, `firestore-store.ts`, `transitions.ts`, `resolve.ts`).**
- Built-ins live in code (`lib/forms/builtin.ts`: `BUILTIN_FORMS`, BIOBUZZ v1). An account's forms live in Firestore: `forms/{teamId}_{formId}` = `FormDoc { teamId, formId, name, origin, baseBuiltInId?,
  baseBuiltInHash?, publishedVersion | null, draft | null, active, archived, createdBy, … }` and `forms/{teamId}_{formId}/versions/{n}` = `FormVersion { form, note?, createdBy, createdAt }`, **write-once**.
- **Copy-on-write override.** Saving a draft of a built-in's id creates an override doc (its content hash is recorded). Scouts keep seeing the built-in until the override is **published**, which is version
  `builtin.version + 1` (so the built-in's own version 1 always resolves to the original in code and its entries keep their form). "Reset to built-in" sets `active: false` (its versions stay, so entries scouted
  with them still resolve). `builtinChangedSince` flags an override whose code-defined original has since changed.
- **Immutable versions.** `publish` turns the draft into the next version (one past the latest), clears the draft, and writes the version doc + the form doc in one transaction (the rules only allow the version
  doc together with the doc's `publishedVersion` bump). It refuses to publish with no draft or with blocking `checkForm` errors. Drafts may be invalid; published versions never are. Forms are archived, never deleted.
- `FormStore` = `{ listForms, getForm(formId, version?), getDraft, saveDraft, publish, archive, resetToBuiltin }`. The in-memory store and the Firestore store both go through the pure functions in
  `transitions.ts`, so they can't disagree; the in-memory one is the reference semantics for tests.
- **Resolution** (`resolve.ts`): `resolveForm(catalog, id, version?)` (stored version, else the built-in's own version, else null; latest = active override, else the built-in) and `resolveFormForEntry`, which never
  fails for a form that exists in code. `FormResolver` (`resolver.ts`) is what rescoring and recompute use to find an entry's form (the account's **current** form for its id, so "I changed the scoring: rescore" does what it says).
- **Per-season active form.** `teams.activeForms[seasonId] = formId` (seasons stay code-defined in `lib/seasons.ts`; the season's own `formId` is the default). Only a published, unarchived form can be active
  (`canBeActive`); an active form that can't be resolved falls back to the season's built-in so scouting never breaks.
- **Client:** `lib/forms/forms-context.tsx` (mounted in the app layout): one realtime subscription to the account's form docs, versions loaded on demand (and the latest of every active form eagerly), hooks
  `useForms()`, `useActiveForm(seasonId)`, `useLockedForm(seasonId)` (practice sessions: fixed at the first load so both robots use one version even if a form is published mid-session),
  `useFormsForEntries(entries)`, `useSchemaForEntries(entries, seasonId)` (every version used, **unioned**), `useGameFormIds(gameId)` (the form ids that count as a Game in analytics scope). Outside the provider
  the hooks fall back to the built-ins.

**Schema-driven consumers.**
- `lib/analytics/game-schema.ts`: `buildGameSchema(form)` derives the Match Analytics table (sticky Match/Team/Scout, a column per `analytics.include` field with `Phase - Category - Label` headers, per-phase score columns
  and Total when scoring is on, comment columns, accuracy columns when scoring is on, actions). `unionForms(forms)` merges several forms/versions into one (sections by id, fields by key, renamed keys dropped for
  their current key) so one table and CSV can show mixed versions; a cell for a field an entry's form never had reads `null` and renders as an em dash. `GAMES.biobuzz` is `buildGameSchema(BIOBUZZ_FORM)`.
- `lib/analytics/csv.ts`: export headers come from the columns' `csvHeader` (default `Phase - Category - Label`); import maps header cells back to fields (`coerceFieldValue`; a select's label maps to its value)
  and **recomputes the score** (never trusts it); the dialog stamps rows with the active form.
- `lib/analytics/flags.ts` (rules read roles and `unrealisticAbove`, never keys; score rules skip unscored forms), `team-stats.ts`, `team-card.ts`, `match-breakdown.ts` (elements and phases come from the form),
  `recompute.ts` / `lib/admin/rescore-sessions.ts` (take a `FormResolver`), `lib/live/scoring.ts` and `lib/lobby/scoring.ts` (accuracy `null` when unscored).
- The scout form (`components/scout/scout-form.tsx` + `field-inputs.tsx`) renders any form: sections in order, groups, conditional visibility, required validation, a sticky score bar with the form's phases (hidden when
  scoring is off), the system pickers. `RenderedField` is shared with the admin entry editor, which edits an entry against the form and version it was scouted with.
- `lib/scout-form/schema.ts` is kept as a thin compatibility facade (`getFormSchema`, `calculateScore`, `valuesToScoutEntryFields`, …) over the new modules.

**Portable forms (`lib/forms/portable.ts`).** `exportForm` / `exportFormJson` strip everything instance-specific (author, dates, status, built-in link) into `{ format: "compepicurus-form", formatVersion: 1, form }`;
`importForm` (text or object) enforces a size cap, the format, the strict zod parse, whitespace collapsing in short labels and `checkForm`, and returns an unpublished **custom** draft or readable errors.

**Rules (`firestore.rules`).** `forms/{teamId}_{formId}`: teammates read, only admins/owner write (same people as `canManageMembers()`), the doc id must be `{teamId}_{formId}`, the form can't move team/id, its
`publishedVersion` never goes down or is cleared, no deletes, bounded doc shape. `forms/{id}/versions/{n}`: teammates read; create-only, by an admin/owner, only together with the parent's `publishedVersion` bump to
that same number (`getAfter`), the embedded form's id must match; no update or delete. `teams.activeForms` is validated (only known season ids, a 1-40 char string). Rules can't validate the nested form element by
element, so every write path runs the shared zod schema first.

**Tests.** `lib/forms/schema.test.ts` (structure, new forms, semantic rules, visibility, every scoring mode, values), `lib/forms/store.test.ts` (custom-form lifecycle, immutability and numbering, publish refusals,
copy-on-write overrides, reset, resolution, export/import, a custom form end to end through scoring / table / CSV / flags / stats, unioned versions and aliases, scoring-off forms), and
`lib/forms/biobuzz-regression.test.ts`: the **frozen old BIOBUZZ** (`lib/forms/fixtures/biobuzz-v1.ts` form + scoring and `biobuzz-v1-game-schema.ts` table; nothing in the app imports them) is the oracle: same fields
and order, same defaults, identical scores on 1,000 seeded random entries, the old adapter output, the dual-write equal to the old save, identical table columns and cells, **byte-identical CSV**, a CSV export that
re-imports to the same values, and the same flags and team stats from old-shaped and new-shaped storage. `firestore.rules.test.ts` ("P21: forms, form versions and teams.activeForms") covers the rules above.


## P22 — Form Builder UI and form management

Admin Panel > **Forms** (`components/forms/forms-panel.tsx`), for the team owner and admins only: `can('manageForms')` (`lib/permissions.ts`, pure `canManageForms` in `lib/forms/permissions.ts`) is the same set as
firestore.rules' `canManageMembers()`, which gates every write to `forms`, `forms/{id}/versions` and `teams.activeForms`. The UI therefore never offers what the rules would refuse, and a forged request is refused by the rules
(tests: `firestore.rules.test.ts`, "P21: forms…"). The tab is hidden for anyone else.

**Forms list.** Every form from `useForms().summaries` (built-in, edited built-in, custom, from template): status (Draft / Published vN / Unpublished changes / Archived), the seasons it is active for, last edited by/when
(`FormDoc.updatedBy/At`, names from `useTeamMembers`), and entry count (`lib/forms/usage.ts` over the team's entries). Actions: Edit, Duplicate, Export JSON, Set as active, View changes from built-in, Reset to built-in,
Archive/Unarchive (a form that is active for a season can't be archived; forms are never deleted: the rules forbid it, and entries must always resolve). **New form**: from scratch (five categories plus the locked system
fields), from template (shown, disabled until P23), duplicate, import JSON (`lib/forms/create.ts`: always a *custom* draft with a unique id; a copy of a built-in is never an override). Editing a built-in is copy-on-write with
a notice; nothing changes for scouts until publish.

**Builder (`components/forms/builder/`).** `builder.tsx` holds the form in an undo/redo history (`lib/forms/history.ts`, 100 steps; edits to one thing within 1.2 s coalesce into one step). Every change goes through
`commit`, which keeps a ref-backed copy so `update(fn)` runs `fn` synchronously and callers can read what it produced (e.g. the id of a field it added, to select it). Panes:
- **Palette** (`palette.tsx`): the nine component types by click or drag, and Insert from BIOBUZZ (clone a category, group or field with its points).
- **Canvas** (`canvas.tsx`, `dnd.tsx`): categories as cards, fields as rows showing key, type and points, groups inside. @dnd-kit drag between categories and groups, plus up/down/duplicate/delete buttons for touch and keyboard.
- **Inspector** (`field-inspector.tsx`, `section-inspector.tsx`, `form-inspector.tsx`, `condition-editor.tsx`, `options-editor.tsx`): every schema v2 property. The key is generated from the label with the alias rule; visibility
  condition builder; points; counter/number/rating settings; options with points; look (size, icon, colour, width, as theme tokens); analytics and CSV header; stat roles; scouting tip; category phase, accent and groups;
  form name, description, tags, scoring on/off and key aliases.
- **Panels** (tabs in the right pane): *Preview* (`preview.tsx`: the real `<ScoutForm/>` in phone/tablet/desktop frames and an "Open as scout" dialog; a test fill with the live score that never writes), *Analytics*
  (`analytics-preview.tsx`: the three-tier header and CSV header row come from `buildGameSchema(form)` itself, plus team stats), *Scoring* (`scoring-summary.tsx`: scoring fields, per-phase and total maximum from `maxScore`,
  and a scenario calculator that uses `calculateScore`), *Problems* (`validation-panel.tsx`: `checkForm` errors and tips; clicking one selects the field).
- Under 1024 px the builder is compact: forms list, read-only structure (no add/move/delete/drag), simple field edits and the preview, with a note that full editing works best on a larger screen.

**Editing logic is pure** (`lib/forms/edit.ts`, tested in `lib/forms/builder.test.ts`): add/remove/move/duplicate field, category and group; `moveFieldBy` (crosses into the neighbouring category); `setFieldKey` (conditions follow;
an alias old to new is added when the old key was ever published, chains collapse, renaming back drops it); `changeFieldType`; bulk `updateFields`; `cloneFields`/`insertFromForm` (fresh ids and unique keys, conditions among the
copies remapped, dangling ones dropped); custom phases with labels. System fields can move within Pre-Match but never be deleted, retyped, duplicated or conditional. `lib/forms/diff.ts` (`diffForms`) compares two forms by
field id, independent of key order, and marks changes "affects scores" / "affects data" (points, a key without an alias, type, options, ranges, scoring on/off, added or removed scoring fields, phase moves).

**Draft, autosave, publish, history.** Edits autosave to the form's draft (`store.saveDraft`) 1.5 s after the last change when the form parses (zod). The header shows Saved / Saving / Unsaved / Not saved yet (and why) / error with
retry; `beforeunload` and Back both flush or warn.
- **Publish** (`publish-dialog.tsx`) shows the diff against the last published version (or the built-in), refuses while `checkForm` has errors, and when the change affects scores or data and the form has entries it says how many,
  points at the Rescore tool and requires an explicit tick. Optional note. The version is one past the latest (an override continues from the built-in's).
- **History** (`history-dialog.tsx`, `store.listVersions`): every version with its entry count, a diff against the version before or against the draft, and **Restore** = put that version into the draft (never straight to
  scouts). The built-in's original is listed at the bottom.
- **Discard changes** (`discardDraftTransition`) goes back to the live version or the built-in; a never-published custom form can only be archived.

**Audit log** (`lib/forms/actions.ts`: one function per user action, each followed by an `auditLog` entry): `create-form`, `publish-form` (version, note, affects scores/data, changes, affected entries), `restore-form-version`,
`discard-form-draft`, `archive-form`, `unarchive-form`, `reset-form-to-builtin`, `set-active-form` (before/after form id). They are labelled in the Audit Log tab. `FormActor` takes injectable `audit`/`setActive`, so the test
fixture runs without Firestore.

**ScoutForm now honours** each field's `ui.size/icon/color/width`, its `tip` (an info popover beside the label or tile) and a category's `accent`: theme tokens only (`components/scout/field-icons.tsx`: `ACCENT_TOKENS`, a curated
icon list). New `checkForm` warnings: a pick-one with more than 6 tiles, a dropdown with more than 12 options, a rating above 7 stars (hard one-handed), and a per-unit number with no maximum.

**Tests.** `lib/forms/builder.test.ts` (editing, keys and aliases, cloning, history, diff, permission, usage, creating forms, discard). `e2e/form-builder.e2e.ts` drives the real Forms tab and builder on `/e2e/form-builder`
(an in-memory store with 12 BIOBUZZ entries, no login; 404 unless `E2E_THEME_CHECK=1`): list actions, new/duplicate/import, the copy-on-write notice, add/rename/autosave/undo/redo, the five default categories and locked fields,
points/conditions/analytics/scoring panels, the preview, publish with the affected-entries confirmation, history, restore, reset, set active, audit entries, buttons and shortcuts, and the phone layout; Chromium and WebKit, desktop and phone.

## P23 — Form templates

**Collection `formTemplates/{id}`** (`FormTemplate` in `lib/templates/build.ts`; times are epoch ms): `visibility` (`private | public-pending | public | rejected`), `ownerTeamId`, `authorName` (the account name, else
"FTC 3468 Name"; "CompEpicurus" for official ones), `official`, `name`, `description`, `tags`, `version` (starts at 1), `form` (the `exportForm` snapshot: no author, dates, status or built-in link), `checksum`
(`formChecksum(form)`), `fieldCount`, `sectionCount`, `importCount`, `reportCount`, `hasPendingUpdate?`, `rejectionReason?`, `createdAt/updatedAt/publishedAt/requestedAt`. Subcollections, all server-written:
`updates/pending` (a public template's next version, `{...content, version, requestedAt}`), `reports/{teamId}` (one per account: `reason`, `at`), `imports/{teamId}` (one per account: counts a use once).
Official templates have fixed ids `official-biobuzz` and `official-blank`.

**Rules** (`firestore.rules`, tests in `firestore.rules.test.ts` "P23: formTemplates"):
- Read: any signed-in user reads `public`; an account reads all of its own (any state); the platform owner reads `public-pending` (to review) and public ones. **A private or rejected template is readable only by its own account:
  not by another account, not by a signed-out user, not even by the platform owner.** List queries must carry the filter (`visibility == 'public'`, `ownerTeamId == my team`, or `public-pending` for the platform owner).
- Write from a browser: the account's admins/owner **create** a template (private, version 1, no uses or reports, not official, no pending update) and **edit/delete only while it is private or rejected** (editing a rejected
  one makes it private again; version never goes down; `importCount`, `reportCount`, `official`, `ownerTeamId` can't change). Everything else is server-only: asking to publish, updates to a public template,
  approve/reject/take down/official/seed, reports and counting a use. So `importCount`, `official` and `visibility` can't be forged, and moderation can't be bypassed. Subcollections: `updates` readable by the author's account
  and the platform owner; `reports` and `imports` by the platform owner only; none writable.

**Server route `POST /api/templates`** (`app/api/templates/route.ts`, logic in `lib/server/templates.ts`, Admin SDK, body capped at 320 KB), actions:
- Author (owner/admin of the owning account): `request-publish` (private/rejected -> `public-pending`), `update-public` (a new version of a public template is stored in `updates/pending` and `hasPendingUpdate` set; the approved
  version stays live), `unpublish` (public/pending -> private, drops a pending update).
- Any account's owner/admin: `import` (returns the template to copy and counts the use once per account, never the author's own) and `report` (a public template that isn't yours, one report per account, reason 3-300 chars).
- Platform owner (live `OWNER_EMAILS` + verified email, same check as P20): `approve` (first review, or promotes a pending update), `reject` (needs a reason: a first review goes to `rejected`; an update is discarded and the public
  version stays), `take-down` (public -> `rejected`, with a reason, unofficial), `set-official`, `dismiss-reports`, `seed-official` (creates BIOBUZZ and Blank from code, or adds a version when their content changed).
- Every request re-validates the template: checksum matches, strict parse, no blocking `checkForm` problems, text free of HTML and links https only, size. Limits (`TEMPLATE_LIMITS`): 3 publish requests/updates per account per hour
  (`rateLimits`), 5 waiting per account, 256 KB per template, reports 10/hour/account. Decisions are written to `platformAuditLog` (`approve-template`, `reject-template`, `takedown-template`, `set-official-template`,
  `dismiss-template-reports`, `seed-official-templates`) and to the author's own audit log (`request-template-publish`, `unpublish-template`, `template-reviewed`); the platform owner is notified (push + email, no-ops when unconfigured)
  of new requests, and the author is emailed the decision (`templatePublishRequested`, `templateDecision`).

**Shared pure code** (`lib/templates/build.ts`, `official.ts`, `lib/forms/sanitize.ts`, `portable.ts`): `buildTemplateContent` (portable snapshot, tags tidied, HTML stripped, https-only links, validated, size-limited),
`formFromTemplate` (a new draft: origin `template`, `templateId` + `templateVersion` recorded, unique id, tags kept), `updateAvailable`, `filterTemplates`/`templateTags` (search over name, description, tags and author; tag filter;
newest or most used), `officialTemplates` (BIOBUZZ built from the built-in form; Blank = the five categories and system fields, scoring off). `exportForm` now carries a content `checksum`; `importForm(input, { repairDuplicates })` strips
HTML (reported in `changes`), refuses non-https links, warns on a checksum mismatch (a warning, not a refusal: it's a damage/edit detector, not a signature), and can repair duplicate ids/keys (`repairDuplicates` in `lib/forms/edit.ts`
renames the later duplicate).

**Client.** `lib/templates/service.tsx` defines `TemplateService` (live lists: public, this account's, the platform owner's queue; create/update/remove for private ones; request/update/unpublish/report/use; the platform
owner's approve/reject/takeDown/setOfficial/dismissReports/seedOfficial). `firestore-service.tsx` is the real implementation (`TemplatesProvider`: direct Firestore writes only for private templates, `/api/templates` for the rest,
audit entries `save-form-template`, `update-form-template`, `delete-form-template`, `use-form-template`); `memory-service.ts` is an in-memory twin for the Playwright fixture. UI (`components/templates/`): `template-library.tsx` (Public /
My templates tabs; search, tag chips, sort; Preview with the real form and a test fill, Use template, Export JSON, Report; own: Edit details, Update from a form, Request to publish, Send an update, Unpublish, Delete),
`template-card.tsx`, `template-dialogs.tsx`, `update-available-dialog.tsx`, `review-panel.tsx` (Admin Panel > **Template Review**, platform owners only: waiting for review, updates waiting (with a diff), reported (with reasons),
all public templates, Seed official templates). In the Forms tab: a Forms / Templates switch, **Save as template** on every form card, "From template" in New form, and **Update available** (badge + Review update) on a form whose source
template has a newer version: the dialog shows `diffForms(your form, new version)` and creates a **new draft**; it never changes your form. New form > Import JSON is now two steps: **Check file** shows what will be created
(`components/forms/import-preview.tsx`: categories, field and scoring counts, what was stripped or fixed, warnings, or the errors, with "Fix automatically" when only duplicates are wrong), then **Create form**.

**Tests.** `lib/templates/templates.test.ts` (sanitizing, building, using, update-available, library search/tags/sort, import/export checksum, HTML, https, duplicates, official templates), `firestore.rules.test.ts` (read matrix including
no private leakage, create/edit/delete rules, server-only fields and subcollections), `api-routes.emulator.test.ts` "P23 templates" (publish requests, server re-validation, rate and pending limits, approve/reject/take-down/official,
public updates held for review then promoted or discarded, use counting once per account, no access to others' private templates, reports, seeding and version bumps), and `e2e/templates.e2e.ts` (the library, review panel, update
flow and import preview in Chromium and WebKit, desktop and phone).

## P24 — The practice scouting workspace

**One shared layout** (`components/practice/scouting-workspace.tsx`, `ScoutingWorkspace`) used by the solo practice screen (`session-screen.tsx`), Live (`live/live-session-screen.tsx`) and the lobby
(`lobby/lobby-session-screen.tsx`). The screens keep their own header chips, state, saving and dialogs and hand the workspace content: `video` (a node, or `null` for a lobby host who isn't the displayer), `videoNote`
(small toolbar text such as the Competitive note), `form`, `actions` (the buttons of the pinned bar), `notice` (error banners, shown above the bar) and `comments` (turns the drawer on). Tests assert all three screens render it.

- **Page lock.** While mounted the workspace sets `html[data-workspace]` (`overflow: hidden`, in `app/globals.css`), sizes itself to the rest of the window (`max(420px, 100dvh - its top - 0.75rem)`, re-measured with a
  ResizeObserver and on resize), and puts the page back at the top if anything nudges it (`scrollIntoView`, focus). A window shorter than 520px keeps its page scroll instead of clipping the workspace.
- **Video.** `VideoStage` measures its pane (ResizeObserver, coalesced to one update per frame) and sizes a box to the largest 16:9 that fits (`fitContain`, `lib/workspace/layout.ts`), centered both ways on a subtle dark
  letterbox. `VideoPlayer`, `MockVideoPlayer` and `YouTubePlayer` take a `fill` prop and fill that box (the mock's picture area takes the room its controls leave); the Live iframes are `h-full w-full` in it.
- **Form pane (tablet and desktop, >= 768px).** `video pane | divider | form panel`. The divider is `role="separator"` (vertical), focusable, with a hover/drag/focus glow; drag it, use ArrowLeft (form grows) / ArrowRight
  (shrinks), Shift for big steps, Home (minimum) / End (maximum), double-click to reset. Limits: at least 320px and at most 60% of the workspace (`clampFormWidth`). The width is stored as a share of the workspace
  (so a resized window keeps the proportion), saved per user in `users/{uid}.workspaceFormWidth` (debounced) and in `localStorage` as the fallback; the account's value wins, and a value only this browser had is saved to the
  account once. The value used at pointer-up is the last one dragged to (kept in a ref: a fast drag can end before React re-renders the last move).
- **Phone (< 768px).** The video pinned at the top, a row with the comments button, a drag handle (`role="separator"`, horizontal: drag, ArrowUp/ArrowDown, Home/End, double-click resets; the video's share of the
  height is clamped to 20-70% and saved in `workspacePhoneSplit`) and a button that shrinks the video to a 96px mini player; the form below scrolls in its panel with the action bar pinned.
- **Form panel.** The form scrolls in its own box (`workspace-form-scroll`); the action bar is a separate, non-scrolling sibling under it (so it stays pinned), and the score bar sticks to the bottom of the scroll box,
  above it. `ScoutForm` in the side-panel layout now has sticky section headers (`glass-strong`).
- **Focus mode.** The Focus button or `F` collapses the form to a 44px strip (and hides the app sidebar and mobile top bar through `lib/shell-immersive.tsx`, which `app/(app)/layout.tsx` owns); the strip or `F` brings it back.
  The form stays mounted while hidden, so nothing entered is lost. **Fullscreen** fullscreens the whole workspace (video and form). Because only the fullscreen element is visible, `Dialog` and `SelectContent` portal into
  `document.fullscreenElement` when there is one (`lib/portal-container.ts`), so the break menu and confirms still show.
- **Comments drawer.** `commentsMode` on `ScoutForm` (`'inline'` | `'popout'`; default `'popout'` for `layout="side-panel"`, `'inline'` otherwise, and inline whenever there's no `onCommentsChange` or the form has no field
  with the `comments` stat role). In popout mode the form leaves that field out and uses `comments` / `onCommentsChange` as its value (the caller owns the text; the value still goes into the submitted entry like any
  field). The workspace shows a tab on the video pane's right edge (a button in the handle row on phones) with a dot when there's text, and opens a drawer with an auto-growing textarea, headed with the robot
  (`Robot 1: #1234`). On tablet and desktop it **pushes the video aside** (the stage re-fits beside it) instead of covering the player's controls; on phones it is a sheet over the form area, above the action bar. It is
  non-modal (no focus trap), never touches playback, takes focus only when opened (tab or `C`), and `Esc` closes it (and lets go of its text box, so `C` works again). The solo screen clears it for each robot.
- **Shortcuts** (`shortcutFor`, pure): `F` Focus, `C` comments, `Esc` closes the drawer; ignored while typing in a field, with Ctrl/Cmd/Alt, and while a dialog is open.
- **Competitive / Trial.** Nothing here adds a pause control or scrubbing; the player's own lock (`lockPause`) is untouched. The divider, drawer and action bar don't overlap the player's controls (a test checks it).

**Persistence.** `lib/workspace/use-workspace-prefs.ts`; two new optional fields on the user doc (`UserDoc.workspaceFormWidth`, `workspacePhoneSplit`, shares between 0 and 1). The existing "a member updates their own
non-role fields" rule already allows them (no rules change); `firestore.rules.test.ts` ("P24: users/{uid}.workspaceFormWidth…") proves a member can save theirs and can't set anyone else's or smuggle in a role.

**Tests.** `lib/workspace/layout.test.ts` (fit, clamping, share conversion, resolving and storing, keyboard steps, phone split, shortcuts, blocked storage); `e2e/practice-workspace.e2e.ts` on the fixture page
`/e2e/practice-workspace` (404 unless `E2E_THEME_CHECK=1`: the real workspace, `ScoutForm` and placeholder video in the two-robot flow): the video is 16:9, centered and as large as fits; the page doesn't scroll; the form scrolls
inside its panel with the video and action bar fixed; tablet size; divider limits, keyboard and double-click; persistence across a reload; Focus and fullscreen; comments per robot ending up in the submitted entry for the
right robot; Competitive and Trial; the phone's handle, mini player and sheet. Screenshots go to `e2e/screenshots/` (git-ignored). `lib/mobile.test.ts` (P17) now checks the workspace carries the safe-area padding and that all three
screens use it.

## P25 — Member profiles (public / private)

**Data.** `profiles/{uid}` (one per member, created on their first save; until then the defaults apply): `teamId`, `displayName` (<= 40, profile only), `bio` (<= 280, plain text), `pronouns` (<= 30), `avatar {type: 'google'|'initials'|'preset', value}`,
`visibility: 'public'|'private'` and `updatedAt`. No uploads exist anywhere: a Google picture is an `https://lh*.googleusercontent.com/...` URL, a preset is an id from `AVATAR_PRESETS` (a gradient and a glyph drawn in the browser), initials are computed. The avatar is
**also mirrored on `users/{uid}.avatar`** (written in the same batch) because teammates can always read user docs and the limited "private" card must still show a picture; bio, pronouns and display name live only in the profile doc.

**Code** (`lib/profile/`): `config.ts` (**`DEFAULT_PROFILE_VISIBILITY`** — the one constant that sets what a profile is before its owner chooses —, the length limits, the presets, `RECENT_SESSIONS_SHOWN`, the badge thresholds), `model.ts` (the doc, `parseProfile`, `sanitizeBio/Pronouns/DisplayName`,
`effectiveVisibility`, `profileAccess`, `canModerateProfile`, `visibilityToSave`, avatar validation), `streak.ts`, `badges.ts` (the single list of achievements), `stats.ts` (`computeProfileStats`, `eventTargetProgress`), `format.ts`, `service.tsx` (`useProfile`, `saveOwnProfile`, `clearProfileText`).
All the logic is pure and unit-tested (`lib/profile/profile.test.ts`); the hooks only wire it to Firestore.

**Visibility.** `visibility` stores the member's **preference**; what applies is computed: `effectiveVisibility()` is public for an admin (the owner's admin flag always stays on) and the preference otherwise. The rules compute the same thing from the target's user doc,
so **promoting someone applies at once and demoting them brings their saved preference back, with nothing rewritten**. An admin's toggle in Settings is disabled with an explanation, and the rules refuse an admin changing `visibility` (their first save is `public`).

**Rules** (`firestore.rules`, `profiles/{uid}`): `get` only (no list) by the member, by an admin of the same team, or by a teammate when the profile is public or its owner is an admin; `resource == null` is readable by a teammate (so "no profile yet" is not an error). Create/update only by the member,
with the field list, lengths, avatar shape and a server `updatedAt` validated. The one other write is **moderation**: an admin of the same team can update a teammate's profile **only** to clear `bio` and `pronouns` to `''` (nothing else may change), never the owner's. Deletes are denied. The `users` rules gained
`validUserAvatar` on a member's own update, and an admin's role edit can no longer touch another member's `avatar`.

**Pages.** `/people/:uid` and `/profile` (your own) both render `ProfileView` (`components/profile/profile-view.tsx`): the data adapter (members, `useProfile`) over `ProfileScreen` (`profile-screen.tsx`, the page chrome and the one privacy decision), which shows `LimitedProfileCard` or
`ProfileBody` (header + activity). A denied read (a private profile seen by a non-admin teammate) is treated as "private", never as an error, and **the activity section is not mounted** in that case, so that viewer's browser doesn't load the scouting data for it either. Your own page has **Edit**
(→ `/account#privacy-profile`) and **View as others see it**, which re-runs the same access decision as a non-admin teammate and says what they would see. The People page cards link to `/people/:uid`, and the sidebar name and picture open `/profile`. `Avatar` (`components/ui/avatar.tsx`) takes an optional `avatar`
(the Team Management rows and People now show them; leaderboards and the credits board still use initials).
**Settings > Privacy and profile** (`components/profile/privacy-profile-section.tsx`, a section of the Account page): picture picker, display name, pronouns, bio with a counter, the visibility choice and the honest-limits note (see P25-3).

**Profile content.** Header (avatar, name, pronouns, primary role in its colour, secondary roles, FTC team chips from P19, Owner/Admin badge, bio, "Joined" from the user doc's `createdAt`, "Last active"). **Accuracy**: Trial / Competitive / Real Event cards are the existing `MyScoutingCard`, fed by
`computeScoutStats` (the engine Scout Accuracy and My Scouting use, called per category with `rankingBasis: "preserve"` and the default Real Event scope), so exclusions, the default calculation and the rank are exactly theirs. **Practice scouting**: the last five sessions across Trial and Competitive with a PC/Mobile badge,
the session count and the practice streak. **Events**: events attended (the attendance list), Real Event entries per event, and **target completion at the current event** (the primary active event) from the P16 setup: the member's manual targets, else the matches Assignments gives them. **Achievements**: computed in the browser
from `BADGES` (First Session, 10 Sessions, 50 Sessions, 100% Session, Excellent status, 5-Day Streak, Event Veteran, Perfect Alliance); nothing is stored. Every section has an empty state, and a skeleton holds the page's shape while the team's data loads.

**Moderation.** An admin sees **Clear bio & pronouns** on a teammate's profile when there is text, with a confirmation. `clearProfileText` writes the profile update and a `clear-profile-text` `auditLog` entry (what was removed) in **one batch**. The rules allow only that clear and never new text. (Rules can't require the audit entry to exist; the client
always writes both in the batch, and the Audit Log tab lists them as "Cleared Profile Bio / Pronouns".)

**Tests.** `lib/profile/profile.test.ts` (visibility, sanitization, avatars, streaks, badges, the stats adapter over fixtures, target progress, display helpers); `firestore.rules.test.ts` ("P25: profiles/{uid} and the users/{uid}.avatar mirror": public/private reads, owner/admin reads, forced-public admins, promotion and demotion,
create/edit rules, no one writing someone else's, validation, moderation limits, the owner protection, the audit batch, the avatar mirror); `e2e/profiles.e2e.ts` on the fixture `/e2e/profiles` (all four browser projects: the full profile with fixed data, the private card with nothing else in the DOM, admin and own views, the preview toggle, empty states,
no layout shift, moderation, the Settings editor incl. an admin's disabled toggle, sanitized saves and failures, light and dark screenshots).

## FIX4 — Profiles, Credits, Active Events, Match List

- **Profiles.** `ProfileEditorForm` (`components/profile/privacy-profile-section.tsx`) takes `onSetVisibility(visibility)`: Public/Private saves the moment it is chosen (the section implements it with `saveOwnProfile` and the *stored* text), separate from "Save profile"; the form's key no longer includes visibility. `ProfileScreen` never shows the limited card for your own profile (`ownReadFailed` shows it in full with a note). `useProfile` re-opens a permission-denied listener every `DENIED_RETRY_MS` (20 s). No rules change; the FIX4 rules tests ("every viewer x every state") pin the behaviour.
- **Credits.** `CreditsBoard` props: `admin` (may edit), `editing` (default `false`); controls need both. `components/credits/credits-edit-toggle.tsx` (`CreditsEditToggle`: Edit credits / Done, confirm and `beforeunload` while a save is in flight; nothing for non-admins). The page keeps `editing` in plain component state (never persisted).
- **Active events.** `lib/active-events.ts`: the primary is always `events[0]`. New: `moveActiveEvent(state, code, toIndex)`, `reorderActiveEvents(state, codes)`; `setPrimaryActiveEvent` = move to 0; `readActiveEvents` moves a stored primary to the front; `buildActiveEventsFields` writes `activeEventCodes[0] === activeEventCode`. **`firestore.rules` `validActiveEvents()`** now requires that. `components/event/selected-events-panel.tsx`: props `onMove(code, toIndex)` replace `onMakePrimary`; dnd-kit sortable cards (`SortableEventCard`) with grip, up/down and star; condensed bar chips are the event code with the name as `title`. Fixture: `/e2e/event-panel`.
- **Match List** (`/match-list`, open to every role; nav item "Match List"). `lib/match-list/model.ts` (pure, tested): `buildMatchRows` (rows with `label` P/Q/SF/F, `startMs`, `status` upcoming/in-progress/completed, `ours`, `isNext`), `MATCH_LIST_TABS`, `tabCounts`, `rowsInTab`, `defaultTab`, `filterRows` (Our matches + team-number search), `winnerOf`, `formatStart`, `IN_PROGRESS_WINDOW_MS`. `components/match-list/match-list-screen.tsx` (`MatchListScreen`, plain props) and `match-list-view.tsx` (`MatchListView`: `useActiveEvents`, `useEventMatches`, `useIsOurTeam`, a 1-minute clock and a 3-minute refresh while visible). `useEventMatches` now also returns `updatedAt`, `refreshing`, `refresh()`. Fixture: `/e2e/match-list`.

## P26 — Page access and role gating

**Collections.** `teams/{teamId}/settings/pageAccess` (one doc: `roleGrants`, `memberOverrides`, the rules mirror `pageRoles`, `updatedBy`, `updatedAt`; teammates read, admins write; see ASSUMPTIONS P26-3) and `teams/{teamId}/pageAccessRequests/{uid}_{pageId}` (`uid`, `name`, `pageId`, `pageTitle`, `status`, `createdAt`, `decidedBy?`, `decidedAt?`; the requester and admins read, the requester creates their own pending one, admins decide). Audit actions `edit-page-access`, `decide-page-access-request`.

**Shared modules** (`lib/page-access/`): `pages.ts` (**`PAGES`**, `RESTRICTED_PAGES`, `getPage`, `pageForPath`: declare a new page's access HERE), `access.ts` (**`canAccessPage(user, pageId, config)`**, `explainAccess`, `accessiblePages`, `defaultPageAccessConfig`, `parsePageAccess`, the pure editors `setRoleGrant` / `setMemberPageState` / `grantMemberPage`, `pageRolesOf`), `nav.ts` (`visibleNav`), `store.tsx` (`PageAccessProvider` + `usePageAccess()` → `{ config, loaded, can }`, `useAccessUser()`, `updatePageAccess(actor, apply, change)` and `decidePageAccessRequest` (transactions), `requestPageAccess`, `usePageAccessRequests`, `ensurePageAccessDoc`). **`usePermissions().can()`** gained `editAssignments` and its `editScoutTargets` now follows page access.

**Enforcement.** UI: the sidebar (`visibleNav`), `components/page-access/page-guard.tsx` (`PageGuard`, mounted in `app/(app)/layout.tsx` inside `PageAccessProvider`; a restricted page the person can't open shows `NoAccessScreen` with Request access). Rules: `pageAccessAllowed(pageId, defaultRoles)` (a function in `firestore.rules`, the twin of `canAccessPage`) gates create/update of `assignments`, `eventAttendance` and `scoutTargets`; P27's `formEntries` should use it for the gated forms. **Not enforced by rules** (UI only, because the data feeds other pages): Scout Accuracy, Scout Status reading, Event Selection, Team Management reading, Assignments reading. See ASSUMPTIONS P26-6.

**UI.** `components/page-access/`: `parts.tsx` (`RoleMatrix`, `MemberAccessEditor`, `PreviewAsMember`, `RequestsList`), `page-access-panel.tsx` (`PageAccessPanelView` plain props; `PageAccessPanel` connected = Admin Panel > Page Access; `MemberAccessDialog` = Team Management's per-member "Page access"), `no-access-screen.tsx`, `page-guard.tsx`. Fixture `/e2e/page-access`.

## P27 — Form system extensions

**Schema (`lib/forms/types.ts`, `validate.ts`).** `FormType` (`FORM_TYPES`), `REQUIRED_SYSTEM_FIELDS`, `SYSTEM_FIELD_KEYS`, `isSystemField` (a system-typed field under its fixed key). New `FieldType`s: `slider`, `image`, `sequence`, `matrix` (user types) and `eventPicker`, `alliancePicker` (system). Field settings: `endLabels`, `ticks`, `maxCount`, `capture`, `steps: SequenceStep[]`, `rows` / `cols: MatrixAxis[]`, `disabledCells`. `FormGroup.repeat: GroupRepeat`. `Form.stickyNotes: StickyNotesConfig`, `Form.compareWith: CompareWith`. Value types `FormValue`, `ImageValue`, `StickyNote`. New `checkForm` codes: `slider-*`, `sequence-*`, `matrix-*`, `repeat-*`, `compare-*`, `system-field-key`, `team-picker-key`.

**Pure modules (`lib/forms/`).** `repeat.ts` (`slotKey`, `parseSlotKey`, `valueSlots`, `slotCountFor`, `repeatGroupOf`, `maxRepeatSlots`), `sequence.ts` (`normalizeSequence`, `addStep`, `canAddStep`, `moveStep`, `removeStep`, `isMovable`, `summarizeSequence`, `countSteps`, `parseSequenceSummary`), `compare.ts` (`findPlanEntry`, `expandFieldMap`, `diffAgainstPlan`, `prefillFromPlan`, `plannedText`, `differenceSummary`, `sameValue`), `values.ts` (`matrixCells`, `coerceImages`, `joinNotes`; defaults, coercion, normalising and required checks for every new type and slot), `edit.ts` (`setGroupRepeat`, `setFormStickyNotes`, `setFormCompareWith`, `setFormType`, `defaultTeamPicker`, `addSystemField`, `missingSystemFields`), `new-form.ts` (`systemFieldsFor(formType)`, `createBlankForm({ formType })`).

**Entries.** `lib/form-entries-model.ts` (`FormEntry`, `formEntryDoc`, `toFormEntry`, `formEntryToRow`, `formMatchKey`, `parseFormMatchKey`; no Firestore client) and `lib/form-entries.ts` (`saveFormEntry`, `updateFormEntry`, `deleteFormEntry`, `useFormEntries`). `ScoutEntry` gained optional `stickyNotes`, `alliance`, `linkedEntryId`, `planDifferences`; `entryPayloadFor(form, values, score, { stickyNotes })` and `derivedComments`. **`formEntries/{entryId}`** rules (`formEntryCreateAllowed`, `validFormEntry`) and indexes: see ASSUMPTIONS P27-8.

**Analytics and CSV.** `AnalyticsColumn` gained `valueKey`, `parseCell`, `derived`; `ColumnType` gained `notes` and `photos` (drawn in `components/analytics/data-table.tsx`). `buildGameSchema` derives per-slot, per-cell, per-step and photo-count columns, a Notes column (when the form has sticky notes) and a Differences-from-plan column. CSV export/import in `lib/analytics/csv.ts` use them.

**Renderer.** `components/forms/form-renderer.tsx` (`FormRenderer`, `FormEntryState`), `team-select.tsx`, `plan-diff-icon.tsx`, `photo-field.tsx`, `photo-upload.tsx` (`PhotoUploadProvider`, `usePhotoUploads`, `PhotoTarget`), `components/scout/sequence-field.tsx`, `SliderField` / `MatrixField` in `components/scout/field-inputs.tsx`; `RenderedField` takes `storageKey`, `teams`, `photoTarget`, `onPendingPhotos`, `planNote`. Builder: `p27-inspectors.tsx`, `p27-form-settings.tsx`, `generic-preview.tsx`, the palette's Pickers section. Fixture `/e2e/form-renderer`.

**Photos (Vercel Blob).** `lib/blob/` (`paths.ts` path building and parsing, `compress.ts`, `client.ts`, `upload-queue.ts`), `lib/server/blob-auth.ts` (`authorizeBlobUpload`, `authorizeBlobDelete`, `pageIdForForm`), routes `app/api/blob/upload` and `app/api/blob/delete`. Setup: `docs/DEPLOYMENT.md` section 13.

## P28 — Sticky notes and the match-based forms

**Built-in forms** (`lib/forms/builtin-team-forms.ts`): `LEAD_SCOUT_FORM` (`lead-scout-v1`), `MATCH_STRATEGY_FORM` (`match-strategy-v1`), `DRIVE_REFLECTION_FORM` (`drive-reflection-v1`), in `BUILTIN_FORMS` (and as official templates in `lib/templates/official.ts`). `BIOBUZZ_FORM` has `stickyNotes: { enabled: true }`. `canBeActive` (`lib/forms/resolve.ts`) is true only for match-scout forms.

**Sticky notes.** `lib/sticky-notes.ts` (pure: `newNote`, `addNote`, `editNote`, `deleteNote`, `setNoteColor`, `togglePin`, `sortNotes`, `noteCount`, `notesForSave`, `NOTE_COLORS`, `clampPanelWidth`), `components/forms/sticky-notes-panel.tsx` (`StickyNotesList`, `StickyNotesPanel`, `StickyNotesLayout`). Entries store `stickyNotes: StickyNote[]`; `entryPayloadFor(..., { stickyNotes })` derives `comments`. The practice workspace's `WorkspaceComments` is now `{ notes, onChange, label }` (`components/practice/scouting-workspace.tsx`), used by the solo, live and lobby screens.

**Form pages.** `lib/forms/form-page-logic.ts` (`allianceTeamsFor`, `allianceTitle`, `resetSlotValues`, `trimSlots`, `validateSubmission`, `buildSubmission`), `components/forms/form-page.tsx` (`FormPageView`, plain props), `form-page-connected.tsx` (`FormPage`: live data, the existing `MatchPickerDialog`, `saveFormEntry`), `form-renderer.tsx` gained `sectionTitle` and `tintedSections`. Routes `app/(app)/{lead-scout-form,match-strategy-form,drive-reflection-form}/page.tsx`; nav items in `lib/nav.ts`; page ids and default roles in `lib/page-access/pages.ts` (P26). Fixture `/e2e/form-page`.

## Conventions

- **IDs**: Firestore auto-ids for `scoutEntries` and, since P1b, `teams`
  too; the Firebase Auth `uid` for `users`; the fixed path `appSettings/global`
  (P1b) for the one settings doc.
- **Timestamps**: `createdAt` is always `serverTimestamp()`. Where a value
  needs to be usable immediately offline (e.g. `ScoutEntry.submittedAt`), a
  client-set ISO string is stored alongside it instead of relying on the
  server timestamp resolving.
- **`teamId` everywhere**: every collection's documents and every Firestore
  query/rule includes `teamId`. In practice there's still almost always just
  one (team creation locks itself after the first), but nothing in the code
  assumes that anymore as of P1b.
- **`source` / `mode`**: `source` distinguishes Real Event vs. practice vs.
  live (P2+); `mode` is reserved, currently always `null`.
- **Realtime vs. one-shot reads**: anything team-wide and likely to change
  while someone's looking at it (active event/season, team roster,
  `scoutEntries` for the active event) uses `onSnapshot`; one-off reads
  (CSV import's dedupe check, etc.) use `getDocs`/`getDoc`.
