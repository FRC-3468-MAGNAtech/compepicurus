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
