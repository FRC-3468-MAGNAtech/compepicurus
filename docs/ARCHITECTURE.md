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
  **Real Event**. Modeled by `ScoutEntry.source` / `mode` (see below) —
  `source: "event"` is "Real Event" today; P2+ introduces `"practice"` and
  `"live"` for the other two.
- **Session**: one practice-scouting run, identified by a Session ID (P2+).
- **Library match**: an imported official match used for practice scouting
  (P2+).
- **Scout entry**: one submitted match scout form for one robot —
  `scoutEntries/{entryId}`.

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

All collections are scoped by `teamId`. There is only one team today
(`teams/default` — see P1-3), but every query and rule is written as if
there could be more, so multi-team support later doesn't need a rewrite.

### `teams/{teamId}`

| Field | Type | Notes |
|---|---|---|
| `number` | `number` | FTC team number |
| `joinCode` | `string` | Random 6-char code (no ambiguous 0/O/1/I), shown to admins only in the UI; the *document* itself is publicly `get`-able — see P1-4 |
| `activeEventCode` | `string \| null` | FIRST API event code |
| `activeSeasonId` | `number \| null` | FIRST API season year |
| `activeEvent` | `FtcEvent \| null` | Denormalized full event object (P1-5) so pages don't need a second API round-trip just to show the active event's name/dates |
| `firstAdminClaimed` | `boolean` | Flips `false → true` once the team's first admin user doc exists — closes the admin-bootstrap hole (see P1-6 and `firestore.rules`) |
| `createdAt` | `Timestamp` | |

Fixed document id `"default"` (exported as `TEAM_ID` from `lib/auth.tsx`).

### `users/{uid}`

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | |
| `email` | `string` | Mirrors the Firebase Auth email |
| `teamId` | `string` | Always `"default"` today |
| `primaryRole` | `RoleId` | One of `lib/roles.ts`'s `ROLES`; shown as a colored pill |
| `secondaryRoles` | `RoleId[]` | Shown as neutral pills |
| `isAdmin` | `boolean` | Separate from roles — gates Admin Panel + team/event management |
| `themeId` | `string` | Applied on login (see `app/(app)/layout.tsx`) |
| `createdAt` | `Timestamp` | |

Document id is the Firebase Auth `uid`.

### `scoutEntries/{entryId}`

| Field | Type | Notes |
|---|---|---|
| `teamId` | `string` | |
| `uid` | `string` | Who's allowed to write this doc per rules — for CSV imports this is the *importing admin's* uid, not a fabricated mapping from the free-text `scoutName` (see P1-7) |
| `source` | `"event"` | P2+ adds `"practice"` and `"live"` |
| `mode` | `null` | Reserved for P2+ |
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

## Shared modules

- `lib/firebase/client.ts` — initializes the Firebase app once, exports
  `auth`/`db` (Firestore with `persistentLocalCache` +
  `persistentMultipleTabManager` for offline support), and
  `isFirebaseConfigured()`. Every real consumer checks that first so a
  missing `.env.local` config doesn't crash the whole app on import.
- `lib/auth.tsx` — `AuthProvider`/`useAuth()`. Firebase `onAuthStateChanged`
  + a live `onSnapshot` on the signed-in user's own `users/{uid}` doc.
  Exposes `login`, `signup`, `firstRunSetup`, `logout`, `resetPassword`,
  `changePassword`, `updateUserProfile`. `TEAM_ID = "default"` lives here.
- `lib/team.ts` — `useTeamDoc()` (realtime `onSnapshot` on `teams/default`)
  and `setActiveEvent()` (admin-gated at call sites via `usePermissions()`,
  enforced again in `firestore.rules`).
- `lib/active-event.tsx` — thin shim over `lib/team.ts` so every existing
  consumer (Event Selection, Scout Form, Match Analytics) keeps calling
  `useActiveEvent()` unchanged.
- `lib/team-members.ts` — `useTeamMembers(teamId)` (realtime roster) plus
  `setMemberPrimaryRole`/`setMemberSecondaryRoles`/`setMemberAdmin`. Backs
  both Team Management (editable) and People (read-only).
- `lib/roles.ts` — the 9-role config (`ROLES`, `RoleId`, `getRole`,
  `DEFAULT_ROLE_ID`), each with a fixed Tailwind color token.
- `lib/permissions.ts` — `usePermissions()` → `{ isAdmin, can(action) }`.
  Actions so far: `"manageTeam"`, `"manageScoutData"` (both admin-only).
  Later prompts add actions here.
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
  every time `onAuthStateChanged` fires (covers login, signup, first-run
  setup, and restoring a session on page load) to keep this cookie in sync
  with the client Firebase SDK's auth state, and also awaits it explicitly
  inside `login`/`signup`/`firstRunSetup` before those functions return — so
  a caller that redirects immediately after doesn't race the cookie write
  and see a spurious "unauthorized" error on the very next FIRST API call.

## Conventions

- **IDs**: Firestore auto-ids for `scoutEntries`; the Firebase Auth `uid` for
  `users`; the fixed string `"default"` for the one `teams` doc.
- **Timestamps**: `createdAt` is always `serverTimestamp()`. Where a value
  needs to be usable immediately offline (e.g. `ScoutEntry.submittedAt`), a
  client-set ISO string is stored alongside it instead of relying on the
  server timestamp resolving.
- **`teamId` everywhere**: every collection's documents and every Firestore
  query/rule includes `teamId`, even though there's only one team right now.
- **`source` / `mode`**: `source` distinguishes Real Event vs. practice vs.
  live (P2+); `mode` is reserved, currently always `null`.
- **Realtime vs. one-shot reads**: anything team-wide and likely to change
  while someone's looking at it (active event/season, team roster,
  `scoutEntries` for the active event) uses `onSnapshot`; one-off reads
  (CSV import's dedupe check, etc.) use `getDocs`/`getDoc`.
