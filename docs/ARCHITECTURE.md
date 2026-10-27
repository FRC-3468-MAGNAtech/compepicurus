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
| `number` | `number` | FTC team number |
| `name` | `string \| null` | Optional team name (P1b) |
| `joinCode` | `string` | Random 6-char code (no ambiguous 0/O/1/I). No longer publicly readable (P1b — see `firestore.rules` and P1b-1); only a team's own members can read it, mainly so Team Management can show it to admins |
| `activeEventCode` | `string \| null` | FIRST API event code |
| `activeSeasonId` | `number \| null` | FIRST API season year |
| `activeEvent` | `FtcEvent \| null` | Denormalized full event object (P1-5) so pages don't need a second API round-trip just to show the active event's name/dates |
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
| `primaryRole` | `RoleId` | One of `lib/roles.ts`'s `ROLES`; shown as a colored pill |
| `secondaryRoles` | `RoleId[]` | Shown as neutral pills |
| `isAdmin` | `boolean` | Separate from roles — gates Admin Panel + team/event management |
| `isOwner` | `boolean` (P1b) | Set only by `app/api/auth/sync-roles` (Admin SDK) for emails listed in `OWNER_EMAILS`; immutable from any client, in rules, for every uid including the owner's own (see P1b-3) |
| `themeId` | `string` | Applied once the profile first loads (see `app/(app)/layout.tsx`) |
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

### `auditLog/{id}` (P5)

One entry per admin-only scout-data action (Hard Reset, Dismiss Flag,
Exclude/Include — see `lib/scout-stats/actions.ts`). Write-once: nobody,
including admins, can update or delete an entry, so it stays a trustworthy
record. Not read by any page yet — P9's Admin tools will.

| Field | Type |
|---|---|
| `teamId`, `uid` (the actor), `actorName` | `string` |
| `action` | `"hard-reset-scout-data" \| "dismiss-flag" \| "exclude-session" \| "include-session"` |
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
  fixed id; see P1b-1) and `setActiveEvent(teamId, event)` (admin-gated at
  call sites via `usePermissions()`, enforced again in `firestore.rules`).
- `lib/active-event.tsx` — thin shim over `lib/team.ts` so every existing
  consumer (Event Selection, Scout Form, Match Analytics) keeps calling
  `useActiveEvent()` with no arguments — it resolves `teamId` from
  `useAuth().profile` internally.
- `lib/team-members.ts` — `useTeamMembers(teamId)` (realtime roster) plus
  `setMemberPrimaryRole`/`setMemberSecondaryRoles`/`setMemberAdmin`. Backs
  both Team Management (editable) and People (read-only). `TeamMember` now
  carries `isOwner` too (P1b).
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
- `components/layout/connection-status.tsx` — the nav Online/Offline/"N
  pending sync" indicator, scoped to the active event's entries.
- `components/team/member-row.tsx` — shared member display, editable
  (admin) or read-only, used by Team Management and People.

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
