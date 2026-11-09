# Assumptions

Every judgment call made while implementing a prompt is logged here,
prefixed with that prompt's ID, so later prompts (and future-you) know why
something is the way it is without re-deriving it.

## P1 — Firebase Foundation, Accounts, Team Management & Roles

**P1-1. Stack mismatch with the source prompt.** The prompt template assumes
Vite + React Router and a plain `.env`. This repo is Next.js App Router with
`.env.local`. All guidance was adapted: `NEXT_PUBLIC_` prefix for
browser-exposed env vars (Next.js requirement — Firebase's web config isn't
secret, security comes from `firestore.rules`), client-side route guards in
`app/(app)/layout.tsx` and the login/signup pages (no `middleware.ts` exists
yet), and Server Actions already keeping the FIRST API key server-side.

**P1-2. No Cloud Function for the FIRST API.** The prompt's concern (API key
exposed in the browser bundle) was already solved before P1 — FIRST API
calls go through `lib/ftc/actions.ts` Server Actions. No Cloud Function was
added, so Firebase stays on the free Spark plan.

**P1-3. Single fixed team doc id (`teams/default`).** Rather than a randomly
generated id, this makes "does a team exist yet" trivial (`get()` on one
known path) and lets the one-time-creation rule be expressed safely
(`!exists(...)`). Multi-team support later would need a real id scheme and a
team-selection step — explicitly out of scope per the prompt.

**P1-4. The team doc is publicly `get`-able (not `list`-able).** This lets
first-run detection and join-code validation work entirely client-side,
before the caller is authenticated, with no Cloud Function needed. The join
code is treated as an organizational gate ("someone on the team told you the
code"), not a cryptographic secret — acceptable for one small team's
internal tool. A `list` query against `teams` is still denied, so this
doesn't enable enumerating teams once multi-team support exists.

**P1-5. `activeEvent` is denormalized onto the team doc.** Storing the full
`FtcEvent` object (not just `activeEventCode`/`activeSeasonId`) means every
page reading "what's the active event" doesn't need a second FIRST API
round-trip. Refreshed whenever an admin calls `setActiveEvent()`.

**P1-6. Admin-bootstrap race window.** The very first admin can't go through
normal signup (no join code exists yet — nobody could have handed it out).
`firstRunSetup()` creates the Auth account, then the team doc (with
`firstAdminClaimed: false`), then this user's own doc as admin (allowed by
`firestore.rules` only while `firstAdminClaimed` is false), then flips
`firstAdminClaimed` to `true`. Between the third and fourth steps there's a
narrow window where a second concurrent caller could also create themselves
as an admin for the same team. On a free Spark plan with no Cloud Function,
this can't be closed atomically; it's accepted as a v1 limitation given the
app is only reachable by people who already know it exists, at the moment
the team is first being set up. A Cloud Function (if the team later upgrades
to Blaze) could close this with a transaction.

**P1-7. CSV import attributes `uid` to the importing admin, not the
scouted-by name.** `ScoutEntry.uid` is what `firestore.rules` checks against
`request.auth.uid` on create. Imported CSV rows carry a free-text
`scoutName` that may not correspond to any real Firebase user (e.g. a name
typed on a paper backup sheet), so there's no real uid to attribute them to.
`components/analytics/import-csv-dialog.tsx` therefore writes every imported
row's `uid` as the admin who ran the import; `scoutName` keeps the original
attribution for display/analytics. This also means the create rule never
needed an admin carve-out — imports still satisfy `uid == auth.uid`.

**P1-8. Last-admin safeguard is UI-only, not a security rule.** Firestore
rules can't cheaply count a collection, so "an admin can't demote themselves
if they're the last admin" is enforced in `app/(app)/team-management/page.tsx`
(disabling the toggle) by counting admins from the already-subscribed member
list. A direct Firestore SDK/REST call could bypass this. Documented as a
known v1 limitation; closing it fully would need a Cloud Function trigger
that re-promotes a team to zero-admin state back, or re-counts server-side.

**P1-9. Role colors are a fixed palette, not theme-derived.** Both existing
themes (Team Colors, BIOBUZZ) are warm reds/golds; 9 roles need colors
distinct from the theme *and* from each other, so `lib/roles.ts` uses a
fixed, pre-chosen set of Tailwind hues (sky, violet, fuchsia, emerald, amber,
orange, cyan, pink, lime) rather than tints of the active theme's accent.

**P1-10. Offline/pending-sync indicator is scoped to the active event.**
`components/layout/connection-status.tsx` (replaced in FIX3 by `lib/use-connection-state.ts` and a badge on the droplet button) subscribes to
`scoutEntries` for the active event (where offline submissions actually
happen — the Scout Form at a venue with bad Wi-Fi) rather than every entry
the team has ever recorded, to avoid an unbounded realtime listener. With no
active event selected, it only shows Online/Offline.

**P1-11. Theme-on-login.** The prompt asks for the user's theme to be "saved
to the user doc and applied on login." Rather than rearchitecting
`ThemeProvider`'s existing localStorage-based persistence, Account Settings
now writes to both (`setThemeId()` locally + `updateUserProfile({ themeId
})` to Firestore) when a theme is picked. Applying it *on* login specifically
(vs. just whenever the profile loads) wasn't separately wired — `profile`
loads asynchronously after `user`, same as every other profile field — since
there's no meaningful difference in this app between "on login" and "once
the profile is available," and adding a one-time-apply effect would add
complexity (tracking "have I applied this yet this session") without a
behavioral difference the user would notice.

**P1-12. Firestore emulator / rules tests are unverified.** No Java runtime
and no working `firebase-tools` install are available in this environment
(`java -version` → not found; `npx firebase-tools` hit an npm
`ECOMPROMISED` cache error). `firestore.rules.test.ts` is written to cover
every rule in `firestore.rules` (team doc get/create/update isolation, user
profile field-locking, admin-only role/admin changes, scout entry
create-as-self + admin-only update/delete, cross-team isolation) but has
**not** been run. Run it with `npm run test:rules` once Java + the Firebase
CLI are available locally — see the end of this document for the exact
commands.

**P1-13. No composite Firestore indexes needed yet.** Every current query
(`scoutEntries` by `teamId`, by `teamId`+`eventCode`; `users` by `teamId`) is
equality-only with no `orderBy`, which Firestore serves via automatic
single-field indexes (no composite index required). `firestore.indexes.json`
is intentionally empty; add entries if a later prompt introduces a
range filter or `orderBy` combined with an equality filter on a different
field.

**P1-14. `lib/mock-data.ts`'s `people` export was removed**, now that
People/Team Management read from real `users` data via
`lib/team-members.ts`. `scouts` was kept — still used by the untouched
Dashboard, Scout Accuracy, and Admin Panel's placeholder "User roles" list.

**P1-15. Hosting target (Vercel) and the FIRST API proxy's auth boundary.**
A later revision of this prompt made explicit what the first draft left
implicit: the app deploys on Vercel (not just "somewhere"), Firebase
Cloud Functions are off the table entirely (confirming the P1-2 call already
made), and — new — the FIRST API proxy must require a signed-in user, not
just keep credentials server-side. That gap was real: `lib/ftc/actions.ts`'s
Server Actions kept the FIRST API key out of the browser bundle, but had no
check that the *caller* was a signed-in team member — anyone who could reach
the deployed app could invoke them. Closing it needed a server-side way to
verify "is this caller actually signed in," which Server Actions can't do
from a bare `Authorization` header the way a Route Handler could. The fix:
a Firebase Admin SDK + session-cookie layer (see `docs/ARCHITECTURE.md`,
"Auth proxy"). A session cookie (not a per-call ID token the client passes
manually) was chosen specifically so every existing call site
(`getEvents`/`getTeamsForEvent`/`getMatchesForEvent`, `useFtcQuery`, etc.)
keeps its exact signature — the cookie rides along automatically with every
request, the same way it already does for ordinary page loads.

**P1-16. Session cookie lifetime and sync strategy.** 5 days (the
`SESSION_MAX_AGE_MS` in `lib/server/session-cookie.ts`) comfortably covers a
multi-day competition weekend without forcing a re-login mid-event, while
staying well under Firebase Admin's 2-week cap on session cookies. The
cookie is re-synced from `onAuthStateChanged` (not a periodic timer, and not
`onIdTokenChanged`, which fires roughly hourly on token refresh) — simpler,
and sufficient here since `onAuthStateChanged` already re-fires on page load
(restoring a persisted session) and on every explicit sign-in/out, which
covers every realistic usage pattern for this app. A long-lived background
tab that's never refreshed for more than 5 days would need to sign back in;
accepted as a non-issue for a competition-day tool.

**P1-17. Firebase Admin env vars are three separate fields, not one JSON
blob.** The downloaded service-account credential is a single JSON file, but
it's split into `FIREBASE_ADMIN_PROJECT_ID` / `FIREBASE_ADMIN_CLIENT_EMAIL` /
`FIREBASE_ADMIN_PRIVATE_KEY` rather than one `FIREBASE_ADMIN_SERVICE_ACCOUNT`
JSON-string var, since most dashboards (Vercel's included) handle three
plain-text fields more predictably than one large multi-line JSON value with
embedded quotes. The private key's embedded newlines are still escaped as
literal `\n` when pasted and un-escaped at runtime in `lib/firebase/admin.ts`
— documented with the exact steps in `docs/DEPLOYMENT.md`.

**P1-18. `CRON_SECRET` is scaffolded but unused.** Nothing in P1 reads it —
it's listed in `.env.example` and `docs/DEPLOYMENT.md` now, ahead of a P2+
prompt that will likely add a scheduled job (the stack description mentions
"scheduled checks" and "push sending"), so that prompt can start from an
already-provisioned secret instead of this one needing a follow-up
deployment step.

**P1-19. FIRST API response cache bumped from 20 seconds to ~3 minutes.**
`lib/ftc/http.ts` already had a short-lived in-memory cache, originally
framed as same-render-pass request *de-duplication* rather than quota
protection. Re-framed and extended to ~3 minutes to also serve as the "light
server-side caching to avoid burning API quota" this revision explicitly
asks for. It's still per-server-instance and reset on cold start (no shared
cache layer like Redis/Vercel KV was added) — acceptable for "light"
caching, since FIRST's own data doesn't change faster than that during a
live event.

## P2 — Reusable, Schema-Driven Match Scout Form

**P2-1. `calculateScore` keeps `ScoreBreakdown`'s existing `auto` key, not
`autonomous`.** The prompt's own wording asks for `{ total, autonomous,
teleop, endgame }`. `ScoreBreakdown = { auto, teleop, endgame, total }` is
already load-bearing across `lib/analytics/recompute.ts`,
`lib/analytics/flags.ts`, `lib/analytics/game-schema.ts`'s Analytics
columns, `components/scout/score-bar.tsx`, CSV export, and every stored
`ScoutEntry.score` document in Firestore. Renaming the key for a purely
cosmetic difference would ripple through all of those for no functional
gain (and would need a data migration for anything already saved), so
`calculateScore` returns the existing shape; read the prompt's wording as
descriptive ("an autonomous subtotal, however it's named"), not a literal
contract.

**P2-2. "Assigned Match" and "Pre-Match" are fixed parts of `<ScoutForm/>`,
not schema fields.** The prompt's six field types (`toggle`, `counter`,
`checkbox`, `pick`, `readonly`, `text`) don't have anywhere to hang a
bracket picker, alliance roster display, or FIRST-API-backed team search —
and the prompt's own `lockedFields`/`hideMatchPicker` props already treat
"team number", "match", and "scout name" as named, built-in concepts rather
than schema-declared fields. `BIOBUZZ_FORM_SCHEMA` therefore only describes
the scoring sections (Autonomous/Teleop/Endgame/General) plus Comments;
Assigned Match and Pre-Match are hard-coded sections in the component,
controlled through their own dedicated props. Scout Name is always
read-only regardless of `lockedFields` — it's auto-filled from the signed-in
user by design (P1), never something a scout chooses.

**P2-3. `onSubmit`/`onChange` carry a richer `values` object than a bare
`FormValues` dict.** The prompt suggests `onSubmit(values, score)`. Since
`values` must also carry `teamNumber`/`match`/`scoutName` (the parent needs
them to build a `SaveEntryInput`, and they aren't schema fields per P2-2),
`ScoutFormValues = { fields: FormValues, teamNumber, match, scoutName }` is
the actual second-arg-free shape passed as `values`, keeping the prompt's
two-argument `(values, score)` callback signature rather than flattening
everything into one dict with awkward reserved keys.

**P2-4. `<ScoutForm/>` never writes to Firestore, in any mode — including
`event`.** Re-reading "The component never writes to Firestore itself in
non-`event` modes... In `event` mode the Match Scout Form page keeps its
current behavior" as "the page's behavior stays the same," not "the
component special-cases event mode internally": the simpler, more
consistent design is that `<ScoutForm/>` is Firestore-agnostic in every
mode, full stop, and `app/(app)/scout/page.tsx`'s own `onSubmit` handler
(calling `saveEntry()` + `recomputeForEvent()`) is what makes event mode
"behave identically to today" from the user's perspective. `onSubmit` may
return a `Promise`; the success animation and field reset only fire once it
resolves, and a thrown/rejected call leaves the form untouched so the
parent can show its own error state — a small, non-visible-today
improvement over the previous page's unhandled-rejection-on-failure
behavior, not a regression (the old page had no error handling at all).

**P2-5. Only one version per `formId` is supported today.** `FORMS: Record<
formId, ScoutFormSchema>` stores a single current schema per id rather than
a version history, since BIOBUZZ v1 is the only schema that has ever
existed. `getFormSchema(formId)` ignores any specific version request.
Every saved `ScoutEntry` still stores `formId`/`formVersion` (unchanged from
P1) so a future schema v2 can be added without breaking old entries' meaning
— actually looking up a *historical* version for rescoring is left for
whichever later prompt first needs a second version to exist.

**P2-6. Match Analytics' columns were not derived from the new form
schema.** The prompt allows skipping this "if cheap." `lib/analytics/
game-schema.ts`'s `AnalyticsColumn[]` carries metadata a scoring schema has
no use for (3-tier header `phase`/`category` strings that don't match
section/group labels 1:1, `sticky`, pixel `width`, non-field meta-columns
like `match`/`scoutName`/`accuracy`/`scriptStatus`/`actions`) and the
mapping back from `ScoutFormSchema` would be lossy/approximate rather than
mechanical. Left fully hand-written and untouched — zero risk to the
already-working Analytics page, per the prompt's own acceptance criterion
that it "must keep working."

**P2-7. The Comments field already existed; it was folded into the schema,
not duplicated.** The prompt's "add one optional Comments text field"
assumed a prior state without one — this repo already had a Comments
textarea (bound to `ScoutEntry.comments`, already a Match Analytics column
and CSV field) from before P1. It's now declared as the schema's one `text`
field (in BIOBUZZ's `general` section) so the whole form, comments included,
renders from the schema as the prompt intends, without adding a second,
redundant comments box.

## P1b — Auth Update: Google Sign-In, Team-Creation Lock & Owner Accounts

**P1b-1. `teams` moved off a single fixed id to a real (auto-id) collection.**
P1 deliberately hard-coded `teams/default`, since the prompt explicitly said
"do not build team creation or multi-team signup now." P1b's own language —
the owner switch can "re-enable [creation] later for **other teams**," and
owner auto-attach applies when "**exactly one** team exists" — only makes
sense if more than one team can exist. Rather than building actual
multi-team UI (team switching/selection — nothing in P1b asks for that, and
every page still reads `profile.teamId` for "my one team," never a list),
the minimal, contained change was made: `teams/{teamId}` is now an
auto-generated id created by `/api/team/create`'s transaction, and every
place that used to hard-code `TEAM_ID = "default"` now reads `teamId`
dynamically from the signed-in user's own profile (`lib/team.ts`'s
`useTeamDoc(teamId)`, `lib/active-event.tsx` resolving it via `useAuth()`
internally so its own call sites didn't need to change at all). No user can
belong to more than one team, no page lists multiple teams — only the
*storage* stopped assuming there's exactly one.

**P1b-2. Added `/api/team/join`, beyond what P1b explicitly asked for.**
P1b only mandates a server-side transaction for *creating* a team. But P1's
`users/{uid}` create rule only ever checked that the target `teamId`
*existed* — never that the caller had actually supplied a matching join
code (join-code validation was client-side JS only, a UI nicety, not a rule).
That was an accepted trade-off for a single-team app (P1-4: "the join code
is a social, not cryptographic, gate"), but P1b-1's multi-team shift turns
it into a real cross-team access hole: without this route, *any* signed-in
user could join *any* team by id, bypassing its join code entirely, once
more than one team can exist. `/api/team/join` closes it the same way team
creation was already being hardened: look up the team by join code
server-side (an Admin SDK query, immune to the now-much-stricter
`firestore.rules`), then create the user doc — and `firestore.rules`'
`users/{uid}` create rule becomes a flat `allow create: if false`, since
every legitimate path is now server-side.

**P1b-3. (Superseded by FIX2 — the owner can now edit their own row; see FIX2.)
Owner rows are locked for *everyone*, including the owner's own
edits to themself, in Team Management/People.** The prompt says both "The
toggle controls for an owner row are hidden or disabled for everyone except
the owner themself" and, two sentences later, "Nobody (including other
admins) can remove an owner's admin status, change their `isOwner`, change
their roles, or remove them from the team" — the second, unqualified
statement is what `firestore.rules` and the UI both actually enforce,
treating the first sentence as emphasis ("no exceptions — not even other
admins") rather than a literal carve-out for the owner's own row. Since
`isOwner`/`isAdmin` for an owner are entirely env-var/sync-route-driven,
there would be nothing meaningful for the owner to toggle about *themself*
here anyway. An owner's display name/theme remain editable as normal
(`updateUserProfile`) — only the Team-Management-style role/admin controls
are locked.

**P1b-4. Signup and Finish Setup share one component
(`<TeamEnrollmentScreen/>`), not two parallel implementations.** The prompt
frames them as separate screens that happen to offer "the same two choices."
Implemented as: Signup's pre-auth form (name/email/password + inline
Join/Create fields, for the password path) hands off to
`<TeamEnrollmentScreen/>` the moment `user` exists but `profile` doesn't —
which is also `/finish-setup`'s entire content. This covers every path with
one enrollment implementation: password signup enrolls inline in one submit;
a Google sign-in from Signup, Login, or a stale "closed the tab" session all
land on the identical screen, whichever page they came from.

**P1b-5. Google popup/redirect fallback: only `auth/popup-blocked` falls
back to redirect.** "Falling back to redirect if the popup is blocked or on
mobile" — mobile is checked up front (user-agent sniff) and always uses
`signInWithRedirect` directly; for desktop, only `auth/popup-blocked`
triggers a redirect fallback. `auth/popup-closed-by-user` and
`auth/cancelled-popup-request` are treated as a deliberate cancel (no error
shown, no redirect) — silently redirecting the whole tab to Google after
someone closes a popup on purpose would be surprising, not helpful.

**P1b-6. Admin, once granted via `ADMIN_EMAILS` (or by another admin in
Team Management), is never auto-revoked by `sync-roles`** — only `isOwner`
has an explicit revocation rule ("if a user's isOwner is true but their
email is no longer in OWNER_EMAILS, set isOwner back to false (**admin
stays**)"). One real consequence worth flagging: demoting an
`ADMIN_EMAILS`-listed person via Team Management's toggle only lasts until
their next login — `sync-roles` runs again, sees their email still matches
`ADMIN_EMAILS`, and re-grants `isAdmin: true`. This is intentional (an
env-var-controlled admin list is meant to be authoritative), not a bug;
permanently demoting such a person means removing their email from
`ADMIN_EMAILS`, not just toggling them off in the UI.

**P1b-7. `firstAdminClaimed` is gone, not just unused.** P1's bootstrap-race
workaround (P1-6) existed because the *first* admin had to create their own
user doc client-side before any admin existed to authorize it. P1b moves
all team/admin creation into `/api/team/create`'s single atomic Admin SDK
transaction, which has no such chicken-and-egg problem — removed instead of
left dangling.

**P1b-8. Custom claims drive API-route/UI-fast-path checks; `firestore.rules`
and `usePermissions()` still key off the Firestore fields.** Expanded on in
`docs/ARCHITECTURE.md` ("Custom claims vs. the Firestore fields") — the
short version is that a security rule can only read the *caller's* own
token claims, never the claims of the user whose document is being written,
so protecting an owner's row from being edited still has to check that
document's own `isOwner` field, not a claim.

**P1b-9. API route tests are unverified here, same as the P1 rules tests** —
no Java/Firebase CLI in this sandbox (see P1-12). `api-routes.emulator.test.ts`
is written against both the Auth and Firestore emulators (creating real test
users via the client SDK pointed at the Auth emulator, to get real ID tokens
for the routes to verify) and covers every case the prompt lists: team
creation succeeds once and is then rejected, a simulated simultaneous race
only lets one attempt win, unverified emails never receive owner/admin, a
verified owner email gets claims and the "attach to the one existing team"
convenience, and the public config route reports the right flag before and
after a team exists. Run via `npm run test:rules` (renamed in spirit, kept
the same script name — it now runs both emulator-dependent files from
`vitest.rules.config.ts`).

**P1b-10. The email-verification banner only shows for password-auth
users.** `components/layout/verify-email-banner.tsx` checks
`linkedProviders.includes("password")` — Google accounts are inherently
verified (`user.emailVerified` is already `true`), so the condition already
excludes them, but checking the provider explicitly (not just
`!emailVerified`) avoids ever showing it for a provider type where "verify
your email" wouldn't even make sense.

## P3 — Accuracy Engine, Difficulty Tiers, Match Library & Session Data Model

**P3-1. The shared engine's `computeAllianceAccuracy` returns a 0-100 scale;
Match Analytics' own wrapper keeps its existing 0-1 scale.** The prompt
specifies the new module should "return `{ accuracy (0-100), ... }`," but
`lib/analytics/accuracy.ts`'s `AccuracyResult.value` (0-1, multiplied by 100
only at display time in `AccuracyCell`/CSV export) is already load-bearing
across `recompute.ts`, `flags.ts`, the Analytics columns, and every stored
`ScoutEntry.accuracy` document. Rather than pick one scale and ripple a
conversion through all of that (same reasoning as P2-1's `auto`/`autonomous`
naming call), the new engine is simply the one place *implementing* the
math, each scale's own consumer un/scales it as needed: Match Analytics'
wrapper divides the engine's `accuracy` by 100 to keep returning what it
always has, and new P4+ code calling the engine directly gets the 0-100
scale the prompt actually asked for.

**P3-2. BIOBUZZ's `apiSeason` is 2026.** Derived two ways that agree:
`lib/ftc/config.ts`'s existing `getDefaultSeason()` (month ≥ September →
current year) already resolves to 2026 as of this session, and a live FIRST
API lookup (see P3-7) confirms the real event used for the match library
(USWABON1) is itself a season-2026 event.

**P3-3. `importLibraryEvent` doubles as "refresh scores," and never
overwrites `video`/`importedAt` on a re-run.** The prompt lists "import an
event by code" and "a 'refresh scores' button" as two separate admin
actions, but they're the identical operation on identical data — re-running
an import for an already-imported event *is* "re-fetch from the API and
update what changed." Implemented as one function, used by both UI
actions. To keep this safe to re-run without destroying admin-entered video
data: each match doc is read before being written, and `video: null` /
`importedAt` are only included in the write when the doc doesn't exist yet
— an existing doc's `video` and `importedAt` are never part of the payload
on a refresh, so Firestore's `{ merge: true }` leaves them untouched.

**P3-4. `generateSessionId(kind)` is a pure, synchronous string generator;
a separate `claimSessionId(teamId, uid, kind)` is what actually "guarantees
uniqueness with a Firestore transaction."** The prompt's literal signature
(`generateSessionId(kind)`, no team/uid) can't by itself prevent two
concurrent callers from picking the same free id before either writes
anything — true uniqueness needs the candidate to be atomically claimed
(read-doesn't-exist + write, in one transaction), which needs to know
*whose* session this is for the write to satisfy `firestore.rules`' create
rule (`uid == request.auth.uid`). Splitting it this way keeps
`generateSessionId` trivially unit-testable (format/alphabet, no Firestore)
while `claimSessionId` does the real reservation: it writes a minimal valid
`practiceSessions` doc (`teamId`, `uid`, `kind`, `status: "in-progress"`,
`startedAt`) and retries with a fresh candidate on the rare collision — P4
fills in the rest of the session with further updates once more context
(library match, alliance, robots) is known.

**P3-5. `getCategory()` takes either a `ScoutEntry`-shaped or a
`PracticeSession`-shaped input, not two separate functions.** The prompt
asks for one helper, but the two record types signal "is this a real event"
differently (`source` vs. `kind`). Implemented as a discriminated union
(`"source" in input` narrows which check to use) so callers never need to
pre-convert either shape — `lib/practice-sessions.ts` exports it since both
entries and sessions ultimately describe the same scouting-category concept.

**P3-6. `libraryMatches` is deliberately not `teamId`-scoped.** The prompt's
own field list for `libraryMatches/{id}` never includes `teamId` — read as
intentional, not an oversight, since this is public, real FTC competition
data (the same regardless of which team is looking at it), unlike every
other collection in this app's otherwise strict "teamId everywhere"
convention. Consequence: `firestore.rules` can't scope writes by team for a
doc with no `teamId` field, so the write rule is just `isAdmin()` — *any*
team's admin could edit the shared library, not just the importing team's
own. Accepted as a non-issue while the app is realistically single-team
(same trade-off class as P1-3's "no real multi-team UI was built either");
would need revisiting (e.g. a `teamId` after all, with library data
duplicated per team, or a separate "verified publisher" concept) if this
ever runs for multiple mutually-distrusting teams.

**P3-7. Resolved "Rookie Rumble" against the real FIRST API before
importing anything** (per the user's instruction to ask only when truly
blocked, and the prompt's own "if ambiguous, include candidates"). A live
lookup across the 2023-2026 seasons found that the current season's
"Rookie Rumble" (Bothell, WA) **is** event code USWABON1 — the two names in
the prompt refer to the same event, not two — with a separate, distinct
2025-season "Rookie Rumble Scrimmage" (USWABOS1, a different real FTC
game/season) also existing at the same venue. Asked the user directly
(AskUserQuestion) rather than guessing which was intended; they confirmed
**USWABON1 only**. `importLibraryEvent("biobuzz", "USWABON1")` is ready to
run from Admin Panel > Match Library — not run by me, since it writes real
data to the project's live Firestore database and requires being
authenticated as an admin in the running app (see P3-10).

**P3-8. `penaltyPoints` comes from `scoreRedFoul`/`scoreBlueFoul`** in the
raw FIRST API match response — already how `lib/ftc/actions.ts` mapped
these (to `redPenaltyPoints`/`bluePenaltyPoints`) before this prompt, from
an earlier phase of this project. Re-verified rather than re-decided: these
are "points awarded to this alliance for fouls committed by the opponent,"
matching the prompt's definition exactly, and are already folded into
`scoreRedFinal`/`scoreBlueFinal` (the official score) the same way the
accuracy formula expects.

**P3-9. No component-level tests for `MockVideoPlayer`/`VideoPlayer`.**
This project's testing setup (`vitest.config.ts`, `environment: "node"`)
has no DOM environment (jsdom) or React Testing Library configured anywhere
— every previous prompt's tests (P1-P2, P1b) are pure-logic-only, by the
same "write tests for pure logic" instruction this prompt repeats. Adding
component-testing infrastructure now would be a meaningfully larger,
out-of-scope expansion; `lib/practice-sessions.test.ts` and
`lib/accuracy/engine.test.ts` etc. cover every piece of *logic* these
features depend on instead. The video players and the Match Library admin
UI are verified only via `tsc`/`eslint`/`next build` succeeding (same depth
as every other Firestore-touching feature built in this session, per
P1-12's emulator unavailability) — not exercised in a real browser.

**P3-10. I did not actually run the match-library import myself.** Doing so
writes real documents to the project's live Firestore database and
requires being signed in as an admin in the running app — I have neither a
way to authenticate as the user's own account nor a reason to reach for
Firestore Admin SDK credentials to write application data outside the
app's own code path (which would also skip the real import logic). The
Admin Panel > Match Library UI is fully built and ready: run `npm run dev`,
sign in as an admin, enter `USWABON1`, click Import.

**P3-11. The two `practiceSessions` composite indexes in
`firestore.indexes.json` are a best guess, not derived from an actual
query.** No P4 UI exists yet to know its exact query shapes. Added the two
most likely ones given the schema — `teamId`+`status`+`accuracy desc`
(a completed-sessions leaderboard) and `teamId`+`uid`+`startedAt desc`
("my sessions") — both equality-then-sort combinations that genuinely need
a composite index, unlike every P1/P2 query so far (all pure-equality,
served by Firestore's automatic single-field indexes). P4 may need more
once its real queries are known.

## Bugfix (2026-10-23): every page hung on its loading spinner after sign-in

**Root cause:** `lib/auth.tsx`'s realtime subscription to the signed-in
user's own `users/{uid}` doc had no error callback on its `onSnapshot`:

```ts
onSnapshot(doc(db, "users", user.uid), (snap) => { ...; setProfileLoaded(true); });
```

`firestore.rules`' read rule for that collection is
`isSignedIn() && sameTeam(resource.data.teamId)`, and `sameTeam()` reads
`resource.data.teamId`. When the document **doesn't exist yet** (first
sign-in before `/api/team/create` or `/api/team/join` has run, or a signup
that never finished — exactly the case `app/(app)/layout.tsx` already has a
`/finish-setup` redirect for), `resource` is `null` in the rule evaluation,
so `resource.data.teamId` throws and the read is denied. With no error
handler, `onSnapshot`'s success callback simply never fires, so
`profileLoaded` never flips to `true`, `loading` never resolves, and
`app/(app)/layout.tsx`'s `if (loading || !user || !profile)` guard (the
small pulsing-circle spinner) never clears *and* never reaches its own
`router.replace("/finish-setup")` — the app hangs forever on every route
under `(app)`, exactly as reported. This had been masked until now because,
per this session's earlier env-var mixup, sign-in itself couldn't
previously reach a real Firestore read at all; fixing the `NEXT_PUBLIC_
FIREBASE_*` keys is what first let a real user actually hit this path.

**Fix:** added an error callback to every `onSnapshot` call across the app
(`lib/auth.tsx`, `lib/team.ts`, `lib/team-members.ts`, `lib/match-library.ts`
(both hooks), `lib/practice-sessions.ts` (all three hooks),
`lib/scout-entries.ts`'s `subscribeEntries`) — none of them had one; this
was a systemic gap, not unique to the profile listener, and the same
silent-hang failure mode (a `get()` on a not-yet-existing or no-longer-
accessible doc) could otherwise recur anywhere a hook keys off a doc whose
existence/access isn't guaranteed. Each now logs the error and resolves its
`loaded` state to `true` with an empty/`null` value, same as the "not
found" branch — for `lib/auth.tsx` specifically, that means `profile: null`
still correctly drives the existing `/finish-setup` redirect instead of
leaving the user stuck.

## P4 — Practice Scouting: Solo (Trial & Competitive)

**P4-1. Each robot's scout entry is only written to Firestore when the user
chooses Continue, Pause, or Finish Session — never at mere form
validation.** `SessionScreen` validates and scores the form into local React
state (`pendingRobot`) the moment "Next Robot"/"Finish Session" is clicked,
but `saveEntry()` is only actually called inside `handleContinue`,
`handlePause`, and the finish branch of `handleNextOrFinish`. This is what
makes "Cancel"/"End Session" (which the prompt says always discard, with no
exception) correct even when robot 1's form was already fully filled out and
validated before the scout changed their mind in the Break Menu.

**P4-2. `firestore.rules`' `practiceSessions` delete rule is extended from
P3's blanket `allow delete: if false` to let the session's own owner delete
it while `status` is `"in-progress"` or `"paused"`.** `claimSessionId`
reserves a session doc the instant a match is picked, before any entries
exist — without a delete path, every "Change Match," "Cancel," "End
Session," and "Discard paused session" action (all of which the prompt
specifies save nothing) would leave that stub session behind forever,
permanently showing the match as "Opened" to the whole team. Completed
sessions remain permanently non-deletable by anyone, admin included — only
P3's existing deny stands for those.

**P4-3. Fixed a latent cross-contamination bug in `lib/scout-entries.ts`
before any practice entries could ever trigger it.** `getEntriesForEvent`
and `subscribeEntries` (both written in P1, used by Match Analytics) only
filtered by `teamId` + `eventCode`, with no `source` filter. Once this
prompt lets `source: "practice"` entries exist whose `eventCode` could
coincidentally match a real active event's code (library matches are
imported from real FIRST events), they would have silently appeared in
Match Analytics alongside real scouting data. Both queries now also filter
`where("source", "==", "event")`.

**P4-4. Match Select's Fresh / Opened / Scouted status is computed
team-wide, not just from the viewer's own sessions.** `buildMatchRows`
looks at every `solo` session referencing a given (library match, alliance)
regardless of `uid`; `byYou` separately reflects whether the session that
actually decided the status (the completed one, or an open one if none is
completed) belongs to the viewer. This matches the prompt's own "Scouted ·
by you" wording, which only makes sense if "Scouted" itself is a team-wide
fact and "by you" is a qualifier on top of it.

**P4-5. Only one paused solo session is allowed live at a time, enforced
with a blocking banner, not a modal.** `useOwnPausedSession` returns "at
most one" by construction (`limit`-free query, first doc wins) — so the
Practice Scouting landing screen replaces the Season Select grid entirely
with `ResumeBanner` whenever a paused session exists, rather than letting
the scout abandon it by starting a second one. This is enforced only at the
landing screen (not race-proof against two browser tabs pausing two
different sessions simultaneously) — the same class of accepted limitation
as P1's "last admin can't demote themselves" UI-only guard, not a security
boundary.

**P4-6. Orphaned `"in-progress"` sessions (crash or tab-close mid-robot-1,
never reaching `"paused"`) are not cleaned up by this prompt.** No
auto-expiry job or admin "force-delete" UI exists. Such a session simply
sits as "Opened" in Match Select — scoutable to completion by anyone on the
team, or left stale — until `firestore.rules`' new owner-only delete (P4-2)
is exercised by that same user resuming... except an `"in-progress"`
(non-paused) session has no "resume" entry point, only `"paused"` does.
Accepted as an out-of-scope v1 gap, consistent with how no prior prompt in
this project built background cleanup jobs either; worth revisiting with a
"resume any of your own open sessions" list if this proves common in
practice.

**P4-7. `PracticeSession.platform` is captured once, at session start, via
the same `detectPlatform()` user-agent check `lib/auth.tsx` already used
for its Google-redirect-fallback logic** (now lifted into `lib/platform.ts`
so both can share it) — never re-evaluated mid-session, since a scout
switching devices mid-match isn't a case worth handling.

**P4-8. `ScoutForm` in practice mode locks `teamNumber` (prefilled from the
session's assigned robot for that turn) and renders with `hideMatchPicker`
and `showSubmitButton={false}`.** `SessionScreen` drives validation
(`handle.validate()`), scoring (`calculateScore`), and save timing (P4-1)
itself via the form's ref handle — exactly the controlled, non-owning
pattern P2 built `ScoutForm` to support for exactly this kind of
non-"event" mode.

## P5 — Scout Accuracy Page & My Scouting Page

**P5-1. A real-event alliance partner is resolved from a shared
`accuracy.value`, never a live FIRST API roster lookup.** The spec's
partner-weighting step needs to know, for a scout's own entry, who scouted
the *other* robot on that alliance — normally that means re-fetching the
match's official roster (red/blue teams), the same way
`lib/analytics/recompute.ts` already does once per event. But that
recompute step already writes the *identical* alliance-level
`accuracy.value` onto every entry for a match (it's computed once from the
alliance, not per-robot), so two non-excluded, `status: "complete"` entries
in the same match with the same `accuracy.value` (within a tiny epsilon)
are alliance partners by construction. Resolving partners this way means
the whole Real Event calculation is pure, synchronous, and testable from
`scoutEntries` alone — no new Server Action calls, no rate-limit exposure,
no re-deriving data `recompute.ts` already derived once.

**P5-2. Pass 1 (the unweighted estimate used only to judge a partner's
quality) always uses the plain prior/K=2, regardless of which final
variant (plain/Trial/Competitive) is being computed for the scout being
viewed.** The spec says to run pass 1 before weighting but doesn't say
which prior that pass itself should use; using one fixed, variant
-independent baseline for "how good is this partner" is simpler and more
consistent than recomputing pass 1 per-variant, and matches pass 1's own
purpose (a provisional baseline, not a final number anyone sees).

**P5-3. Excluding a session/entry only removes it from the accuracy
average (and therefore rank) — it still counts toward "sessions
completed"/"forms completed," "total entries," and "last scouted."** The
control is literally named "Exclude Score **From Percentage Average**,"
and these other numbers describe raw activity/engagement, not quality — a
scout excluding a fluke bad session shouldn't also make them look less
active than they were.

**P5-4. All four summary stats (scout-to-member ratio, average accuracy,
sessions/forms completed, total entries) are scoped to the
currently-**visible** (role/event-filtered) scouts, not the whole team.**
The prompt explicitly says this for "Average accuracy ... of the scouts
currently shown"; the other three aren't explicit either way, but scoping
all four consistently to "what's on screen right now" is simpler to reason
about and implement than mixing full-team and filtered scopes across one
summary row.

**P5-5. Ranking basis and the role/event filters are two independent
concerns, not one.** The filters always control which rows are *visible*
in the table; `rankingBasis` separately controls which *population* the
rank *number* is computed against — "Preserve original ranks" (default)
ranks the whole team so a visible scout keeps their true team-wide rank
even when the table is narrowed down to a handful of people, while "Role
Leaderboard"/"Event Leaderboard"/"both" re-rank within just that filtered
subset. Accuracy values never change either way — only the rank number
does. This reading is what makes "Preserve original ranks (default: ranks
computed across everyone)" make sense as a *distinct* option from the
other three, rather than being redundant with the filters themselves.

**P5-6. Hard Reset, Dismiss Flag, and Exclude/Include only exist for Trial
and Competitive — Real Event's View Details has no management controls at
all**, per the prompt's own "Dismiss/Exclude for real entries stay in
Match Analytics' Config modal." A bulk delete of a scout's *real* entries
would also corrupt the team's own match records (those feed Match
Analytics for everyone, not just this one scout's personal stats), so
Hard Reset deletes completed `practiceSessions` (and their `scoutEntries`,
via each session's `entryIds`) only.

**P5-7. `firestore.rules`' `practiceSessions` delete rule is extended
again, narrowly: an admin may now delete a session with `status ==
"completed"` specifically — not a blanket `isAdmin()`.** P4 documented
"once completed, never deletable by anyone, admin included"; Hard Reset
needs exactly the capability that note ruled out, so this prompt
supersedes it — but only for the completed case. An admin still can't
delete someone else's in-progress/paused session (that remains owner-only,
unchanged from P4) — yanking a session out from under someone actively
scouting it was never asked for by any prompt. This also required updating
an existing P4 rules test that asserted an admin deleting a completed
session fails; it's now split into one test confirming the (unprivileged)
owner still can't, and a new P5 test confirming the admin now can.

**P5-8. The Event filter's chip *options* come from distinct event codes
in `scoutEntries`, not from `eventAttendance`.** `eventAttendance` (owned
by P6, which doesn't exist yet) governs *who's attending* a given event —
with zero documents today, filtering by any event currently matches
nobody, exactly as the prompt anticipates ("treat a missing collection as
empty"). But the event codes to filter *by* are a separate concern the
prompt doesn't explicitly source — using the team's own real-event history
means the control has something meaningful to show today instead of being
permanently empty, with the actual filtering staying a documented no-op
until P6 ships real attendance data.

**P5-9. "My Scouting" is a new route, `/my-scouting`, with its own nav
entry** — not folded into the existing (still fully placeholder) Dashboard
page, which stays out of this prompt's scope. "My Scouting" needed its own
acceptance criteria (three cards, a recent-sessions list, a Start Practice
Scouting button) substantial enough to warrant a dedicated page rather than
a Dashboard section.

**P5-10. My Scouting's "Recent sessions list" combines Trial and
Competitive sessions into one chronological list** (not two, not
per-category) — the prompt describes a single list, and Real Event entries
are already covered read-only elsewhere (the Real Event card itself, plus
Match Analytics), so including them a third time here would be redundant.

**P5-11. `dismissSessionFlag` matches a session's flag by its `type`, not
an array index.** The UI only ever shows the *active* (non-dismissed)
subset of `session.flags`, whose indices don't line up with the full
stored array being written back — matching by `type` (assumed unique per
session, since each names a distinct rule/condition) avoids dismissing the
wrong flag.

**P5-12. The status elaboration text ("Pair this scout with a mentor...")
lives on `lib/accuracy/engine.ts`'s shared `AccuracyStatusInfo` as a new
`guidance` field**, not as page-local copy in Scout Accuracy — it's
canonically tied to the same 4 status tiers that already live there, and
any future page showing a scout's status gets the same wording for free.

## P6 — Assignments Page (Attendance & Scouting Schedule)

**P6-1. "Prioritize teams" excludes every other slot outright — it doesn't
just fill prioritized slots first and then keep trying the rest.** The
prompt's own framing ("used when there are very few scouts... and not
every team can be scouted: prioritized teams' robots get assigned first,
remaining robots **may stay unassigned**, and breaks are still spread
fairly") only makes sense as a deliberate reduction in scope: with 4-6
scouts, covering *every* robot in *every* match leaves nobody a break.
Making every non-prioritized slot `scoutUid: null` unconditionally (not
"fill it if there's capacity left") is what actually frees up the slack
needed for breaks, and makes the behavior simple to reason about and test
— "fill opportunistically" would have made the fairness outcome depend on
scout-count/match-count interactions in a way the prompt doesn't specify.

**P6-2. Custom Interval and Constant Same Order both build their batches
from one sliding cyclic window (`cyclicWindow`), not a fixed, disjoint
group partition.** An earlier version partitioned scouts into `ceil(n/4)`
groups up front (e.g. 7 scouts → groups of 4 and 3) and either cycled
through them per-match (Constant Same Order) or re-picked a fresh group of
4 by least-assigned-count per interval (Custom Interval). Both failed the
"counts differ by at most 1" fairness target for scout counts that aren't
clean multiples of 4: uneven group sizes needed per-match floater top-ups
(pulling extra, unevenly-distributed assignments into whichever scouts
covered the gap), and greedy per-interval re-picking let one scout's
"share" overshoot by a whole batch's worth before the next correction. A
window of `min(4, n)` scouts sliding by its own size through one
seeded-shuffled cyclic order fixes this: it's always exactly 4 wide (when
`n >= 4`, so no floaters are ever needed), and by simple circular symmetry
every scout appears in exactly the same number of windows over one full
cycle (`n / gcd(windowSize, n)` picks) — and provably within 1 of that at
any partial point. For Constant Same Order (one pick *per match*) this
achieves exact ±1 total-count fairness, matching the prompt's target
exactly. For Custom Interval, a whole batch is committed for every match
in an `x`-match interval at once, so each "pick" moves a scout's count by
`x`, not 1 — the achievable fairness bound is therefore `x` (the interval
size), not 1, which is a property of what "swap the whole batch every `x`
matches" *means*, not a flaw in the window itself. The prompt's own text
anticipates exactly this ("works best in multiples of 4... if perfect
fairness is impossible, show the exact counts and warn"), so this is
surfaced via `fair`/`warning`, not treated as a bug — `lib/scheduler/
scheduler.test.ts`'s fairness sweep (1-14 scouts, all three patterns)
asserts exact ±1 for Rotate Each Match and Constant Same Order, and
±`intervalSize` for Custom Interval.

**P6-3. "Keep the previous version for undo" is implemented as exactly one
level of undo** (`AssignmentsDoc.previous`), not a full version history —
`publishAssignments` demotes whatever was `current` into `previous` (one
slot, overwritten each publish) and `undoAssignments` swaps them back,
clearing `previous`. The prompt's own wording ("the previous version," not
"every previous version") reads as deliberately scoped to this; P9's
Admin tools or a future prompt can layer a real history on top if ever
needed, without changing this shape.

**P6-4. Reconciling `eventAttendance` with P5's earlier guess.** P5 built
this collection speculatively (P6 didn't exist yet) as one doc per
(team, uid, eventCode), read-only, denied all writes. P6's own spec is
explicit and different: one doc per (team, event), `{ uids: string[] }`,
admin-writable. This prompt replaces that shape entirely —
`lib/event-attendance.ts` was rewritten (`useTeamEventAttendance`/
`useEventAttendance`/`setEventAttendance`), `firestore.rules`' rule
updated to admin-write, and `firestore.rules.test.ts`'s matching tests
rewritten for the new shape. The only *other* code that depended on the
old shape was `lib/scout-stats/engine.ts`'s one-line Event-filter check
(`attendance.some(a => a.uid === member.uid && ...)` →
`attendance.some(a => a.uids.includes(member.uid) && ...)`) — isolating
that dependency to one function is exactly why P5 bothered to type
`attendance: EventAttendance[]` as a named, imported type in the first
place rather than inlining its shape.

**P6-5. "Live" match source reuses "Event schedule"'s data (the FIRST API)
outright — there's no separate data source for it.** No scout-facing way
to run a live-scouting session exists yet (see docs/ARCHITECTURE.md's
vocabulary note — `kind: "live"` practice sessions are still P7+), so
"Live" as a *match source* for generating a schedule has nothing to
meaningfully differ from "Event schedule" against today's data model; both
read the same `getMatchesForEvent` results. The tab exists in the UI (per
the prompt's three-way match-source list) so the setting is recorded
(`AssignmentSettings.matchSource`) and ready to diverge later once a real
live-scouting data source exists.

**P6-6. The Match Scout Form's "next assignment" is determined by the
*absence of a matching `scoutEntry`*, not by the official match's `played`
status.** The prompt asks to "show the signed-in scout's next assigned
match and robot ... with a one-tap 'Load this assignment.'" A library- or
live-sourced assignment may have no "played" concept at all, but every
assignment source produces entries the same way once scouted — so "next"
is simply the earliest (by match type/number) of the scout's own assigned
slots that they haven't already submitted a real-event entry for. This
also means the banner naturally advances the instant a submission saves
(the realtime `scoutEntries` listener picks it up), with no separate
"mark assignment complete" step needed. Loading an assignment builds a
synthetic `FtcMatch` (no roster/score data) exactly the way the Match
Picker dialog's own manual-entry mode already does, reusing that same
"downstream code already treats an unmatched match as having no official
data" tolerance.

**P6-7. "Dashboard/My Scouting: show 'My upcoming assignments'" is built
on My Scouting only, not Dashboard.** Dashboard remains entirely
placeholder content on `lib/mock-data.ts` (explicitly out of scope since
P1, reaffirmed every prompt since), so adding a real, Firestore-backed
section to it would be the first crack in that placeholder — not something
this prompt should decide unilaterally when My Scouting (built in P5,
already a real per-scout dashboard) is the natural, in-scope home for
exactly this kind of "your own upcoming activity" content.

**P6-8. Assignments are written with plain, rules-gated client calls
(`setDoc`/`updateDoc`), not a new API route.** Every other admin-managed,
non-Admin-SDK-requiring collection in this app (`practiceSessions`
updates, `scoutEntries` admin edits, `eventAttendance`) follows this same
pattern — an API route is reserved for things Firestore rules genuinely
can't express (team creation's cross-collection atomicity, verified-email
-gated claims). Generating and publishing a schedule needs neither: it's a
single team-scoped, admin-only write.

## P7 — Practice Scouting: Live Mode

**P7-1. `streamStartSec`/`streamEndSec` are always written `null` — no
real capture of where the match started/ended in the stream.** The prompt
describes embedding the stream and letting the scout mark these, but doing
that for real needs a player SDK (YouTube IFrame API / Twitch Embed API)
postMessage integration to read/seek playback position, which can't be
verified against a real embedded player in this sandbox (no network access
to actually load one). `lib/practice-sessions.ts`'s schema already reserves
both fields so this is a pure follow-up, not a redesign, whenever someone
wants to wire the real player SDK in. `components/practice/live/live-session-screen.tsx`
has a top-of-file comment calling this out explicitly.

**P7-2. Twitch event-detection is low-confidence by design; only YouTube
gets a real signal.** YouTube's public oEmbed endpoint returns a video
title/author with no auth needed, which `matchEventFromText` can actually
search against event names. Twitch has no equivalent unauthenticated
metadata endpoint, so `app/api/live/detect-event/route.ts` falls back to
just the channel name from the URL — often a team/organizer handle, not an
event name, so it rarely matches confidently. This is why the Link step's
UI always offers a manual event picker alongside the auto-suggestion
rather than ever blocking on detection succeeding.

**P7-3. `liveMatches/{matchKey}` parent documents are never written —
only presence under `liveMatches/{matchKey}/scouts/{uid}`.** Same
precedent as `libraryMatches`: the collection path exists for namespacing
subcollections, not because anything needs to query or read a
match-level doc. A stale presence doc (scout closed the tab) is never
actively deleted — `isPresenceActive(lastSeen)` just treats anything older
than `LIVE_CONFIG.PRESENCE_STALE_MS` as gone, client-side, which is cheap
and sufficient since these docs are tiny, numerous-but-not-huge, and
nobody's paying for storage pressure here. A cleanup cron was considered
and skipped as unnecessary complexity for v1.

**P7-4. Join rule for the case where *both* alliances already have exactly
one robot covered: forced onto the first alliance in iteration order
(`["red", "blue"]`), i.e. red.** The prompt describes "forced onto the
same alliance's other robot" assuming the common case of exactly one
covered robot total. With two different scouts independently starting on
each alliance at nearly the same moment, there's no stated tiebreak — red
-first is an arbitrary but stable, documented choice (`lib/live/join-rules.ts`).
In practice this is a narrow race-condition window (two scouts opening the
Link step within moments of each other) with a safe failure mode either
way: nobody scouts the uncovered blue robot *now*, but it still shows up
for anyone as a "Pending robot" afterward.

**P7-5. Live-mode auto-flag evaluation passes `sameTeamEntries: []` to
`evaluateAutoFlagRuleIds`, meaning "is this scout's entry for this team
consistent with another entry for the same team elsewhere" rules never
fire in live mode.** `FlagContext.sameTeamEntries` exists for the real
-event and library-based flows where "this team's other recorded entries"
is already in hand; wiring the equivalent for live mode would mean fetching
every other live/real-event entry for that exact team across every event,
which the prompt doesn't ask for and would be its own small feature.
Documented here as a known scope gap rather than silently dropped — the
flags that matter most for live mode (Zero Entries, Unrealistic Entry, via
`evaluatePracticeSessionFlags`) are unaffected.

**P7-6. Idempotency needs no extra "already processed" flag.** A
completed live session only ever matches `resolvePendingLiveMatches`'s
query while `accuracy == null`; writing a resolved `accuracy` is itself
what removes it from future sweeps, so the cron route and the
client-fallback route can both run (even concurrently) without double
-scoring a session. Push notifications are separately guarded by checking
whether `notifications/{sessionId}` already exists before creating it and
sending — belt-and-suspenders in case two sweeps somehow race on the same
session between the accuracy write and the notification write.

**P7-7. `/api/live/check-scores`'s rate limiter is an in-memory
`Map<uid, timestamp>`, not durable across serverless instances or
deploys.** On Vercel, concurrent requests can land on different function
instances, each with their own empty map, so the "at most once per ~30s
per user" limit is best-effort, not a hard guarantee. This is acceptable
because `resolvePendingLiveMatches` is already idempotent (P7-6) — the
limiter exists purely to avoid wasteful redundant FIRST API calls, not to
prevent incorrect behavior, so an occasional double-poll from instance
churn costs nothing but an extra fetch.

**P7-8. "Join a live scout" and "scout a pending robot you already know
about" are the same underlying action, unified via one `ResumePendingRobot`
type.** Both are "claim a new live session for an already-known alliance
robot, skip the Link/Event/Match steps, go straight to the Robot step's
confirmation (or straight past it, for Join)." `PresencePanel` and
`PendingRobotsList` both just produce a `ResumePendingRobot` and hand it to
`LiveFlow`'s `resumePendingRobot` prop — no separate claim path was built
for each entry point.

**P7-9. `lib/ftc/matches-internal.ts` exists only so server contexts
without a browser session can share `lib/ftc/actions.ts`'s FIRST API fetch
+ merge logic.** `getMatchesForEvent` (the existing Server Action) gates on
`requireUser()`'s session cookie, which neither the `CRON_SECRET`-gated
cron route nor the client-fallback route (authed, but intentionally
resolving sessions scoped to `uid`, not "whoever's session cookie this is")
can rely on for *this* call path. The extraction is mechanical — no fetch
/merge behavior changed, just where the `"use server"` boundary sits.

**P7-10. What's unverifiable in this sandbox.** No network access means
none of the following were tested end-to-end, only built to the
documented, standard integration surface for each:
- FCM web push delivery (a real device/browser actually receiving a
  background or foreground notification).
- A real embedded YouTube/Twitch player (iframe renders; the embed URL
  format was checked against each platform's documented embed URL scheme,
  not against a live video).
- The `vercel.json` cron entry and the documented external-scheduler setup
  actually firing on their schedules once deployed.
- Event detection (`/api/live/detect-event`) against a real, currently
  -live FTC event stream.
- The full live flow against a real in-progress FTC match (no real event
  is running during development) — tested instead with synthetic
  Firestore state and the existing pure-logic unit tests for every
  decision point (`lib/live/*.test.ts`, `lib/practice-sessions.test.ts`).

## P8 — Live Practice Lobby (Kahoot-Style)

**P8-1. The lobby document's own Firestore id doubles as the shareable join
code — there's no separate `code` field.** `lib/lobby.ts`'s `claimLobbyId`
reserves an `LB-XXXXXX` id exactly like a Session ID
(`claimUniqueDocId`, extracted from `lib/practice-sessions.ts`'s
`claimSessionId` for exactly this reuse). "Join with code" is then a
direct `getDoc(doc(db, "lobbies", code))` by that id — simpler than a
`where("code","==", code)` query, and "unique among open lobbies" is
already guaranteed by the same claim-transaction every Session ID uses.

**P8-2. A round's full pairing lives on the lobby doc's own `pairing`
array, not on each player's `players/{uid}` subdoc, even though the
prompt's own schema sketch lists `pairId`/`robot` under the `players`
subcollection.** `firestore.rules` says "only the host can change the
lobby doc's state and settings; players write only their own player doc" —
taken literally, the host can never write into a player's own subdoc (and
a player can't write anyone else's), so there's nowhere for the host's
Start-time pairing computation to land except the lobby doc itself, which
only the host may write. Every reader (the waiting room, the session
screen, the results screen) already reads the full lobby doc anyway, so
this costs nothing functionally — a player's own robot/alliance is just
`lobby.pairing.find(p => p.playerUids.includes(uid))` instead of a field
read off their own subdoc.

**P8-3. A pair's final accuracy/flags are written by
`app/api/lobby/resolve-results` (Admin SDK), never by either player's own
client.** A pair's two sessions belong to two *different* players, and
`firestore.rules`' existing `practiceSessions` update rule (unchanged
since P3/P4) only ever lets a session's **own** `uid` update it while
`status` is `"in-progress"`/`"paused"` — never a teammate, not even the
host, and never once it's `"completed"`. This is the same structural
problem P7's live-mode scoring solved with an Admin-SDK resolver
(`lib/live/resolve-pending.ts`); `lib/lobby/resolve-results.ts` mirrors
that pattern. The one real difference: a library match's official score is
*already known* (it's pre-imported), so there's nothing to wait on — this
resolves once, synchronously, when the round ends, rather than needing a
`CRON_SECRET` sweep or a repeating client poll like P7's live mode does.

**P8-4. "Finished Early" never fires for lobby-mode sessions (
`videoProgressAtFinish` is always passed as `null` to
`evaluatePracticeSessionFlags`).** Solo mode has exactly one shared video
whose progress is unambiguous; lobby mode's video is per-player when
`hostIsDisplayer` is off, and nonexistent for everyone except the host
when it's on — there's no single signal that means the same thing for
every player the way it does in solo mode. Rather than invent a
per-player approximation the prompt never asked for, this flag is simply
scoped out for lobby mode, the same kind of deliberate trim P7 made for
live mode's own flag set (see P7-5).

**P8-5. Lobby entries are saved with `source: "practice"` (not a new
`"lobby"` `ScoutEntrySource` value).** `getCategory()` already resolves a
`"practice"`-sourced entry's category from its `mode` field exactly the
way the prompt wants lobby entries categorized ("the lobby's mode as its
category") — adding a fourth source value would mean updating every place
that currently branches on `source`, including Match Analytics' real
-event filtering, for no behavioral gain. `practiceSessions.kind: "lobby"`
is what actually distinguishes a lobby session from a solo one wherever
that distinction matters (e.g. `lobbyId`/`pairId` being non-null).

**P8-6. Lobby sessions don't count toward Scout Accuracy's or My
Scouting's Trial/Competitive leaderboards.** `lib/scout-stats/engine.ts`'s
practice-mode calculations explicitly filter to `kind === "solo"` (a P5
decision, predating lobby mode's existence); this prompt's own acceptance
checklist never asks for lobby rounds to feed those leaderboards, so
widening that filter would be a cross-cutting change to P5's established
statistics semantics that nobody asked for. A completed lobby session is
still saved in full (with its own `accuracy`, same shape as a solo
session) — it's just not included in those two pages' numbers today. A
reasonable, easy follow-up (`kind === "solo" || kind === "lobby"`) if
that's ever wanted.

**P8-7. "Pick Match"'s sort order invents a 4th tier for combinations the
prompt's own 3-tier spec never names.** The spec's ordering for a target
difficulty only ever lists combinations that include the target itself
(e.g. for Easy: easy+easy, easy+medium, easy+hard) — a match where
*neither* alliance matches the target (e.g. targeting Easy when a match is
medium+hard) isn't covered. `lib/lobby/match-select.ts` sorts those last,
after all three named tiers, rather than leaving their relative order
undefined.

**P8-8. A disconnected host (>5 min) or an idle expired lobby is a
client-derived display state only — nothing ever actually writes
`status: "closed"` for either case.** Same reasoning as P7-3's stale
presence docs: this project has no Cloud Functions (Firebase stays on
Spark-plan-compatible Auth + Firestore + Route Handlers only), so there's
no scheduled job that could sweep and close abandoned lobbies, and only
the host may write the lobby doc's `status` — so even a *teammate*
noticing the host is gone can't legally close it for them. Readers derive
"this lobby looks abandoned" from `hostLastSeen`/`LOBBY_CONFIG.HOST_STALE_MS`
and `LOBBY_CONFIG.LOBBY_EXPIRE_MS` themselves; stale lobby/player docs are
never actively deleted (same accepted trade-off as P7-3).

**P8-9. "Play Again" needs a new `resetPlayerSubmitted` function because
the host can't reset a player's own `submitted` flag.** Each player's
`players/{uid}.submitted` flips to `true` at their own submit and must go
back to `false` before the next round, but per P8-2's rule, only that
player may write their own doc. `LobbyWaitingRoom` has every player reset
their own flag themselves the moment they're back in the waiting room
(covers both the very first round, where it's already `false`, and every
"Play Again" after) — this is a mechanism the prompt doesn't describe at
all; without it, a player who already submitted last round would make the
*next* round's "everyone submitted" check pass instantly, auto-resolving
before anyone scouts anything.

**P8-10. "Best-effort synchronized start" is one shared `startsAt`
timestamp plus a client-side countdown — not true playback-position
sync.** The host's Start writes `startsAt` a few seconds in the future
(`LOBBY_CONFIG.COUNTDOWN_SEC`); every player's own client counts down to
that same moment and then shows its own independent `<VideoPlayer/>`
instance. This gets everyone's video starting within normal network-jitter
range of each other, which is what "best effort" means here — there's no
cross-client playback-position reconciliation (and, unlike P7's live
mode, there's no live-position-to-capture problem at all: a library
match's video has a fixed, already-known `startSec`/`endSec`).

**P8-11. What's unverifiable in this sandbox.** No second browser/account
and no Firebase emulator (no JVM/Firebase CLI — the standing limitation
since P1) means none of the following were exercised against real
multi-client state, only built to the documented rules/schema and covered
by the pure-logic unit tests where the logic is pure:
- The actual multi-browser experience of hosting, joining, starting, and
  scoring a round end-to-end.
- `firestore.rules.test.ts`'s new `lobbies`/`players` describe blocks,
  including the 4-player scenario test the prompt asks for — written, not
  run; see "Commands to run locally" below.
- "Play Again"'s actual re-roll and the full reset-and-restart cycle.
- Reconnect-after-refresh via `useMyActiveLobbyId`'s collection-group
  query, which needs the new `players` index in
  `firestore.indexes.json` deployed to actually serve results.

## P9 — Practice Data in Match Analytics & Admin Panel Session Tools

**P9-1. No new Firestore rules or collections.** Every write this prompt
adds — editing an entry's fields, rescoring, excluding a session from
Match Analytics' practice view, exporting backups — goes through a path
`firestore.rules` already covers: `scoutEntries` update/create is
admin-or-own-uid (unchanged since P2/P3), `practiceSessions` update is
unconditionally `isAdmin()` regardless of status (unchanged since P4/P5),
and `auditLog` create never restricts the `action` field's value (only
`uid`/`teamId`). I re-read all four rule blocks before concluding this —
it's a finding, not an assumption I made without checking. No new rules
tests were added for P9 as a result; the existing P1–P8 rules tests
already exercise every path P9's writes travel through.

**P9-2. `getEventEntries` is a plain alias for `getEntriesForEvent`, not a
rename, and has exactly one real caller (`lib/analytics/recompute.ts`).**
The prompt asks for "a documented helper `getEventEntries()`... every
OTHER analytics page uses" to keep excluding practice data — but every
Analytics page besides Match Analytics (Team Averages, Rankings, Match
Breakdown, Pick List, Team Breakdown, Scout Status) still reads from
`lib/mock-data.ts`, not Firestore, as of P9. There's no second page to
refactor onto a shared helper yet. `getEventEntries` exists now, under the
name the prompt asks for, ready for those pages to call once they go live
against real data — see `lib/scout-entries.ts`'s own doc comment.

**P9-3. Practice/live rows' accuracy column reads the owning *session's*
accuracy, synthesized onto a display-only copy of the entry — never
written back to Firestore.** Practice and live scoring is computed once
per session (both robots), never stored on the entry itself
(`entry.accuracy` stays `null` for every `source: "practice"` entry, by
design since P4). Rather than touch the "Alliance Accuracy"/"Script
Status" columns' `getValue` functions (which only ever receive the entry,
not an external sessions map), Match Analytics builds a shallow entry copy
with `accuracy` stamped from `sessionsById.get(entry.sessionId)` before
handing it to the table — the existing columns work completely unchanged.

**P9-4. Excluding a practice/live row in Match Analytics excludes the
whole *session*, not just that one entry — literally reuses
`lib/scout-stats/actions.ts`'s `setSessionExcluded` (the same P5
function).** The prompt says this explicitly ("updates the owning
session's average eligibility consistently with P5"), and it also
resolves a real mechanical question: a practice/live session's two
entries belong to two different robots (sometimes two different
scouts in live/lobby mode), and Scout Accuracy's practice leaderboards
only ever read `practiceSessions.excluded`, never `scoutEntries.excluded`
— so entry-level exclusion for a practice row would silently do nothing
useful. `ConfigModal` grew an optional `sessionExcluded`/
`onToggleSessionExclude` prop pair for exactly this; real-event rows keep
their original entry-level exclude button unchanged.

**P9-5. Import CSV and Recalculate Accuracy are hidden under the Practice
toggle.** Both are real-event-specific tools (`recomputeForEvent` fetches
one event's official matches; CSV import assumes `source: "event"` rows
tied to the active event) and rescoring practice/live sessions already has
its own, more complete home — the Admin Panel's Rescore tab, which can
target any season/event/date range, not just the one active event. Export
CSV stays available in both views since `entriesToCsv` is generic over
whatever schema/entries it's given.

**P9-6. `lib/lobby/scoring.ts`'s `resolveLobbyPairScoring` is reused,
unmodified, for rescoring SOLO sessions too — not just lobby ones.**
Despite its name and P8 origin, it has no lobby-specific logic at all:
given a `LibraryMatch`, an alliance, two entries, a mode, and a
prior-attempt flag, it computes accuracy + session flags. A solo
session's own two robots are exactly that same shape. Reusing it instead
of writing a near-identical "resolve solo scoring" function is what "never
separate logic" means in practice here.

**P9-7. Rescoring never reconstructs historical `priorCompletedAttempt`
— it's always passed as `false`.** The "Repeat Attempt" flag is normally
set at the moment a session finishes, by checking whether this uid had
*already* completed this exact alliance+match *before that moment*.
Re-deriving that retroactively, as of some arbitrary earlier point in
time, would mean replaying the team's entire session history in order —
far more than a hygiene/bug-fix rescore tool needs. A rescore can
therefore make a session's "Repeat Attempt" flag disappear (never
reappear incorrectly) compared to what it showed originally; this is
called out in the Rescore tab implicitly by it being a flag
*recomputation*, not a guarantee of historical fidelity.

**P9-8. "Refresh official scores" calls the exact same
`importLibraryEvent` the Match Library tab's own "Refresh scores" button
already uses** — re-exposed in the Rescore tab for workflow convenience
(refresh, then immediately rescore, without switching tabs), not a second
implementation. It only ever applies to solo/lobby sessions (library-match
-based); live sessions always rescore against a *freshly fetched* FTC API
match within the same Preview click, so there's nothing to "refresh"
first for those.

**P9-9. The Admin Panel's Sessions tab search is deliberately "look up by
exact Session ID" (`getPracticeSession`, a direct doc-id `getDoc`), not a
prefix/fuzzy search.** Session IDs are short, scout-facing, unambiguous
codes shown directly on-screen throughout the app (results screens, Scout
Accuracy's session rows, etc.) — a scout or mentor citing one types the
whole thing. A substring search across the whole `practiceSessions`
collection would need either a full collection scan client-side (fine at
this team's scale, but not what "look up by Session ID" implies) or a
dedicated search index neither Firestore nor this project has; the
browse/filter controls below the lookup box cover "I don't have the exact
ID" instead.

**P9-10. Backups are a one-way export — there is no import/restore
path.** The prompt calls this "a safety net for competition day," which
this delivers (a downloadable snapshot you could hand to FIRST or
reconstruct data from by hand if something went badly wrong), but building
a JSON-import-back-into-Firestore tool is a meaningfully bigger, riskier
feature (write validation, id collisions, partial-failure recovery) that
the prompt never asks for. `lib/admin/backup.ts`'s own doc comment says
this plainly. The exported collections are exactly the prompt's own named
list (`users, teams, scoutEntries, practiceSessions, assignments,
attendance, libraryMatches, auditLog`) — `liveMatches`, `notifications`,
and `lobbies` (all added after this prompt was written, in P7/P8) are
deliberately left out rather than silently expanding scope; a reasonable
follow-up if ever wanted.

**P9-11. What's unverifiable in this sandbox.** No Firebase emulator (no
JVM/Firebase CLI — the standing limitation since P1) and no real
multi-week season's worth of practice/live/lobby data to rescore against:
- The actual dry-run-then-apply flow against real Firestore data, for
  both the event and session Rescore tabs.
- The Backups JSON/CSV downloads against a real, populated team (the
  per-collection `getDocs` queries and `JSON.stringify` shape were
  checked by reading the code, not by running it against live data).
- Firestore `Timestamp` objects inside the JSON backup serialize via their
  own `toJSON()` (`{seconds, nanoseconds}`) rather than an ISO string —
  expected, not a bug, but worth knowing if you ever script against the
  exported file.

## FIX1 — Bugfix Pass 1 (Page Jump, Event Selection, Role Editing)

### FIX1-1: pages that start low, then snap into place

**FIX1-1a. Root cause: the page transition left the outgoing page in the
document flow.** `components/layout/page-transition.tsx` wrapped every route
in an `AnimatePresence` *without* `mode="wait"` (deliberately — see the old
comment about pages not appearing), with a `y: 14`/`scale: 0.985` entrance
and a spring exit. Without `wait`, the exiting page stays mounted, *in flow*,
for the whole exit spring while the new page mounts right below it — so the
new page rendered lower than its final position and snapped up when the old
one unmounted. That is exactly the reported symptom and it applied to every
route, which is why it looked site-wide. Fix: no `AnimatePresence`, no exit;
a keyed `motion.div` that fades in with a 4px nudge and a plain 0.18s tween
(no spring, so position can't overshoot). `pageTransitionVariants` lost its
`exit`/`scale`; the bouncy springs stay on buttons, cards, and toggles.
Dropping `AnimatePresence` also avoids the original "new page invisible until
something re-renders" problem the old comment was guarding against, because
there is no longer an exit to stall.

**FIX1-1b. Stacked child offsets.** `cardEntranceVariants` (stat cards, the
Event Selection grid, My Scouting cards, results screens, login/signup)
entered from `y: 18, scale: 0.97` on top of the page animation. Reduced to
`y: 4, scale: 0.99` so children can't read as the page starting low.

**FIX1-1c. Late-arriving in-flow elements.** Two real ones:
- `components/layout/live-match-pill.tsx` is shown whenever a Firestore
  subscription reports a scout who needs a partner — i.e. *after* the page is
  already on screen — and it was an in-flow element, so it shoved the whole
  page down on arrival. It is now a `fixed` overlay below the mobile topbar,
  clear of the safe-area inset.
- The Practice Scouting landing inserts panels above the Season picker as
  their subscriptions resolve (presence, pending robots, "still in a lobby",
  recent live matches, the Resume banner). It already waited on the paused-
  session query; it now also waits for the live-sessions, lobby, and presence
  queries before rendering, so nothing pops in above the picker afterwards.

**FIX1-1d. Checked and *not* a cause** (so nobody re-investigates):
- *Scroll restoration:* the app is Next.js App Router, whose layout router
  resets scroll to the top of the new segment before paint on navigation. The
  only thing that could have made height grow after that was FIX1-1a's
  lingering old page. I did not add a manual `scrollRestoration` or a
  `useLayoutEffect` scroll reset — it would fight the router's own handling
  for no benefit.
- `VerifyEmailBanner` / `PlaceholderBanner`: the shell renders only after
  auth has resolved (`user`, and so `emailVerified`, are known at first
  paint) and the placeholder banner depends on `pathname` alone, so neither
  arrives late.
- `ScoresReadyWatcher`'s popup and the mobile `Topbar` are already
  `fixed`/`sticky` with constant offsets; nothing sets a safe-area offset
  after mount.
- Fonts come from `next/font` (self-hosted with size adjustment) so they
  don't reflow text late; no page container uses a `layout` prop.

**FIX1-1e. How this was verified — and what wasn't.** This environment has no
Playwright, no browser tooling, and no Java for the Firebase emulators, so I
could not drive a signed-in browser through every route or record layout
shift, and **I did not watch the bug before or after**. What I did do: found
the cause by reading the code, confirmed every route renders through the one
`PageTransition` wrapper (so the fix covers every nav route, including all
Analytics subpages — they share the same shell — and the Admin Panel tabs,
which are in-page state, not routes), and ran `tsc`, `eslint`, `vitest`, and
`next build`. To confirm in a browser: open DevTools > Performance, enable
"Layout Shift Regions" (Rendering tab), set CPU to 6x slowdown and network to
Slow 4G, and click through every sidebar entry — nothing should flash a
shift region at the top of the page content. A Playwright script
(visit each route as an emulator test user, sample the first content
element's `getBoundingClientRect().top` for 1s) is the obvious automated
follow-up once the emulators can run.

### FIX1-2: Event Selection

**FIX1-2a. `getEventStatus(event, now)` compares calendar days, in the
event's own timezone.** (`lib/ftc/event-status.ts`.) "Today is between start
and end" is a date comparison, not an instant one: the old server helper
parsed the API's date-only strings as UTC midnights, which made an event
"in progress" the evening before it began for US timezones and "completed"
the evening of its last day. It now compares `YYYY-MM-DD` strings using the
event's `timezone` when valid, falling back to the viewer's local day. The
server action (`lib/ftc/actions.ts`) calls the same helper, so there is one
definition. `FtcEvent.status` is frozen at fetch time (and copied onto the
team doc), so **display code recomputes with `getEventStatus` rather than
trusting `.status`**.

**FIX1-2b. Order, filter, sort.** Default order is In Progress → Upcoming
(soonest first) → Completed (most recent first). Search narrows first and the
All/In Progress/Upcoming/Completed counts describe *what the search found*, so
the segmented control never promises hidden events. Group headings (with
counts) appear when sorting by Status; the two date sorts are one flat list.
"Now" is captured once per visit so badges, counts, and groups always agree.

**FIX1-2c. Data model.** `teams/{id}.activeEventCode` (+ `activeSeasonId`,
`activeEvent`) stay as the **primary** event so nothing that read them
breaks; `activeEventCodes: string[]` is the full list (always including the
primary) and `activeEvents: FtcEvent[]` holds the denormalized event objects
for the same reason `activeEvent` always has (pages don't re-hit the FIRST API
just to show a name). The user's spec only named `activeEventCodes`; the
extra array is what lets every consumer render names/dates with no extra
fetch. `readActiveEvents()` derives a one-event list from a legacy doc at read
time, so un-migrated teams work immediately; additionally the first *admin*
session to see an un-migrated team writes `activeEventCodes = [activeEventCode]`
(`useActiveEvents`, once per team per page load). Primary rules: the first
selected event is primary; removing the primary promotes the next; the
Selected-events panel's star changes it. Limit: 10 (`MAX_ACTIVE_EVENTS`).

**FIX1-2d. Rules.** `validActiveEvents()` in `firestore.rules` (only when a
write carries `activeEventCodes`): a list of at most 10; with a primary it
must contain the primary, without one it must be empty; `activeEvents` (if
present) the same length. Limitation worth knowing: **Firestore rules can't
loop, so "every element is a string" isn't checkable** — the write is
admin-only and `buildActiveEventsFields()` is the only writer. Writes that
carry no `activeEventCodes` (a pre-migration doc, or an old single-event
write) still pass, but on a migrated doc an old-style write that moves only
the primary is rejected, since it would leave the list out of sync.

**FIX1-2e. Removal confirmation.** Selecting an event no longer *replaces*
the active one, so the old "Switch active event?" dialog is gone. Removing an
event now asks first when the team has already scouted Real Event entries for
it ("scouting data in progress is tied to it"); with no data it just
removes. I read "in progress" as "any scouted data tied to it" because a
precise in-progress signal doesn't exist (offline pending writes are per-device
and invisible to an admin on another device). The dialog says the data is kept.

**FIX1-2f. Consumers of the old single active event** — every one was updated
(`useActiveEvent()` still exists, returning the primary, but nothing that
picks an event uses it any more):
- *Match Scout Form:* an Event select in the Assigned Match section, only when
  more than one event is active. Default is an In Progress active event
  (primary preferred if it is one), otherwise the primary
  (`pickDefaultActiveEvent`). The pick is per-visit state, not persisted.
  Changing event clears the picked match and team (they belonged to the old
  event) and any loaded assignment. With one active event nothing is shown and
  behavior is unchanged.
- *Assignments:* the event select lists active events first (primary starred),
  then an "Other events" divider, then the rest of the season. Default is the
  primary.
- *Match Analytics:* one event at a time, with an event select (shown only for
  more than one active event); import/export/recalculate are per event, so
  merging events into one table would have been wrong for them.
- *My Scouting:* one "My upcoming assignments" panel per active event.
- *Scout Accuracy / My Scouting filters:* `useRealEventOptions(entries,
  activeEvents)` lists active events first, by name, and includes ones with no
  scouted data yet; data-only events follow, as before.
- *People:* "Attending" means attending at *any* active event.
- *Live Practice:* the fallback event (when the stream link doesn't identify
  one) is `pickDefaultActiveEvent`.
- *Online/pending-sync indicator:* subscribes to every active event and shows
  the summed pending count.
- *Event Selection's own "active event" summary card* (three FIRST API queries)
  stays for the primary only — one per active event would multiply those calls.

**FIX1-2g. Selected-events panel + condensed bar.** The big panel stays in
the flow and simply scrolls away; the condensed bar lives in a **zero-height
`sticky` slot** with an absolutely positioned child, so showing or hiding it
changes no layout box and nothing below can jump (stronger than reserving the
panel's height). An `IntersectionObserver` on the big panel (with a
`rootMargin` equal to the bar's pin offset — below the mobile topbar, clear of
the safe-area inset) flips it; there is no scroll listener. The bar uses
`.glass-overlay` (the solid backing the other floating UI uses). The slot has a
negative bottom margin that cancels the page's `gap-6`, so **the panel must be
a direct child of the page's `flex flex-col gap-6` root** (noted in its
docblock). Condensed chips: the first three, then `+N` on tablets and up;
phones show every chip in a horizontally scrolling row. The bar's top offset
(5.25rem on phones, 0.75rem at `lg`) is the same one `LiveMatchPill` uses, so
the two can overlap if both are visible at once on a phone — the pill is
transient and dismissible, so I left it.

**FIX1-2h. Small things.** The page heading and nav label are now "Active
Events". Cards show the checkbox affordance only to admins; non-admins see the
same cards read-only.

### FIX1-3: Team Management role editing

**FIX1-3a. It wasn't actually missing — it was inline and cramped.** The
prompt says role editing "was never added", but P1 *did* build it: an inline
primary-role `Select`, tiny secondary-role toggle chips, and an admin `Switch`
on each `MemberRow`. What genuinely didn't exist: an editor with Save/Cancel,
audit entries, rules covering last-admin/role validity, and tests. I replaced
the inline controls with the editor dialog (the cramped inline chips are
likely why it read as absent) rather than layering a second UI on top.

**FIX1-3b. UX.** Rows show the primary role as a coloured pill and secondary
roles as uncoloured pills; admins get an **Edit** button (non-admins see no
button; owner rows show a "Locked" marker with the reason). The dialog
(`.glass-overlay` backing, 40px touch targets) has a primary-role select whose
options are the coloured pills, secondary-role toggle chips (the primary is
excluded — a role can't be both), and the admin switch. Save is disabled until
something changed; a successful save plays the theme-glow pulse on the dialog
and then the row, and the change reaches other users through the existing
realtime roster. Secondary roles are stored normalized (primary removed,
canonical `ROLES` order) so equal selections compare equal.

**FIX1-3c. Protections, UI and rules both** (`lib/member-access.ts` is the UI
mirror of the rules; the rules are the enforcement):
- non-admins edit nothing, their own row included;
- an owner's roles/admin status can't be changed by anyone, the owner included;
- an admin may edit their own *roles*;
- **last-admin safeguard = an admin cannot remove their *own* admin flag.**
  Rules can't count admins, so "the last admin can't be demoted" is enforced
  by the equivalent, race-free rule: the only way the last admin could ever be
  demoted is by themself, and two admins demoting each other simultaneously
  fails because the second write no longer passes `isAdmin()`. **Behavior
  change:** an admin who wants to step down now asks another admin (the
  editor says so); before, the UI allowed self-demotion while 2+ admins
  existed. The UI also still blocks demoting the sole admin explicitly.
- rules additionally require real role ids (`validRoleIds()` duplicates
  `lib/roles.ts` — **keep them in sync when adding a role**), a boolean
  `isAdmin`, a list `secondaryRoles` of at most 9, and pin `teamId` for admin
  updates (the self-update rule already did).

**FIX1-3d. Audit.** One `edit-member-roles` entry per save, with
`target: { targetUid, targetName }` and full `before`/`after` of
`{ primaryRole, secondaryRoles, isAdmin }`, written **in the same batch** as
the change (`updateMemberAccess` in `lib/team-members.ts`) so a role change
can never land without its entry — and if the batch is rejected, no orphan
entry exists. It appears in the Admin Panel's Audit Log tab under "Edit Member
Roles". The editor's `before` is the roster row at save time, not at open
time, so the entry reflects what was really overwritten.

**FIX1-3e. Downstream role filters.** Scout Accuracy and Assignments read
`primaryRole`/`secondaryRoles` straight off the same `users` docs and nothing
about their shape changed, so their role filters pick up edits through the
existing realtime roster; the only difference is that secondaries no longer
include the primary role (which no UI path produced before either).

### FIX1: verification summary

Run and passing here: `tsc --noEmit`, `eslint` (0 errors; the one existing
`useVirtualizer` warning is untouched), `vitest` (new: `event-status`,
`active-events`, `member-access`), and `next build`. After installing
Microsoft OpenJDK 21 (the Temurin winget package failed its installer-hash
check, so it was not used), `npm run test:rules` ran the Firestore emulator:
**all 94 `firestore.rules.test.ts` tests pass**, including the new "FIX1"
blocks (active events, role editing, the role-change + audit batch). The
`PERMISSION_DENIED` lines in that output are the expected denials from
`assertFails`.

**`api-routes.emulator.test.ts` still fails (11 of 12) and is not caused by
FIX1.** It had never been run before (no Java), and needed two harness fixes
just to load — a `server-only` alias to `test-stubs/server-only.ts` in
`vitest.rules.config.ts`, and a runtime-generated throwaway RSA key instead of
a truncated placeholder PEM (firebase-admin really parses it). Past that, every
route call returns 401 because the Admin SDK's `verifyIdToken` rejects the Auth
emulator's tokens — it fails before reaching any route logic. FIX1's only
change to a route there is two extra fields in `/api/team/create`'s new-team
document. I did not baseline the suite against the pre-FIX1 code, and I have
not chased the token-verification failure; it needs its own look.
**Not run anywhere:** the browser checks in FIX1-1e and a manual pass of the
Event Selection sticky bar on a real phone.

## P10 — Analytics Foundation, Team Profile, Team Averages & Rankings

**P10-0. No clarifying questions were asked** — nothing blocked; every call
below is a default I'd have recommended. The prompt's context block says
React + Vite + React Router; this is still Next.js App Router (see P1-1), so
"route `/analytics/teams/:teamNumber`" is `app/(app)/analytics/teams/[teamNumber]/page.tsx`
and `useParams()`/`useSearchParams()` replace React Router's.

### Filters (`lib/analytics/filters.ts`, `filter-context.tsx`, `components/analytics/filter-bar.tsx`)

**P10-1. The URL query string is the single source of truth.** The provider
parses `useSearchParams()` on every render and writes with
`window.history.pushState`/`replaceState` (Next's router integrates both —
documented in `01-getting-started/04-linking-and-navigating.md`), so filters
are shareable, Back restores them, and nothing needs syncing between React
state and the URL. The catch: **a plain `<Link>` between Analytics pages would
silently reset the filters**, so every link between them carries the query —
`AnalyticsTabs`, the team tables' rows, and Team Profile's links all use
`AnalyticsLink`/`useAnalyticsHref`. Use those for any new link between
Analytics pages. A change pushes a history entry (Back undoes it); typing a
custom accuracy `replace`s instead, so one number isn't a history entry per
keystroke. Params: `game`, `events` (`all` or comma-separated codes; absent =
active events), `practice=1`, `mode`, `source`, `acc` (1-100; absent = ALL).
Only non-defaults are written; other params on the URL (a page's own
`team=`/`match=`) are preserved (`mergeFilterParams`). Invalid values fall
back to defaults instead of producing an impossible state. The provider is
wrapped in `<Suspense>` (required for `useSearchParams`), with a
fixed-height fallback so the page doesn't shift when it resolves.

**P10-2. Event scope has three kinds, not two.** `active` (default — the
team's active events via `useActiveEvents()`), `all`, and `custom` (exact
codes). In **Practice** mode there is no such thing as an "active" library
event, so `active` reads as every event there (the control says "All events").
Changing Game or toggling Practice resets the Event scope to the default,
since the available events differ. Unchecking the last custom event falls
back to `active` rather than a match-nothing selection. Status chips come from
`getEventStatus` against the FIRST API event when known (active events, or the
game's season event list — a cached query shared with Event Selection).

**P10-3. Game select.** Options are `getEnabledSeasons()`; the game id is the
season id, which equals the form id and the `GAMES` key (all `biobuzz` today).
`parseFilters` validates it against `GAMES`, so an unknown `game=` falls back.

**P10-4. Single-event mode** is a per-page request: a page calls
`useSingleEventMode()` and the layout-level bar's Event control becomes a
single select while it's mounted (the spec's `singleEvent` prop can't be a
prop, since the bar lives in the layout above every page). Only real-event
data uses it; Practice still spans events. `useSingleEvent()` resolves the
page's one event: explicit pick, else `pickDefaultActiveEvent`, else the first
event with data. **Only Match Scout Analytics uses it** (its Import CSV /
Recalculate Accuracy act on one event); no P10 page needed it otherwise.

**P10-5. "N of M entries shown".** M = every entry matching Game / Event /
Practice, *including* excluded ones; N = what a page may use (excluded
dropped, accuracy threshold applied). The bar also says how many were hidden
and why. On the raw Match Scout Analytics route there's no accuracy filter and
excluded entries stay visible, so it reads "M of M" for the pinned event.

### Accuracy filter semantics

**P10-6. Alliance accuracy is read, never recomputed.** Real-event entries
carry the value the shared engine stored on them (`lib/analytics/recompute.ts`
via `lib/accuracy/engine.ts`) — `entry.accuracy.value` (0-1) when `status ===
"complete"`; practice/live entries take their **session's** accuracy
(practice scoring is per session — P9), and, as Match Scout Analytics has
always displayed, the entry's `accuracy` is replaced by the session's. The
catch: a real-event entry that has never been recomputed has no accuracy
(`null`), so under a threshold it's dropped until someone runs Recalculate
Accuracy — which already runs after every Scout Form submit.

**P10-7. The threshold compares the whole percent the UI shows** (the same
`Math.round` `getStatus` uses). An alliance displayed as "75%" passes a 75%
threshold instead of being dropped for being 74.6. This reads the prompt's "at
or above the threshold" against what the user can see; if you want the raw
fraction instead it's one line in `passesAccuracy`.

**P10-8. ALL keeps entries whose accuracy can't be computed; any threshold
drops them.** Excluded entries are ignored in every case: `entry.excluded` for
real events, and `session.excluded` (the Config modal's stats exclusion) for
practice/live entries. Match Scout Analytics is the one place excluded entries
stay visible.

**P10-9. Custom field**: digits only, at most 3, clamped to 1-100 ("0" → 1,
"150" → 100, applied on typing; shown clamped on blur). Clicking **Custom**
with nothing typed leaves the filter at ALL until a number is entered. A value
that equals a preset (75/85/90) shows as that preset.

### Data layer (`lib/analytics/entries.ts`, `data-context.tsx`)

**P10-10. One subscription.** `AnalyticsDataProvider` (Analytics layout)
holds a single team-wide `scoutEntries` subscription and, only while Practice
is on, one `practiceSessions` subscription; pages read via
`useAnalyticsEntries(filters?, options?)` / `useTeamStats()`. Match Scout
Analytics previously subscribed to one event's entries; it now reads this shared
team-wide stream and filters client-side —
fine at this team's scale (see P9-style reasoning), and it no longer
re-subscribes when the event changes. `useAnalyticsEntries(filters)` accepts an
override and `{ applyAccuracy, includeExcluded }`; with neither it returns the
provider's already-computed selection.

### Team stats and ranking (`lib/analytics/team-stats.ts`)

**P10-11. Definitions** (all schema-driven — iterate `schema.sections`, never
BIOBUZZ's field names; a test builds stats for an unrelated made-up schema):
- *stdDev* is the **sample** standard deviation (n-1); 0 with one entry.
- *consistency* = `100 − (stdDev / avgTotal) × 100`, clamped to 0-100 (higher =
  steadier; a steady zero-scorer reads 100). The prompt only said "derived from
  stdDev".
- *trend*: the last 3 entries by `submittedAt` vs the overall average; needs
  at least 4 entries (otherwise `direction: null`); "flat" within 5% of the
  overall average (and at least 1 point).
- *fieldStats*: counters get avg/high; toggles and checkboxes get a rate
  (0-100); scored fields also get `avgPoints`. `incidentRates` is every
  checkbox field (the General incidents), by key.
- *Element breakdown* (Team Profile's "breakdowns by game element"): added an
  optional `element` to `ScoutFormField` (`lib/scout-form/schema.ts`) so Hive
  groups the Autonomous *and* Teleoperated Tip Hive counters, and Park groups
  Autonomous and Endgame. Unset falls back to the sub-group label, then the
  field's own label. The elements' points add up to the average score (tested).
- `buildTeamStats(entries, schema, { teamNumber?, teamName? })` is for ONE
  team and never filters (callers pass `selectAnalyticsEntries`' `used`);
  `buildAllTeamStats` groups. `teamName` is an option because the function is
  pure — names come from the FIRST API (`use-event-data.ts`).

**P10-12. Low-sample teams are unranked.** `rankTeams(stats, metric, min = 2)`
ranks teams at or above `min` entries with `rankWithTies` (1, 2, 2, 4) and
lists the rest after them, flagged, with **no rank number** ("—") — otherwise a
single lucky match could take #1, and giving them ranks would interleave
numbers with real ones. The Rankings page's Min. entries control (1-5)
adjusts it; 1 ranks everyone. Values are compared at 2 decimals so float noise
can't split a genuine tie; ties order by team number. Sorting any column
reorders rows only — rank numbers come from `rankTeams`.

### Team Profile, Averages, Rankings

**P10-13. Official rank/record** needed a new server action,
`getRankingsForEvent` (FIRST API `/{season}/rankings/{eventCode}`, parsed
defensively for `rankings`/`Rankings`). **It is unverified against the live
API** — this environment has no FIRST credentials, and the field names are
from memory of the v2.0 API. Any failure or empty result simply omits the
chip (Team Profile never depends on it). It's only shown for real events (not
Practice). Team names use the existing `getTeamsForEvent` per event in scope;
failures leave the name as "—".

**P10-14. Chart.** There was no chart library, so `score-chart.tsx` is plain
SVG on theme tokens: one series (total score by match) in `--color-accent`
(7:1+ against both themes' backgrounds, so the graphical-object contrast
floor holds), a labelled average reference line, hairline solid gridlines,
8px markers with a 2px surface ring, a snapping crosshair + tooltip that
also works from the keyboard (arrow keys), and the match list beside it as
the table view. One series → no legend (the card title names it), and the
`dataviz` palette validator doesn't apply (no categorical palette). Dense
series (>40 matches) show only the hovered marker.

**P10-15. Links out of Team Profile.** Each match row links to Match
Breakdown (`?event=&match=`) and to the raw entry in Match Scout Analytics
(`?events=&team=&match=`, which that page turns into its initial search).
**Match Breakdown is still a placeholder** (not in scope), so that link lands
on the placeholder and its params are not read yet. Back uses
`router.back()` when there is history and falls back to Team Averages for a
deep link; filters are in the URL, so they come back with it.

**P10-16. Scope notes.** The filter bar appears above *every* Analytics
subpage (it's in the layout), including the placeholder pages and Scout
Status — Scout Status's own page is untouched. The placeholder banner is gone
from Team Averages, Rankings, and Team Profile (`REALIZED_PAGES`). Team
Averages' virtualization uses `@tanstack/react-virtual` like the entry table,
so it shows the same React Compiler "incompatible library" lint *warning*.

### P10: verification

Run and passing: `tsc`, `eslint` (0 errors; 2 `useVirtualizer` warnings),
`vitest` (new: `filters`, `entries`, `team-stats`, `chart` — 297 tests total),
`next build`. **Not run:** the Firestore emulator tests (P10 adds no
collections, fields, or rules, so none were needed) and — importantly —
**no browser check at all**: this environment can't sign in, so the filter bar's
URL round-trip, the event popover, the sticky table columns, the chart's
hover, and every page's layout are verified only by type-checking, build, and
reading the code. Worth a manual pass (see the commands block below).

## P11 — Match Breakdown & Team Breakdown

**P11-0. No clarifying questions were asked** — nothing blocked. The prompt's
Vite/React Router wording maps to Next.js as in P1-1; the pages stay at
`/analytics/match-breakdown` and `/analytics/team-breakdown`.

### Match Breakdown

**P11-1. Where the official matches come from.** Real events: the FIRST API,
`getMatchesForEvent` for Practice, Qualification, and Playoff per event in the
filter's scope (`useEventMatches`, a tab-level cache like the other
`use-event-data` hooks; "All events" = every event that has scouted data).
Practice mode: the imported **library matches** for the chosen game (and events,
if any), always treated as played. The list is *official matches*, so a scouted
entry whose match isn't in it (e.g. event practice matches — the FIRST API
doesn't track them, see the Event Selection summary's "Practice: not tracked")
can't appear; rather than hide that silently, the page says how many scouted
entries aren't listed and points at Match Scout Analytics.

**P11-2. Alliance accuracy is computed here, with the shared engine, from the
official score.** `buildMatchBreakdowns` calls the same
`computeAllianceAccuracy` wrapper (`lib/analytics/accuracy.ts` → the engine)
Match Analytics' recompute uses, with the official score + penalty points and
the alliance's entries — rather than reading the value stored on the entry —
so the number always agrees with the official score printed beside it, even if
nobody has run Recalculate Accuracy. Consequence: the filter bar's "N of M" (P10)
counts by *stored* accuracy and can differ slightly from what this page hides.
The threshold uses the same displayed-whole-percent rule as P10-7.

**P11-3. The accuracy filter is applied per alliance, in the pure function.**
An alliance below the threshold comes back with its scouted total, per-team
entries, and bar share already withheld (`scoutedTotal: null`, `entry: null`,
`redFraction: null`), so no rendering path can leak them. It keeps: the
accuracy (the reason label quotes it — "Below accuracy filter (62%)"), the
official score (not a scouted number), the team links, and the coverage count.
An alliance whose accuracy *can't be computed* (a robot unscouted, or no
official score yet) is withheld too under any threshold, with its own reason
("Accuracy can't be computed — filtered out at 75%+"), matching P10's rule that
a threshold drops uncomputable entries. An alliance with no scouted robot is
"Not scouted", never "below accuracy". With ALL nothing is withheld.

**P11-4. Totals.** The displayed alliance total is the **sum of the scouted
robot scores** (as specified); the engine's accuracy formula separately adds the
penalty points to that sum, which is why a robot total of 40 can score 100%
against an official 50 that includes 10 penalty. The official line reads
`Official 85 (incl. 10 penalty)` only when penalty points were awarded, and is
absent when there is no official score.

**P11-5. Winner.** Official result when the match is played and both scores
exist (tie possible); otherwise the scouted totals, but only when *both*
alliances are fully scouted and not withheld (a half-scouted side would just
look like it lost); otherwise none. The bar's red share uses scouted totals, and
is an empty track unless both alliances are shown — it never shows a proportion
built from a withheld or missing side. The detail says whether the winner is
official or from scouted totals.

**P11-6. Entries per robot.** The latest entry per team (as the engine does);
excluded entries are dropped before this page sees them. In **Practice** mode an
alliance can have many sessions (different scouts, repeats); one alliance is one
session's scouting, so the **most recent session's** entries are used rather than
mixing one robot from each session.

**P11-7. Detail = an expandable row**, accordion-style (one open at a time),
animated height with the shared spring. Team numbers are links *outside* the
toggle button so tapping one opens its profile rather than the drawer. The
`?event=&match=` link Team Profile already emits (P10-15) now works: that match
opens and scrolls into view. "View raw entries" opens Match Scout Analytics with
`?events=<code>&match=<label>` (its initial search).

**P11-8. Detail content** (schema-driven, `summarizeEntry`): counters summed by
game element ("Hive ×3"), toggles that were on (a label that repeats across
phases gets its phase: "Park (auto)", "Park (endgame)"), and the checkbox
incidents as warning chips. The auto/teleop/endgame bar is stacked; its length
is scaled to the best of the match's four robots so they compare.

**P11-9. Phase colors.** Auto / Teleop / Endgame use categorical slots 1-3 of
the dataviz reference palette (blue `#3987e5`, orange `#d95926`, aqua
`#199e70`), as CSS variables in `globals.css`. I first tried the app's role
colors (sky / violet / emerald) — they **fail** the validator's CVD check
(worst adjacent ΔE 5.2), so I switched. The reference trio passes every gate
`--pairs all` against both theme surfaces (`#17070c`, `#16110a`): lightness band,
chroma, CVD ΔE 9.4, normal-vision ΔE 20.9, ≥3:1 contrast. They are deliberately
fixed across themes (not derived from the accent), 2px-gapped, with the values
also written as text and a line-key legend, so colour is never the only cue.
Alliance red/blue keep the placeholder's red/blue gradients (identity colors, not
a series palette).

### Team Breakdown

**P11-10. Key stats are derived from the schema, not hard-coded.**
`buildKeyStats`: scored **counters grouped by label and summed** — "Tip Hive"
(autonomous + teleop) and "Pollen and Nectar" (flower + garden), exactly the two
the prompt asks for — and each scored **toggle as its own rate**, with the phase
added where a label repeats: Leave, Park (auto), Park (endgame), Bottom Nectar.
(The prompt's "Park rate (auto and endgame)" is shown as two rates, since they
are two different fields.) Grouping by label would also merge two unrelated
fields that happen to share a name in a future game — at that point give them
distinct labels.

**P11-11. Reliability.** A schema field can now be flagged `reliability: true`
(`ScoutFormField`); BIOBUZZ flags **Died During Match, Never Started Match,
Disabled by FTC, Recovered from Freeze, Tipped Over** (robot failures), and *not*
the yellow/red cards (conduct). `TeamStats.reliability` (new in P11) is the share
of entries with **none** of them, computed per entry so a match with two
incidents counts once; null when the schema flags none. The pill: ≥ 90% "Reliable",
75-89% "Some issues", < 75% "Unreliable" (icon + word + number, with the actual
incident rates in its tooltip); no pill when null. The thresholds are my
defaults.

**P11-12. Controls.** Search (team number or name), sort (avg total, times
scouted, reliability, team number — best first, team-number ties, no-value
teams last), and the low-sample badge at the same minimum (2) as Rankings' default
(no control here; the prompt didn't ask for one). Cards are links to Team Profile
with the shared hover spring/glow; the skeleton grid uses the cards' grid and
approximate height. Practice mode needs no page logic — `useTeamStats()` (P10)
already switches datasets.

**P11-13. Scope.** The placeholder banners are removed from both pages
(`REALIZED_PAGES`); Scout Status untouched; the mock `lib/mock-data.ts` match and
team data is no longer used by these two pages.

### P11: verification

Run and passing: `tsc`, `eslint` (0 errors; the same 2 virtualizer warnings),
`vitest` (new: `match-breakdown` — 29, `team-card` — 9, plus reliability cases in
`team-stats`; 338 total), `next build`. No Firestore collections/rules changed, so
no emulator run was needed. **No browser check** (this environment can't sign
in): the animated bar, the expand/collapse, deep-link scroll, and the card grid are
verified by types, build, and reading only. In particular the FIRST API match
list needs the live API (`FTC_API_*`) — as with P10-13, nothing here could call it.

## P12 — Pick List (Official Rank, Scouted Rank, EPA, Pick Likelihood)

**P12-0. No clarifying questions were asked** — nothing blocked. As in P1-1 the
prompt's Vite/React Router wording maps to Next.js (`/analytics/pick-list`).
The project had no drag-and-drop library (framer-motion's `Reorder` can't move
items *between* columns), so **`@dnd-kit/core`, `@dnd-kit/sortable`, and
`@dnd-kit/utilities` were added** to `package.json`.

### Data

**P12-1. Official rank.** `getRankingsForEvent` already existed from P10; P12
adds ranking points to `FtcRanking.rankingPoints`, read from the payload's
`sortOrder1` (falling back to `qualAverage`). **Both field names are from
memory of the v2.0 API and unverified** — this environment has no FIRST
credentials. Rank and record come from the same payload (P10-13). Our team
number is `teams/{teamId}.number`; our team is kept out of both lists and
pinned in a header card (official rank, scouted rank, record, ranking points,
EPA).

**P12-2. One event, even in Practice mode.** The page calls
`useSingleEventMode(true, true)` (new `includePractice` argument), so the filter
bar's Event control is a single select *always* — the O. columns belong to one real
event, and a multi-event selection would have no sensible meaning. The event
is `useSingleEvent()`'s: the viewer's pick, else an **In Progress** active
event, else the primary. (The prompt says "the primary active event"; with
several active events at once, preferring the one actually happening is the
same rule the Scout Form uses — FIX1-2f — and it equals the primary whenever
one event is active.) Scouted data is the shared filters **pinned to that event**
(`useAnalyticsEntries` with `events = custom [code]`), so the accuracy filter,
Game, and Practice all apply: in Practice mode the S. columns use practice
data for that event's teams while O. columns stay official. Official data is
never touched by the accuracy filter.

**P12-3. The field and the columns.** Teams = the event's team list ∪ its
rankings ∪ teams with scouted data ∪ already-picked teams (so a pick never
vanishes if the API hiccups). **S. Rank** = `rankWithTies` on average total over
the whole field *including our team* (so it matches the header card), `?` with
no scouted data; S. Avg / S. High are `-` then. (The prompt says both "`?` when no
data" for S. Rank and "`-` for S. columns"; I used `?` for the rank and `-` for the
rest.) **O. Rank** `-` for an unranked team; unranked teams sort after ranked
ones, by team number. The Pick % scale uses `max(field size, rankings count)`.

### O. EPA (`lib/epa`)

**P12-4. Algorithm as specified**, with these calls:
- *Input:* the event's played **Qualification** matches, ordered by match number
  (the qualification schedule is numbered in play order; I used that rather than
  `startTime`, which can be absent or `actualStartTime`).
- *Score:* the alliance score **minus the penalty points it was awarded**
  (`penaltyPoints`, i.e. `scoreRedFoul`/`scoreBlueFoul` — P3's reading of that
  field is "points this alliance got from the opponent's fouls, already folded
  into the score"), floored at 0. The API *does* expose it, so the raw-score
  fallback only applies per alliance when that field is `null`. Same
  unverified-field caveat as P12-1.
- *Update:* every team starts at (average alliance score) / 2; per alliance,
  `error = actual − Σ pre-match EPAs`, `epa += max(0.1, 1/(n+1)) × error / 2`,
  both alliances predicted from the ratings *before* the match.
- **Two passes by default** (`DEFAULT_EPA_PASSES`) — the prompt allows a second
  smoothing pass "if tests show better results", and they do. Measured over 20
  seeds of simulated events with hidden strengths (Spearman against the truth): 24
  teams × 12 matches, noise 8 — one pass median **0.946** / min 0.899, two passes
  median 0.972 / min 0.937; 6 matches each — min 0.783 → 0.861; noisy (15) events
  improve too. One pass alone already clears the 0.85 bar (tested), so the second
  pass is a refinement; `passes: 1` gives the plain forward pass.
- Teams with no official matches have no EPA (`-`); a team with one match gets a
  rating from that match alone (tested, no NaN).

**P12-5. EPA setting.** "EPA: Calculated / Off" lives in a **Columns** popover,
default Calculated. "Remembered per user" is stored in **this browser's
localStorage keyed by the user's uid** (`useEpaMode`): two people on one browser
keep separate settings, but it does **not** follow someone to another device.
Putting it on the `users` doc would need a rules change to the self-update
rule (which deliberately pins every field but name/theme); not worth it for a
display toggle. When Off, the column, the header card's EPA, and the matches
fetch it needs are skipped.

### Pick % (`lib/pickLikelihood`)

**P12-6. Exactly the specified curve**, all constants in
`lib/pickLikelihood/config.ts` (`MAX_PICK_PROBABILITY` 0.95, `MIN_SCALE` 4,
`TEAM_COUNT_DIVISOR` 5, `TINY_PROBABILITY` 0.005): `gap = candidate − ours`;
`gap ≤ 0` → 0%; else `0.95 × (1 − exp(−(gap/scale)²))`, `scale = max(4, teams/5)`;
unknown rank on either side → `-`. Display is a whole percent, `<1%` for a tiny
non-zero value, coloured red→green (HSL hue 0-120) with the number always
printed, and a tooltip headed **"Estimate, not a prediction"** that states the gap
("Ranked 4 below us (rank 9 vs our 5)"). For scale: on a 40-team event the team
ranked one below us reads about 1.5%, eight below 60%. **This is a rough model:**
real alliance selection depends on event size, alliance count, declines, and
strategy none of it knows, and the constants are meant to be tuned against real
events (see the config file's header).

### Board, persistence, permissions

**P12-7. Storage: `pickLists/{teamId}_{eventCode}`** = `{ teamId, eventCode,
picked: number[], updatedBy (uid), updatedByName, updatedAt }`. `updatedByName`
is stored (denormalized) so "Last edited by X" needs no roster lookup; it is the
name at the time of the edit.

**P12-8. Concurrency: ops, not arrays.** Every change is a `PickOp` (`place`
"put team before team", `remove`, `move` ±1, `reset`) applied inside a Firestore
**transaction** to the list *as stored at commit time* (`editPickList` in
`lib/pick-list/store.ts`); a drag's final order becomes "put this team before
whatever now follows it" (`placeOpFromList`). So two people editing at once
compose. Verified against the Firestore emulator: simultaneous adds from two
editors (including 8 at once) all land with no duplicates, and an add + a remove
at the same moment both apply. Costs: transactions need a connection, so there
are **no offline edits** (a failure shows a dismissible message); and the UI
shows the user's own change immediately but pins that optimistic list to the
server snapshot it was computed from, so any newer snapshot — theirs landing, or a
teammate's — replaces it and it can't mask someone else's edit.

**P12-9. Permissions.** `can('editPickList')` = admins, or a primary **or
secondary** role of Lead Strategist, Lead Scout, Team Coach, Drive Team
(`lib/pick-list/permissions.ts`, mirrored in `firestore.rules`'
`canEditPickList()` — **keep the two role lists in sync**). Everyone else gets a
view-only board (no handles/buttons) that still updates live, with a banner saying
so. Rules: any teammate may read — the read rule keys off the doc id's team prefix
(`id.split('_')[0]`), because a rule on `resource.data` would deny the first read
of a list that doesn't exist yet; create/update need an editor, the doc id
`{teamId}_{eventCode}`, `updatedBy == auth.uid`, a `picked` list of ≤ 100 (rules
can't check the *elements*); delete is denied.

**P12-10. Audit.** Each change writes an `edit-pick-list` entry (before/after
`picked`) **in the same transaction**. That needed a rules change: `auditLog`
creates were admin-only, but most pick-list editors aren't admins, so
non-admin editors may now create **only** `edit-pick-list` entries (still as
themselves, same team; they still can't read the log). Dragging a team is one
change, but a busy session is many log rows — as the prompt asked ("each change").

**P12-11. UI.** Available lists in official-rank order by default; the sort
control is a Select (O. Rank / S. Rank best-first, the rest high-first) and
search matches number or name. Drag uses a **grip handle only** (so the page still
scrolls on touch; touch needs a short press-and-hold), with a glowing drag
overlay and a drop indicator; every action also has Add / Move up / Move down /
Remove buttons (44px targets), and the keyboard sensor works on the handle.
Dropping a Picked team back on Available removes it. Below `lg` the columns become
**Available / Picked (n)** tabs. Moves animate with the shared spring (framer
layout on a wrapper around dnd-kit's own drag transform). "Reset list" confirms,
and "Last edited by X · time" pulses on every change, yours or a teammate's.
Skeletons reserve the layout, and the page waits for the team list, rankings,
matches (when EPA is on), entries, and the stored list before drawing, so rows
don't reorder when data arrives.

### P12: verification

Run and passing: `tsc`, `eslint` (0 errors; the same 2 virtualizer warnings),
`vitest` (new: `epa` 21, `pickLikelihood` 10, `pick-list` 33; 402 total),
`next build`, and the **Firestore emulator** (`firestore.rules.test.ts`, 114
tests, 20 new for P12: read/write permissions by primary/secondary role, doc-id
and shape rules, the audit carve-out, and the three concurrent-transaction cases).
`api-routes.emulator.test.ts` still fails as before (the Auth emulator's tokens are
rejected, unrelated to P12). **Not verified:** any browser behaviour — drag and
drop with a mouse, touch, and keyboard, the mobile tabs, the animations — and
the live FIRST rankings/matches payloads, none of which this environment can
exercise.

## P13 — Role Dashboards

**P13-0. No clarifying questions were asked** — nothing blocked. As in P1-1 the
prompt's Vite/React Router wording maps to Next.js; the page is still
`/dashboard`. The mock-data placeholder (and its banner) is gone.

### Shared data & read counts

**P13-1. One provider, one subscription per source, only what the role needs.**
`DashboardProvider` (`lib/dashboard/data.tsx`) owns every subscription and every
derived value; widgets only read context (`useDashboard()`, `useOurTeamEvent()`)
and never fetch. Which Firestore sources are live depends on the role being
viewed (`ROLE_SOURCES` in `lib/dashboard/roles.ts`; a hook can't be conditional
so each is gated by passing `null`):

| Always | `scoutEntries` (one team-wide query) + the FIRST API for the selected event (matches, rankings, teams — tab-cached, one fetch per event) |
|---|---|
| Match Scout | + members, all practice sessions, match library, assignments |
| Lead Scout | + members, sessions, attendance, assignments |
| Team Coach | + members, sessions, attendance |
| Lead Strategist | + the event's pick list (one doc) |
| Pit Scout / Pit Team / Drive Team / Media / Judge Awards | nothing extra |
| Admin (any role) | + all practice sessions (flagged-session count), and — inside the admin strip only — a narrow `auditLog` query (`action == "export-backup"`) plus one fetch of the public config route |

Practice sessions use the single all-kinds subscription (`useAllTeamPracticeSessions`)
for everything — the paused session, pending live robots, recent practice, the
practice-activity count, flagged-session count — instead of the three separate
solo/live/paused queries those would otherwise need. `useAllLibraryMatches` gained
an `enabled` argument so roles that don't show practice matches don't subscribe to
the library. Switching roles starts from the new role's source set.

### Event, role, and time

**P13-2. Event context.** `useActiveEvents()`; with several active events the
header strip shows an event select defaulting to an In Progress one, else the
primary (same rule as the Scout Form, FIX1-2f). The pick isn't remembered. With
**no** active event the page shows a friendly empty state (admins get a "Go to
Active Events" button) *instead of* the strip and widgets — several widgets
would otherwise each show their own empty message. A `eventsLoaded` flag stops
"no active event" flashing while the team doc loads.

**P13-3. Roles.** Primary role by default; a segmented control appears only when
the user has secondary roles; the last choice is remembered **per user in this
browser's localStorage** (same trade-off as P12-5: it doesn't follow someone to
another device). A remembered role the user no longer holds is ignored. Admins
also get "View as role" (any of the nine roles), a preview that is **never saved**
and shows a banner with "Back to mine". The admin strip (last backup date,
flagged practice sessions, team creation on/off) is mounted for admins only —
also while previewing another role.

**P13-4. Times are schedules, in the event's timezone.** The FIRST API's match
`startTime` is event-local wall time with no offset; `new Date()` would read it in
the *viewer's* timezone and the countdown would be wrong for anyone off-site.
`parseEventTime` (`lib/dashboard/time.ts`) reads it in the event's own timezone
(DST-tested) and honors an offset if the API ever sends one. Every time is
labelled "Scheduled"; a past-due unplayed match counts down to "Now" and stays
"next" until it's played. `OfficialMatch` gained an optional `startTime`. **The
exact API time format is unverified** (no credentials here); a string that
doesn't parse simply shows "Scheduled time not published yet".

**P13-5. Header strip.** Rank and record come from the official qualification
rankings; the record falls back to our played qualification matches when
rankings don't exist yet. "Next match" = the first unplayed match we're in, in
play order (Practice, Qualification, Finals), with its alliance color and partner.

### Widget definitions I had to interpret

**P13-6.** Each is built only from data the app already has:
- **Match Scout** — "Scout now" opens `/scout?event=CODE&load=next` (the Scout
  Form page now reads those params, pre-picks the event, loads the next
  assignment, and uses the same shared `nextAssignment()` rule; it was wrapped in
  `Suspense` for `useSearchParams`). My accuracy/status/rank are `computeScoutStats`
  per category with My Scouting's own defaults (all events, plain calculation,
  preserved ranks), so the numbers match that page. Recent practice = my last 3
  Trial/Competitive sessions.
- **Pit Scout** — coverage = teams with ≥1 non-excluded real-event entry out of the
  event's teams (FIRST team list ∪ any team we've scouted, so it still means
  something if the team list failed to load); the zero-entry list; a team lookup
  to Team Profile; the latest comments.
- **Pit Team** — "what scouts saw" counts the schema's **reliability** fields
  (Died During Match, Never Started Match, Disabled by FTC, Recovered from Freeze,
  Tipped Over — one more than the prompt's four) from *our own* entries, plus the
  latest comments about us; phases vs the event use the mean over every scouted
  entry at the event.
- **Drive Team** — partner + opponents from `TeamStats`; the last-match recap reuses
  Match Breakdown's alliance maths (official score, scouted total, accuracy), so it
  agrees with that page.
- **Lead Scout** — coverage = played Qualification/Finals matches where every robot
  has a real-event entry, with the missing robots listed; "flagged entries" = an
  automatic flag nobody has dismissed (manual flags are already someone's review);
  "needing intervention" = Mentor **or** Student Intervention; "unassigned" =
  attending members with no slot in the published schedule.
- **Lead Strategist** — the prompt says "our rank and trend", but no rank *history*
  exists, so the trend is our **scouted scoring trend** (P10 `TeamStats.trend`). Pick
  list snapshot uses the P12 Pick % formula; top 5 = `rankTeams` (teams under 2
  entries aren't ranked); data confidence = mean alliance accuracy + entry/team
  counts. **Hidden gems**: scouted rank better than official rank by at least
  `max(5, 20% of the field)`, at least 2 entries (`HIDDEN_GEM_*` constants).
- **Team Coach** — event overview, upcoming schedule, scouting health (coverage +
  average accuracy), Mentor Intervention scouts by name, attendance count.
- **Media** — schedule/times, upcoming opponents with names, results as
  `Q12: Red 85 - Blue 70 (W)` with Copy buttons (Clipboard API, with a
  textarea fallback), event highlights (highest official alliance score among
  played Qualification/Finals matches — penalty points included, as FIRST reports —
  and our best match).
- **Judge Awards** — team summary and auto-generated strength bullets (ranked in the
  top 3 officially, winning record, top-3 / top-25% scouted average, rates ≥ 80%,
  reliability ≥ 90%, consistency ≥ 80%, scoring trending up). **Each bullet exists only
  while it's true**; stat-based ones need ≥ 3 of our scouted entries.

**P13-7. "Coming soon".** Exactly one for Pit Scout ("Pit scouting forms"), Judge
Awards ("Judging notes"), and Media ("Media tools"); none for any other role. A
dashed, control-free card — a placeholder, not a feature.

### States, layout, security

**P13-8. States.** Every widget goes through `Widget` (`components/dashboard/
widget.tsx`): `loading` (skeleton of the same size), `empty`, `error`, `ready`, with
reserved min-heights per size so nothing shifts. "Error" means the FIRST API
failed with nothing cached (the use-event-data hooks now expose `error`) **or** the
widget threw while rendering — `WidgetBoundary` catches that and offers Retry, so
one bad card never takes the dashboard down. Limitation: the existing Firestore
hooks swallow subscription errors into "empty" and don't expose them, so a Firestore
failure reads as an empty state, not an error.

**P13-9. Grid.** One column on phones, two on tablets, four on wide screens;
`small` = 1 cell, `medium` = 2, `wide` = the row, with `grid-auto-flow: dense` so a
small card fills a gap. The widgets' tap-through is a footer link (cards hold lists
and inputs, so the whole card can't be one link).

**P13-10. Security.** Everything is already readable by team members under the
existing rules (`scoutEntries`, `users`, `practiceSessions`, `eventAttendance`,
`assignments`, `pickLists`, `libraryMatches`); **no rules or collections changed**.
`auditLog` is admin-read-only, and its only reader here is the admin strip, which
isn't mounted for anyone else.

### Side changes

`ReliabilityPill` moved out of the Team Breakdown page into
`components/analytics/reliability-pill.tsx` (Drive Team's preview needs it);
`vitest.config.ts` stubs `server-only` (as the rules config already did) so
component tests can import code that reaches the FIRST API actions; the P11
converter test now expects `startTime`.

### P13: verification

Run and passing: `tsc`, `eslint` (0 errors; the same 2 virtualizer warnings),
`vitest` — new: `lib/dashboard` (`time`, `schedule`, `insights`, `roles`: 66
tests), the registry's structure (5), and a **smoke harness** that renders every
widget of every role (9 roles) against rich, loading, and empty data and checks
skeletons, key numbers, the Coming-soon cards, and the header strip (48) — 521 tests
in all — and `next build`. No Firestore rules changed, so no emulator run. **Not
verified:** anything visual — the harness proves no widget throws and the
content/states are right, but not layout, spacing, shift, animation, or the real
FIRST API's time format and payloads; and no browser session of the role switcher,
event switcher, or admin strip.

## P14 — Changelog & Credits

**P14-0. No clarifying questions were asked** — nothing blocked. As in P1-1 the
prompt's Vite/React Router wording maps to Next.js: the pages are still
`/changelog` and `/credits`, and both placeholder banners are gone (the app
shell's `REALIZED_PAGES` now lists them; the marketing layout's stale
`PLACEHOLDER_PAGES` check is removed).

### Changelog

**P14-1. A separate `publishedAt` field.** The prompt's data model lists
`createdAt` / `updatedAt`. The unread dot needs "when did this go live", which is
neither: an old entry that gets published today, or a typo fix on a published one,
would otherwise look "new" (or not) for the wrong reason. `publishedAt` is set when
an entry goes from draft to published, kept through edits, and cleared on
unpublish. Unpublishing and republishing counts as new and lights the dot again.

**P14-2. Unread semantics.** "Unread" = some published entry has
`publishedAt > users/{uid}.lastSeenChangelogAt`. A user who has never opened the
page has no `lastSeenChangelogAt`, so everything published counts as unread and
they see the dot once, until they open it. An entry whose server timestamp is still
pending (an admin's own just-published write) is ignored, so admins don't get a
dot for their own publish. The page stamps `lastSeenChangelogAt` on open and again
if something is published while it's open. It's per user (their doc), so it follows
them across browsers and devices.

**P14-3. Non-admin queries filter on `status == "published"`.** Firestore rules
aren't filters, so an unfiltered list from a member would be *rejected*, not
silently trimmed. `useChangelog` and the unread hook add the filter for everyone
who isn't an admin (equality-only, so no composite index is needed). Tested: the
unfiltered list is denied for a member.

**P14-4. Draft/published is visible to admins only.** Drafts are dashed, labeled
"Draft · only admins can see this", and counted in a line under the filters. An
admin can Publish / Unpublish from the card without opening the editor.

**P14-5. Starter entries are created as drafts, once.** The prompt asks for
starter entries "describing features that really exist, created as drafts". The
five in `lib/changelog/seed.ts` describe what's actually built (checked against
`docs/ARCHITECTURE.md`); the dates are the real dates the work landed in git
history, and the version numbers (v0.1.0 to v0.5.0) are only a suggested labeling
an admin can change. They are created the first time an admin opens the Changelog,
in one transaction that also sets `teams.changelogSeeded`, so (a) two admins
opening it at once seed once (deterministic doc ids too) and (b) they don't return
after being deleted. A team that already has its own entries is not an issue —
seeding only ever adds drafts. If you'd rather not have them at all, delete them,
or set `changelogSeeded: true` on the team doc before the first admin visit.

**P14-6. Safe markup, not HTML.** The prompt allows "bold/italic/links rendered
via a sanitizer, never raw HTML". I went one step stricter: text is parsed into a
four-node whitelist tree and rendered as React elements, so there is no HTML
string and no sanitizer to get wrong. Supported: `**bold**`, `*italic*` /
`_italic_`, `[label](https://…)`, and backslash escapes. A link must be a
canonical `https://` URL with a host, no credentials, no whitespace, ≤ 2048
chars. Anything else (including `javascript:` / `data:` / `http:`) stays visible
text, and the editor refuses to save one so it can't be silently inert. Not
supported on purpose: headings, lists, images, code, and nested links.

**P14-7. Limits.** version ≤ 40, title ≤ 120, summary ≤ 1000, each change ≤ 400,
at most 40 changes per entry — enforced in the editor and (as far as rules can
express it) in `firestore.rules`.

**P14-8. Collapse behavior.** The newest two entries in the displayed list start
expanded and older ones collapsed. While a filter or search is active every match
is expanded so the hit is visible. Expand all / Collapse all and each card's own
toggle override that for the session; the choice is not remembered across visits.
Pinned entries count as "newest" for this since they're first in the list.

**P14-9. Type filter semantics.** Selecting types keeps entries that have at least
one change of those types and, inside each, shows *only* those changes. Chip counts
are "entries with at least one change of this type". Multiple types are OR.

**P14-10. Editor is a dialog, not a drawer.** The prompt allows either; it reuses
the app's glass `Dialog` (focus trap, Esc, exit animation). Change rows use a
native `<select>` for the type (an accessible, simple control that behaves inside
a dialog) rather than the Radix select.

**P14-11. Edit conflicts are last-writer-wins.** Saving an entry replaces its
content from the editor. Quick toggles (pin, publish) go through `patchEntry`, which
re-reads the latest stored entry in a transaction, so a toggle never reverts text
someone else just changed. Two admins editing the *same entry's text* at the same
time is not merged — the last save wins. (The audit log records both.)

**P14-12. Audit.** One `auditLog` entry per create, edit (including pin and
publish toggles), and delete, written in the same transaction as the change. The
seeding transaction writes one entry too. These use new `AuditAction` values; the
auditLog rule doesn't restrict `action`, so no rules change was needed for them.

### Credits

**P14-13. Defaults are shown, not stored, until the first edit.** `credits/{teamId}`
doesn't exist for a team that has never edited it; the page then shows
`DEFAULT_CREDITS` (Built with AI, Team, Built with, Data) and tells admins it's the
starter list. The first edit materializes the defaults plus that edit into the doc.
Their ids are fixed so an edit replays correctly. (No seeding write on page open, so
a non-admin visiting first can't be affected and nothing needs an admin present.)

**P14-14. "Built with" lists Next.js, not Vite.** The prompt lists React, Vite,
Tailwind CSS, Framer Motion, Firebase, and Vercel. This app is **Next.js**, not
Vite (see P1-1), so the seed names Next.js instead. An admin can edit it. Each
seeded link points at the project's home page; the Data entry links to the FTC
Events API documentation. I didn't verify those URLs resolve (no network access in
the build environment) — please click through them once.

**P14-15. Team section is placeholders.** Three "Team member name" entries with a
role placeholder, as the prompt asked. The AI collaborator entry reads "Claude
(Anthropic)" and links to anthropic.com/claude.

**P14-16. Avatar/logo is an https image URL, not an upload.** There's no file
storage in this app, so an entry's image is a link (https-only, validated). If the
image fails to load, the entry falls back to initials. Images are loaded with
`referrerPolicy="no-referrer"`. Because the host is arbitrary, it's a plain `<img>`
rather than `next/image` (which would need every host allow-listed).

**P14-17. One whole-doc credits record, edited by ops in a transaction.** A single
`credits/{teamId}` doc, as specified. Every edit is a `CreditsOp` re-applied to the
latest stored sections inside a transaction (the pick-list pattern), so two admins
editing at once compose. Limits: 20 sections, 60 entries per section, names ≤ 80,
descriptions ≤ 300, section titles ≤ 80 — about 700 KB worst case, under
Firestore's 1 MB document limit.

**P14-18. Drag and drop is within a list; use the editor to change sections.**
Sections drag among sections, and entries drag within their own section — each with
a grip handle (mouse, touch long-press, keyboard) and up / down buttons. Dragging an
entry *between* sections isn't offered (the op exists in `applyCreditsOp`, but the UI
doesn't expose it); to move one, add it to the other section and delete the original.

**P14-19. A link wraps the entry's name, not the whole tile.** A description can
contain its own links (the safe markup), and a link nested inside a link is invalid
HTML, so only the name (with an external-link icon) is the entry's link.

**P14-20. Footer.** `components/layout/site-footer.tsx` — a copyright line and
Credits / Changelog links — is on the app shell (signed-in pages) and replaces the
marketing layout's hand-written footer. The Credits and Changelog pages themselves
live behind sign-in (they were already in the signed-in shell), so those two links
send a signed-out visitor to the login page.

### Side changes

- Removed the now-unused mock `changelog` data from `lib/mock-data.ts`.
- Added `lastSeenChangelogAt?` to `UserDoc` and `changelogSeeded?` to `TeamDoc`.
- Four new `AuditAction`s with labels in the Admin Panel's audit log tab.

### P14: verification

Run and passing: `tsc`, `eslint` on everything touched, `vitest` — new:
`lib/rich-text` (17: URL acceptance/rejection incl. scheme and whitespace tricks,
parsing, nesting, "never produces HTML", pathological input),
`lib/changelog` (32: ordering, filtering/search, grouping, unread rule, validation,
defensive read, dates, starter entries are valid), `lib/credits` (24: every op,
stale ops, two-admin composition, sanitize-on-read, validation, defaults) — 594
tests in all — and `next build`. **Emulator rules tests: 148 passing in
`firestore.rules.test.ts`** (114 before; 34 new: member/admin/other-team/anonymous
reads incl. the rejected unfiltered list, drafts hidden, admin create/edit/pin/
publish/unpublish/delete, `publishedAt` fixed while published, immutable fields,
shape and limit validation, the save and seed transactions with their audit
entries, `lastSeenChangelogAt` self-update without a role smuggle, and credits
read/write/limits/transaction).

**Not verified:** anything visual or interactive. I had no browser, so the
timeline, collapse animation, no-shift loading, the glass dialogs, the unread dot's
placement in the collapsed and expanded sidebar, dnd-kit dragging, and the footer
have not been seen. The unread dot is also untested end to end (it needs a second
account in a live Firebase project).

**Known failing, not caused by P14:** `api-routes.emulator.test.ts` (11 of its 12
tests) fails identically on the P13 commit with my changes stashed
(`auth/email-already-in-use` / "no user record" from the Auth emulator). It's an
existing problem with that file's setup in this environment; I left it alone.
`npm run test:rules` therefore reports 12 failures overall until it's fixed;
`firestore.rules.test.ts` on its own is fully green.

## FIX2 — Owner Can Edit Roles (Including Their Own and Other Admins')

**FIX2-0. No clarifying questions were asked** — nothing truly blocked. As in P1-1
the prompt's Vite wording maps to Next.js. **FIX2 supersedes P1b-3 and the owner
parts of FIX1-3** ("owner rows are locked for everyone, the owner too"): that
reading of the P1b prompt is what locked the sole owner out.

### Root cause

I reproduced it as a sole owner with the emulators (the new tests in
`firestore.rules.test.ts`, group "the sole owner"): before the fix, a sole owner's
own primary-role, secondary-role, and admin writes were all denied. The causes,
checked in the order the prompt gave:

1. **UI gating — wrong (a real cause).** `getMemberEditState()`
   (`lib/member-access.ts`) returned `canEdit: false` for *any* row with
   `isOwner`, whoever the viewer was, so the owner's own row showed a "Locked" marker
   and no Edit button. That is the "can't edit an owner" rule applied to the owner
   too. (It also meant a non-admin viewer got no Edit button at all, with no reason.)
2. **Security rules — wrong (a real cause).** The `users/{uid}` admin-update rule
   required `resource.data.isOwner != true` and the self-update rule pins `primaryRole`,
   `secondaryRoles`, and `isAdmin`, so *nothing* allowed an owner to change their own
   roles; the two rules together locked the owner out even if the UI had offered the
   button.
3. **Stale or missing custom claims — not the cause of this lockout, but a gap.**
   `firestore.rules` never read the `owner` claim, only the caller's own `users` doc
   (via `get()`), so a stale or missing token couldn't have caused it — but the
   prompt wants the rules to accept either source, and the rules had no owner notion
   at all. Added `isOwner()` = the `owner` claim **or** the caller's own doc
   `isOwner == true`; the claim is checked as `'owner' in request.auth.token && …`
   so a token with no claims at all doesn't error. See FIX2-3 for the one trade-off.
4. **Last-admin safeguard — not broken.** It never blocked a role edit: the rules'
   only clause is "an admin can't remove their *own* admin flag", and the UI's
   `last-admin` / `self` blocks only ever disable the **admin switch**. Confirmed with
   tests (a sole non-owner admin edits their own roles freely; only dropping their own
   admin flag fails). Left as is.
5. **Unverified email — a real gap.** `app/api/auth/sync-roles` returns early,
   silently, for an unverified email, so an owner who hasn't verified is simply "just an
   admin" with no explanation. It now reports `ownerPendingVerification` (see FIX2-4).

**A separate, pre-existing test bug found on the way:** `api-routes.emulator.test.ts`
(11 of 12 tests) had been failing since P1b — the test hardcoded the project id
`compepicurus-api-test`, but `firebase emulators:exec` runs the Auth emulator under the
`.firebaserc` project (`compepicurus`) and mints ID tokens with *that* audience, so the
Admin SDK rejected every token (`incorrect "aud"`). The test now uses
`process.env.GCLOUD_PROJECT`. One test that expected owner claims for a verified owner
with no profile and no team was changed to the real sole-owner path (the owner creates
the team, then syncs); the route's "do nothing for a profile-less owner" behavior is
unchanged. This is why `npm run test:rules` was reporting 11 failures before.

### The matrix (one helper, mirrored in rules)

`canEditMember(actor, target)` in `lib/member-access.ts` (the TypeScript twin of
the `users/{uid}` update rule, using `canManageMembers()` / `isOwner()`):

| Actor | Edits roles of | Changes the admin flag of |
|---|---|---|
| Owner | their own row, and every non-owner member (other admins included) | any non-owner member; never their own (owner access stays) |
| Admin (not owner) | any non-owner member, themselves included | any non-owner member; never their own |
| Everyone else | nobody | nobody |

Always: nobody writes `isOwner` from a client; nobody removes an owner's admin status
or moves a member off the team (`teamId` is immutable); the last-admin safeguard only
stops an admin dropping *their own* admin flag.

**FIX2-1. A second owner is treated like any owner row.** `OWNER_EMAILS` can list
several emails. The prompt says "other admins cannot edit an owner's roles … only the
owner can edit their own", so owner A cannot edit owner B either — only B can. The
tooltip says "Only this owner can edit their own roles."

**FIX2-2. An owner's own Admin switch is shown locked on**, with a lock icon and the
tooltip "Owner access can't be removed." The editor opens an owner's draft with
`isAdmin: true` regardless of the stored value, and the rule requires `isAdmin == true`
on an owner's row — so a doc whose admin flag had drifted off can be repaired by
saving any edit, and can never be turned off.

**FIX2-3. The claim fallback is deliberately permissive.** A user whose token says
`owner: true` is treated as an owner for *managing other members* even if their doc
flag hasn't caught up (the prompt asked for "either"). The cost: if the owner flag is
revoked (the email leaves `OWNER_EMAILS`), a stale token keeps owner powers until it
refreshes (≤ 1 hour). Mitigations: it only applies within the caller's own team
(`sameTeam`), `sync-roles` force-refreshes the token on any change, and the claim can
never be used to edit another owner's row or write `isOwner` (tested). A claim from
another team's owner grants nothing (tested).

**FIX2-4. Unverified owner email.** `sync-roles` now computes whether the caller's
email matches `OWNER_EMAILS` *before* the verification check and returns
`ownerPendingVerification: true` when it matches but the email is unverified; nothing
else changes (still nothing granted). `lib/auth.tsx` exposes it as
`ownerPendingVerification` plus `recheckOwnerAccess()` (reload the account, force a
token refresh, re-run the sync — no sign-out needed). The existing verify-email
banner shows "Verify your email to activate owner access." with **Resend email** and
**I've verified — refresh**; it now also appears for a non-password account in that
state. Disclosure trade-off: the hint tells *the person who typed that email* that it's
an owner address; the address is already visible to every team member in Team
Management, and the unverified account gains nothing.

**FIX2-5. Disabled controls everywhere, for everyone.** Team Management now shows
every row an Edit button; a row the viewer can't edit gets it **disabled with a
tooltip** (`HoverTip`) saying why: "Only admins can edit roles." for a non-admin
viewer (every row, their own too), "Only the owner can edit this member." for an admin
looking at an owner. Previously non-admins saw no Edit button and owners showed
"Locked". (Slightly more visual noise for plain members; it is what the prompt asks:
"never silently missing controls".) The save handler re-checks `canEditMember` against
the live roster. The Owner badge was already next to the owner's name; it's now
`shrink-0` so a long name can't push it out of view.

**FIX2-6. Audit.** Unchanged and already atomic: `updateMemberAccess` writes the
`edit-member-roles` entry (who, whom, before, after) in the same batch as the change —
now also for an owner editing their own row (tested, with the "rejected batch leaves no
orphan audit entry" case for an admin targeting the owner).

**FIX2-7. `npm run test:rules` now runs the two test files one after the other**
(`fileParallelism: false` in `vitest.rules.config.ts`). With the API tests no longer
failing fast, both files hammered the same emulators concurrently — the API tests wipe
data between cases and the P12 pick-list tests fire many simultaneous transactions —
and the latter timed out once. Sequential runs were stable on repeat.

### FIX2: verification

Run and passing: `tsc`, `eslint`, `vitest` (21 tests for `lib/member-access`, 10 more
than before: the matrix, the sole-owner case, last-admin affecting only the switch),
`next build`, and the emulator suite **`npm run test:rules`: 187 tests in both files**
— 173 in `firestore.rules.test.ts` (25 new/changed for FIX2: sole owner edits own
primary/secondary roles and can't drop admin/owner; owner edits and (de)promotes other
admins; non-owner admin can't touch an owner but can edit others and themself; a
non-admin edits nobody; no client writes `isOwner`; no claims / stale claims / claim-only
all work; another team's claim is useless; last-admin; atomic role + audit batch) and
14 in `api-routes.emulator.test.ts` (all passing again; 2 new for the verified/unverified
owner hint). The two older tests that asserted the owner lockout were rewritten.

**Not verified:** anything visual — the disabled Edit buttons and their tooltips, the
locked admin switch with its lock icon, the banner. The verification-email round trip
needs a real Firebase project (`recheckOwnerAccess` is covered only by its pieces: the
route test shows a refreshed token flips the result).

## P15 — Manual Library Matches (Events Whose Scores Aren't in the API)

**P15-0. No clarifying questions were asked** — nothing blocked. As in P1-1 the prompt's
Vite/React Router/`/api` wording maps to Next.js (client Firestore calls + the existing
Server Actions); I also noted the project builds on P3's library, not a new one.

**P15-1. One collection, with `origin`.** Manual matches live in `libraryMatches` next to
API ones (as the prompt specifies), distinguished by `origin`. That is what makes them work
"everywhere an imported match does" — every reader already queries that collection. Pre-P15
docs have no `origin`; the code reads that as `'api'` (`originOf`), the rules read it with
a default, and a one-time backfill (P15-3) writes it.

**P15-2. API and manual data can never overwrite each other — enforced three ways.**
(1) The shared pure rule `decideMatchWrite()` runs first in both paths: the API import skips
a manual match and reports it ("Left N manual matches untouched"); manual entry skips an API
match and reports it. (2) `firestore.rules` fixes `origin` on an existing doc, so even a buggy
or hostile client write fails. (3) A manual event's code is also protected: an API import
refuses a code that belongs to a manual event, and an API-origin match can't be created under
one. Tested at all three levels.

**P15-3. Members read only `published == true` — and that needed a backfill.** The prompt asks
for rules that hide unpublished matches from non-admins. Two things followed, found while testing
against the emulator:
- Rules aren't filters: a member's *query* must itself include `where("published", "==", true)`.
  `useLibraryMatches`, `useLibraryMatchesBySeason`, and `useAllLibraryMatches` all do now, so
  every scout-facing list is published-only (admins included — "Unpublished matches never
  appear in scouts' match lists"). The Admin Panel tables and the Rescore tab pass
  `includeUnpublished`.
- **A first draft of the rule read `resource.data.get('published', true)` so that old docs
  (no field) counted as published. The emulator showed that lets a member's *unfiltered*
  query through (the default makes it provable), which would expose unpublished matches.**
  The rule reads the field strictly. The cost: a pre-P15 doc has no `published` field and
  would disappear from scouts' lists. So `backfillLibraryMetadata` stamps every such doc
  `origin: 'api'`, `published: true` (and creates the missing `libraryEvents` docs). It runs
  automatically the first time an **admin** has the app open after this ships
  (`components/admin/library-backfill.tsx`, flagged once per team as
  `teams/{teamId}.libraryBackfilled`). **Until that has happened, scouts see an empty practice
  match list** — see "Commands" below.

**P15-4. Events: `libraryEvents`, for API events too.** The prompt describes the collection for
manual events. I also write a doc for each API event (`origin: 'api'`) on import (and via the
backfill) so one list holds every event code and a manual code can be checked against all of
them. An admin-typed code is additionally checked against matches that already exist under it
and against the FIRST API itself (a positive hit blocks it; if the API call fails the check is
skipped — the rules and the existing-code checks still apply). A generated code is `MAN-` + up
to 10 characters of the name, with `-2`, `-3`… on a clash; it can't equal a real FTC code (they
have no hyphen and aren't prefixed `MAN-`). Codes can't contain underscores (they'd make
`${eventCode}_${type}${number}` ambiguous). I added `defaultVideoUrl` to the event doc for the
"Default video for this event" field.

**P15-5. Bulk imports: Needs review is a separate flag.** The prompt says CSV/paste matches start
`published: false` with a "Needs review" badge. I stored the badge as its own `needsReview`
boolean rather than inferring it from `published: false`, so a match an admin deliberately
**un**publishes later reads "Unpublished", not "Needs review". Publishing (single, selected, or
Publish all) clears it. Re-importing a corrected file **updates** an existing manual match and
keeps whatever published/review state it already had (it does not send a published match back
to review). A match that appears twice in one file: the later row wins and the earlier one is
flagged in the preview.

**P15-6. Penalty points and "same team in two alliances".** The prompt makes "all four teams
distinct" a validation rule and also lists "a team repeated in two alliances of the same match"
as a *non-blocking* warning. Those can't both hold; I made it the **blocking error** (the
stricter, validation-rule reading) — the form says which team is repeated — and the
non-blocking warnings are: scores far from the event's other manual matches (Tukey fences with
a 40-point floor, needing ≥ 4 other scores), the same match number already existing (saving
replaces it), and a clip longer than 10 minutes. Penalty points must be whole numbers ≥ 0 and
no larger than **that alliance's own** score (they're already included in it); a blank cell is 0.

**P15-7. Video.** Links of every YouTube form are accepted and stored in one canonical form, so a
CSV pasted with `?si=…&t=90` and a bare video id both work; a `t=` value pre-fills the start
time when the start box is empty. Times accept `90`, `1:30`, `1:02:30` (and the YouTube
`1m30s` forms). A match with a link needs start and end (start < end); a match with **no** link
is allowed (the table flags "missing video", practice flows already treat that as unavailable
unless placeholder video is on). The built-in preview is the P3 `VideoPlayer`; **Set start
here / Set end here** read the player's current time. The preview plays freely (not limited to
the start/end window) because its job is finding the window, and it never reloads when a time is set.
Bulk **Set video link** keeps each match's own times; a match with no times yet gets a
placeholder 0:00–2:30 (an FTC match's length) and the confirmation says how many did.

**P15-8. Renumbering.** Match type and number are locked while editing (the id is built from
them). To renumber, duplicate the match (the number pre-fills as the next free one) and delete
the original.

**P15-9. Editing scores later.** The edit dialog counts the team's **completed** practice
sessions already scored against that match and, if any, shows the count with a button to the
Rescore tab. The scores themselves are saved immediately; the existing sessions keep their old
accuracy until an admin runs Rescore (P9), which already reads the library's current numbers
(it now also reads unpublished matches). Live and lobby sessions on a manual match are covered
the same way, as the count is by `libraryMatchId`.

**P15-10. Team names.** Practice match lists in this app only ever show team *numbers*
(`MatchRow.teams`), so for manual events "numbers only" is already what happens — no FIRST API
name lookup was added.

**P15-11. Audit.** One new action, `edit-match-library`, one entry per admin operation (create /
edit / delete event, upsert, publish, unpublish, set video, delete matches), written in the same
batch as the change. Bulk operations log a summary (count, and up to 50 match ids), not one
entry per match. Not in the prompt; consistent with every other admin write.

**P15-12. Backups include `libraryEvents`**, and `libraryMatches` was already exported in full
(unpublished manual matches included, since the exporter is an admin). Manual matches exist
nowhere else, so they matter for the competition-day safety net.

**P15-13. Rules limits.** A bulk import is written in batches of 400 matches. Each manual-match
write makes the rules look up its event doc and the caller's user doc; the rules allow 20
*distinct* documents per batch and those are the same two docs for every write, and a
40-match batch passes the emulator tests. I haven't run a 400-match batch against the emulator.

### Side changes

- `libraryMatchId` moved to `lib/library/ids.ts` (pure); `lib/match-library.ts` re-exports it.
- `parseCsv` takes an optional delimiter (tab for spreadsheet paste); default unchanged.
- `MatchRow.manual` (optional) and a Manual badge in Practice Match Select and the Results screen.
- `TeamDoc.libraryBackfilled`; one new `AuditAction`; the existing P3 rules test now writes
  `origin`/`published`, as every P15-era doc does.

### P15: verification

Run and passing: `tsc`, `eslint` (0 errors, the same 2 warnings), `vitest` — new
`lib/library/library.test.ts` (55: every YouTube link form incl. `si` and `t`, time parsing and
start/end validation, match-id format, event-code generation and collisions, the origin rule,
`validateRawMatch` field by field, difficulty from typed scores and recomputed on edit, sanity
warnings, CSV/paste validation incl. bad team numbers / duplicate teams / penalty > score /
missing columns / event defaults / eventCode column / idempotent re-import / API ids refused /
duplicate rows, the doc builder), 659 tests in all — `next build`, and the emulator suite
**`npm run test:rules`: 219 tests, all passing** (205 in `firestore.rules.test.ts`, 14 in the API
tests). New rules tests (32): published vs unpublished reads (single, filtered list, rejected
unfiltered list), manual match create/edit shape and id, penalty/score/difficulty checks, only
under a manual event, origin immutable both ways, API refresh can't touch a manual match and a
manual write can't touch an API or pre-P15 one, delete rules, `libraryEvents` rules, and an
end-to-end flow built from the real code (bulk import 40 rows → members see none → Publish all →
members see all; set video link; rename; delete; the API-import doc shapes).

**Not verified:** anything visual or interactive — no browser here — so the dialogs, fast-entry
row, preview player with the Set start/end buttons, spreadsheet paste from a real Google
Sheet/Excel, the bulk table, and the Manual tags haven't been seen. The store's Firestore calls
(`lib/library/store.ts`) run only in the browser against a real project; their *documents* are
covered by the rules tests, but the functions themselves (and the live FIRST-API collision check)
are not run by any test. Nothing was run against the real Firestore project.

## FIX3 — Bugfix Pass 2 (Practice Permission Error, Credits, Optional Video Times, Glass Slider)

**FIX3-0. No clarifying questions were asked** — nothing blocked. As in P1-1 the prompt's Vite
wording maps to Next.js.

### 1. Practice Scouting: "Missing or insufficient permissions"

**Root causes — found by running the app's real queries against the rules in the emulator, as
three users (owner, non-admin Match Scout, plain member).** Before any fix, 13 of the new
regression cases failed (12 genuine; one was a mistake in my own test fixture), for **every** kind of user (so it was never a role/claims problem):

1. **Picking a match reserves a Session ID in a transaction that first *reads* an id that
   doesn't exist yet** (`lib/practice-sessions.ts` → `claimUniqueDocId`; extracted to
   `lib/claim-doc.ts` `tryClaimDoc`). The `practiceSessions` read rule was
   `sameTeam(resource.data.teamId)` — on a document that doesn't exist, `resource` is null, so
   that is an evaluation error, i.e. denied. **This is the raw error on the team select page** (it
   is thrown straight out of `claimSessionId` and shown as `err.message`). The lobby code is
   reserved the same way (`claimLobbyId`) and failed identically. Fix: split `read` into
   `get: resource == null || sameTeam(...)` and `list: sameTeam(...)` on `practiceSessions` and
   `lobbies`. A missing-doc read now reveals only that an id is free; an *existing* session or
   lobby of another team is still unreadable, and list queries still need the team filter.
2. **Collection-group queries had no rules.** The practice landing page's "which lobby am I
   in" (`collectionGroup("players") where uid == you`) and the live-presence lists
   (`collectionGroup("scouts") where teamId == …`) are only allowed by a rule with a recursive
   wildcard (`match /{path=**}/scouts/{uid}`); the nested rules didn't apply, so both were denied
   (silently — the hooks swallowed the error). Added `match /{path=**}/scouts/{uid}` (same team
   condition as the nested rule) and `match /{path=**}/players/{uid}` (own docs, or same team).
3. **Two subcollection reads were unfiltered.** `useLiveMatchScouts` read a whole
   `liveMatches/{key}/scouts` subcollection ("any team — the caller filters"), and `useLobbyPlayers`
   a whole `lobbies/{id}/players`; both rules are `sameTeam(resource.data.teamId)`, and rules
   aren't filters, so an unfiltered list is rejected outright. Both queries now carry
   `where("teamId", "==", teamId)` (the hooks take a `teamId` argument).

Checked and **not** the cause: the prompt's "old documents lack `published`" and "queries not
matching the rules" for the library — see FIX3-1; the session status badges (members already may
read team sessions); claims and user-doc fields (the rules read the user doc).

**FIX3-1. I did NOT make the library read rule treat a missing `published` as true** (the prompt's
suggested `resource.data.get('published', true)`). I tried exactly that in P15; the emulator
showed it lets a member's *unfiltered* query through (the default makes it provable), which
exposes unpublished matches. The rule stays strict (`resource.data.published == true || isAdmin()`)
and the data is migrated instead: P15's idempotent `backfillLibraryMetadata` stamps
`origin: 'api'` / `published: true` on older matches. It already ran automatically the first time
an admin opened the app; FIX3 adds the **admin-only "Update library" button** the prompt asks for
(Admin Panel > Match Library) and tells a scout with an empty list where to look. Library
matches have no `teamId` by design (P3-6), so no rule needed one.

**FIX3-2. One module for the practice queries — `lib/practice-queries.ts`.** Every query the
solo/live/lobby flows make (library by season / event / all, team sessions solo / live / all,
own paused session, repeat-attempt check, lobby sessions, live presence per match and team-wide,
lobby roster, "my lobby") is a builder there, used by the hooks *and* by the regression suite,
so the suite tests the real queries and can't drift from the app.

**FIX3-3. The regression suite** (`firestore.rules.test.ts`, "FIX3: practice queries and writes,
for every kind of user", run once per user type) covers: library by season/event/all (published
only, drafts never in a scout's list), `libraryEvents`, every session query, the Session ID and
lobby-code reservation transactions, other teams' sessions/lobbies/presence being unreadable,
live presence (per match, team-wide, own writes only), lobby join/roster/"my lobby", session
writes staying owner/admin, plus the roster and team doc. It also asserts that admins (only) can
read unpublished matches.

**FIX3-4. Indexes.** Every practice query is equality-only (no `orderBy`/range), so none needs a
composite index. **`firestore.indexes.json` had a bug:** the two collection-group indexes
(`scouts.teamId`, `players.uid`) were written as single-field entries in `indexes`, which
`firebase deploy --only firestore:indexes` rejects ("this index is not necessary"). They are now
`fieldOverrides` with a `COLLECTION_GROUP` ascending entry (the collection-group queries need
that). The two real composite indexes (`practiceSessions`) are unchanged.

**FIX3-5. If production still shows the error after deploying:** it is almost certainly the rules
(or indexes) not being deployed — every cause above is a rules/query mismatch that the repo's
rules now fix, so an older deployed `firestore.rules` reproduces the original symptom exactly.
Deploy both (see Commands). The raw error is also gone from the UI regardless (FIX3-6).

**FIX3-6. Friendly errors.** `lib/firestore-errors.ts` (`describeFirestoreError`,
`failureExplanation`, `failureDetails`, `reportFirestoreError`) and
`components/practice/load-error.tsx` (`LoadError`: title, one-sentence explanation, **Retry**,
**Copy details** = code, message, the failing collection path and query constraints, time).
Match Select shows "Couldn't load matches" / "Couldn't load practice sessions" with Retry
instead of an empty list; every start/save/submit failure in the practice flows (solo, live,
lobby) now uses it too (their `setError(err.message)` became `describeFirestoreError(...)`).
Every Firestore subscription failure in these hooks is logged with its collection path and
constraints (`[firestore] <what> — <code> — <path>: <message>`), in development and production.

### 2. Credits

**FIX3-7. Could not reproduce "admins see less outside edit mode" — there is no edit mode.**
P14's Credits page already shows admins the same content as members, with the Add / Edit /
Reorder / Delete controls inline (no toggle) and members none; the prompt's description (an
edit-mode toggle) doesn't match what was built. I added `components/credits/credits-board.test.tsx`
(server-renders the board as a member and as an admin: same sections, names, and descriptions;
inline controls only for the admin; no edit-mode wording anywhere). One real hazard found and fixed
while looking for the cause: **if the credits subscription failed, the page silently fell back to the
starter list**, which would look like "different content" to whoever hit the failure. It now
shows the same `LoadError` with Retry and Copy details instead. If you still see an admin-only
difference on the deployed site, it is most likely an old build — please tell me what you see.

### 3. Optional start and end times

**FIX3-8. One rule, in `lib/library/video-window.ts` (pure, tested).** Start and end are each
optional (null = blank):

| start | end | plays from | match ends |
|---|---|---|---|
| blank | blank | the beginning | when the video ends |
| given | blank | the start | when the video ends |
| blank | given | the beginning | at the end time |
| given | given | the start | at the end time |

`LibraryVideo.startSec/endSec` are now `number | null | undefined` (stored as `null` when blank;
older docs with numbers are unchanged). Everything that assumed both exist now goes through the
helpers: the YouTube player (`start` always, `end` only when set; the 500 ms end-time safety net
only when there is an end; otherwise YouTube's own ENDED event ends the match — the player handle
gained `getDuration()`), the practice session screen (clip progress), the lobby results deadline,
the "Finished Early" flag, the admin tables, and validation.

- **"Finished Early":** progress = (current − start) / clip length, where the length is end − start,
  or, with no end, the video's reported duration − start. **If the duration isn't known the flag is
  skipped** (`videoProgressAtFinish: null` — already how the flag treats unknown).
- **Lobby deadline** (start + clip length + grace): with no end time this client may not know the
  video's length, so a bound is used — **10 minutes** (`UNKNOWN_CLIP_FALLBACK_SEC`). It only ever
  matters if someone never submits; everyone submitting still resolves the round at once.
- **Competitive no-pause / "Match ended" cue:** unaffected by the times — `lockPause` and the ended
  callback are unchanged; with no end time the ended callback is YouTube's ENDED.
- **Forms/CSV/paste:** `validateRawMatch` only compares start < end when both are present (an end
  alone just has to be after 0:00); blank cells are never errors in the CSV/paste preview; unreadable
  text still is. A `t=` in a link still pre-fills a blank start. The Set start/end helpers are
  unchanged. Imported-match rows in Match Library save blank times as blank (they used to turn blank
  into 0), and the bulk video CSV (`matchKey,url,startSec,endSec`) accepts blanks and `1:30` forms
  (its parser moved to `lib/library/video-csv.ts` so it can be tested). Bulk "Set video link" keeps each
  match's own times and no longer invents a 0:00–2:30 window (P15's placeholder is gone).
- The long-clip warning only applies to a clip with an end time (one without can't be measured).
- Live (real-event) practice never used library video times, so it is unaffected.

### 4. The droplet button and the shared glass slider

**FIX3-9. What already existed.** The "layered glass slider" is the droplet popover
(`GlassShadeControl`) backed by a localStorage-only provider (`GlassShadeProvider`,
`--glass-shade`) — already shared in-tab and already placed in the sidebar footer, next to the
"Online" label. So this was an extraction and a persistence change more than a new control.

**FIX3-10. Shared state and component.** `lib/glass-layer.tsx` (`GlassLayerProvider`,
`useGlassLayerLevel()` → `{ level, setLevel, reset }`) and `lib/glass-layer-level.ts` (pure:
clamp/parse/resolve; tested); `components/theme/glass-layer-slider.tsx` has `<GlassLayerSlider />`
(the slider, labeled, a native range input so arrow keys/Home/End/PageUp/PageDown work) and
`<GlassLayerButton />` (the droplet + popover). The old `lib/glass-shade.tsx` and
`glass-shade-control.tsx` were removed; the home page header, the mobile top bar, and the sidebar all
use `GlassLayerButton`, driven by the one hook, so they move together. The CSS variable name
(`--glass-shade`) and the localStorage key are unchanged so nothing visual changes and an existing
choice carries over.
- **Persisted per user:** `users/{uid}.glassLayerLevel` (number 0.3-2), written ~0.5 s after the
  slider stops moving (and flushed if the provider unmounts), with the localStorage value as the local
  fallback (applies before sign-in and instantly on load). The signed-in user's saved level wins; a level
  only this browser had is saved to the account once. This needed no rules change (the self-update
  rule already allows it; tested). The provider now sits *inside* `AuthProvider` in `app/layout.tsx`.

**FIX3-11. Sidebar.** The "Online" label (`components/layout/connection-status.tsx`) is removed; the
footer has a single circular droplet button (themed glow on hover/open, the shared spring press,
`aria-haspopup="dialog"`, Escape/outside-click close, focus moves to the slider on open and back to
the button on Escape). Collapsed sidebar and the mobile drawer show it too (the drawer reuses the same
sidebar), and the mobile top bar has its own copy.

**FIX3-12. The offline safety signal is kept, silent when fine.** `lib/connection-notice.ts` (pure,
tested) + `lib/use-connection-state.ts` (the P1 online/pending logic, unchanged in meaning: pending
entries of the active events). Online with nothing waiting: **nothing is shown**. Offline, or unsynced
submissions: a small amber badge (cloud-off icon, or the pending count) pinned to the droplet button's
corner — absolutely positioned, so no layout shift — and tapping the button shows "Offline: N
submissions will sync when you're back online." (or "N submissions still syncing to the server."). The
hook runs once in the app shell and is passed to both the sidebar and top bar, so there is one
subscription. Offline used to be red; it is amber now, as the prompt asks.

### FIX3: verification

Run and passing: `tsc`, `eslint` (0 errors, the same 2 pre-existing warnings), `vitest` (719 tests:
new `lib/library/video-window` (15), video CSV + Finished Early (8), the optional-time cases in
`lib/library/library.test.ts`, `lib/firestore-errors` (8), `lib/glass-layer-level` + the offline notice
(10), the Credits render test (4)), `next build`, and the emulator suite **`npm run test:rules`: 266
tests, all passing** (the FIX3 practice-queries suite is 3 user types × 14 cases plus 1 admin case; the
glass-level rules tests are 4).

**Not verified:** anything visual or interactive — no browser here: the droplet popover and badge,
keyboard use of the slider, the LoadError card, playback with a blank end time against a real YouTube
embed (the embed's `getDuration()` and ENDED behavior are YouTube's, not testable without one), and
the actual production database. The rule fixes are proven against the emulator with the app's own query
builders; whether your deployed project was failing for exactly these reasons depends on what rules
it is running (FIX3-5).

## P16 — Analytics: Scout Status

**P16-0. No clarifying questions were asked** — nothing blocked. As in P1-1 the prompt's Vite/React
Router wording maps to Next.js; the page is still `/analytics/scout-status` inside the Analytics
layout, so it uses the shared filter bar and `useAnalyticsEntries`. The placeholder (mock data, banner) is gone.

**P16-1. Every number follows the shared filters.** The page counts from `useAnalyticsEntries()` — the
entries after Game, Event, Practice, Accuracy and exclusions — and never recomputes accuracy
(`allianceAccuracy` comes from the shared engine). With an Accuracy threshold, only entries whose
alliance accuracy is computable and at or above it count toward matches scouted, entries, last entry,
the per-category chips **and the coverage ticks** (tested end to end with the real
`selectAnalyticsEntries`). With several events (or All Events) the table and coverage sum across them;
the dataset is whatever the Practice toggle chose (event schedule from the FIRST API, or the library's
matches), never mixed.

**P16-2. Finals classification — a guess I could not verify against the live API.** `classifyMatch`
(`lib/scout-status/categories.ts`, tested for 2- and 3-match finals series) says: Practice and
Qualification are themselves; a playoff match is **Finals** when it is in the final series, otherwise
**Semi-Finals**. The final series is found from the FIRST API's playoff `series` numbers — the matches
sharing the **highest** series. I added `series` to `OfficialMatch` for this (it already existed on
`FtcMatch`). Two uncertainties: (a) I don't know whether the API gives a best-of finals one series
number or one per match (e.g. M14 and a reset M15 as separate series) — if separate, only the last
match would be called Finals; (b) a manual/library event has no series data, so the highest-numbered
playoff match is guessed to be the Finals. **The Finals range box fixes both:** a non-blank Finals range
names the finals matches (overriding detection) and limits the Finals category to them; the remaining
playoff matches are Semi-Finals. The `F` prefix still means all playoff matches everywhere else; labels
here are `P12`, `Q12`, `SF5`, `F14`.

**P16-3. Ranges.** One text input per enabled category (`2-4, 8, 10-12`), validated as you type, overlapping
and touching ranges merged, blank = every match. The "N matches selected" chip reports the saved range's
effect, so it updates when the text is committed (blur or Enter) — a half-typed range never saves, and an
unreadable one is never saved. Ranges limit max targets, individual-target defaults, the table, and coverage.

**P16-4. Max targets.** The number of matches in the category within its range, read from the schedule
("from API"); editable ("manual") with **Reset to API**. With no schedule (e.g. a manual library event)
the box starts blank and is manual. A typed individual target is clamped to 0..that max (or 999 while the
max is still unknown).

**P16-5. Individual targets.** Rows = members whose primary **or secondary** role is Match Scout **and**
who are marked attending for any selected event (Assignments attendance), plus anyone added by hand
(removable). Each cell prefills from Assignments (distinct assigned matches of that category within the
ranges) **when a published schedule exists**, else it's blank; a typed number overrides it ("manual",
with a reset). Categories turned off are disabled. For a **practice-scouting** (library) event there is
usually no attendance, so the table starts with just the people added by hand (and anyone with entries,
flagged "not in targets").

**P16-6. Persistence.** `scoutTargets/{teamId}_{eventCode}`: `ranges` (text per category),
`maxOverrides`, `individual` (uid → category → number), `extraScouts[]`, `updatedBy`, `updatedAt`.
Realtime for everyone, read as a **team-scoped query** (a doc that doesn't exist yet can't be read
directly under the rules — the FIX3 lesson; `assignments` are read the same way here for the same reason).
`can("editScoutTargets")` = admins + members whose primary or secondary role is **Lead Scout**
(`lib/scout-status/permissions.ts`, mirrored in `firestore.rules`' `canEditScoutTargets()`), enforced in
rules and tested. Saving replaces the whole event doc, so two editors changing the *same event* at once
is last-writer-wins (different events don't collide).

**P16-7. Several events.** The setup panels edit **one event at a time** via "Editing targets for"; with
more than one event the default is "All selected events (totals, read-only)" and the three panels show
summed totals; picking an event enables editing. With exactly one event it edits directly.

**P16-8. Status pill.** Complete (entries ≥ target) · Not started (0 entries) · On track · Behind — plus
**No target** (entries but nothing to measure against; not in the prompt). On track vs Behind compares
the scout's progress (entries/target) with how much of the counted schedule has been played; allowed
to trail by 20% (`ON_TRACK_FACTOR` 0.8 in `lib/scout-status/config.ts`, the one config file). When no
schedule or results are available the progress is unknown and the pill is On track; the practice dataset
counts everything as played. "Played" is the API's `played` flag.

**P16-9. Table extras.** Per-category `P/Q/SF/F x/y` chips, last entry (relative time, exact time on hover,
match label), average accuracy (`getPercentColor`), flagged count (undismissed auto-flags or any manual
flag), Missing assigned (assigned robots a scout has no entry for; shown only with a published schedule),
sortable columns, name search, a totals row, expandable per-scout entry lists with a link to Match Scout
Analytics (new `?scout=` param seeds its search). Sticky first column, horizontal scroll on narrow screens.

**P16-10. Coverage.** Collapsible groups per enabled category; each match shows its robots grouped red then
blue with a check **per scout** (two scouts on a robot = two checks; the same scout twice = one), names on
hover/focus and in the accessible label, `x/4 scouted`, and a **Show only missing** toggle. An unplayed
match is muted (○, "upcoming") rather than a red ✗. **Not virtualized:** each group renders 40 matches and
offers "Show more", which is enough for an event's schedule without a virtualization dependency.

**P16-11. Form types.** `lib/scout-status/form-types.ts` registry (`scoutedUnit`, `targets`); only Match
Scout is enabled, the others render as disabled tabs with a "Coming soon" tooltip. Nothing is built for them.

**P16-12. Small changes elsewhere.** `OfficialMatch.series`; `ftcMatchToOfficial` carries it (one existing
test updated); `"/analytics/scout-status"` joined the realized-pages list; Match Scout Analytics reads `?scout=`.

### P16: verification

Run and passing: `tsc`, `eslint` (0 errors, the same 2 warnings), `vitest` (784 tests; new
`lib/scout-status` (55: finals with 2- and 3-match series and the fallbacks, ranges parse/merge,
max targets, assignments → targets, multi-event sums and distinct-match counting, duplicate-scout checks,
status pills, table rows, the accuracy filter, coverage, who's in the table, who can edit) and the render
smoke tests (10)), `next build`, and the emulator suite **`npm run test:rules`: 275 tests, all passing**
(9 new for `scoutTargets`: team read incl. none-yet, other-team/unfiltered/signed-out blocked, admin and Lead
Scout (primary or secondary) write, everyone else read-only, id/updatedBy, shape and size limits,
immutable team/event, no delete, and exactly what the store writes).

**Not verified:** anything visual or interactive (no browser): the layout, accordions, sticky columns,
mobile scrolling, the editing flow, and the real FIRST API's playoff `series` values and `played` flags
(see P16-2). The store and the live hooks were not run against a real project.

## P17 — Mobile optimization pass

**P17-0. No clarifying questions were asked** — nothing blocked. As in P1-1 the prompt's Vite/React wording was
read as this Next.js app.

**P17-1. This was a static audit; no browser was available.** The prompt asks for Playwright screenshots at five
viewports and Lighthouse mobile results. The build environment had no browser, so I could not produce either, and
I did not invent numbers. What I did instead: read every route/component for the known phone failure patterns,
fixed them in code, added `lib/mobile.test.ts` to guard the fixes, and wrote `scripts/mobile-audit.mjs` (Playwright,
five sizes, Chromium + WebKit, fails on any horizontal scroll, lists targets under 44px). `docs/mobile-audit.md`
says plainly which items are unverified. **Needs you:** run the script and Lighthouse and look at the screenshots.

**P17-2. Touch targets by a global rule, not by editing every button.** On `(pointer: coarse)` every
button/select/summary/text input has a 44px minimum height, icon-only buttons 44px wide. Rationale: dozens of
`h-8`/`h-9` controls across the app; a single floor is consistent and can't regress per component. Checkboxes,
switches, and radios keep their size and get an invisible 10px hit-area expansion (growing them would break the
design). `.touch-compact` is the opt-out. Risk: some dense rows may look taller on phones — to be judged on a device.

**P17-3. 16px form text under 1024px**, not just on phones, because iPad Safari also zooms on focus. It is an
unlayered rule so it overrides `text-sm`. Desktop is unchanged.

**P17-4. Phone navigation stays the existing slide-out drawer** rather than adding a bottom tab bar. The app has
~20 destinations (Analytics subpages, Admin), which don't fit tabs, and the bottom of a scouting screen is already
occupied by the sticky Next Robot / score bar. The droplet button and offline badge are in the top bar on phones.

**P17-5. Dialogs become bottom sheets with CSS classes (`max-sm:`) on the one shared `DialogContent`**, not a new
Sheet component, so every dialog converts at once and desktop is untouched. Dropdown selects and popovers were
already trigger-anchored and viewport-clamped, so they were left alone. The backing stays solid (`glass-strong`).

**P17-6. Safe areas and viewport.** `viewport-fit=cover` + `env(safe-area-inset-*)` on the sticky bars, the sticky
practice video and the top bar; `dvh` instead of `vh`. `interactiveWidget: resizes-content` makes Chromium resize the
layout for the keyboard (so sticky bars sit above it); iOS Safari ignores it, and the sticky bars are positioned from
the bottom of the visible area there anyway.

**P17-7. Performance: lighten, don't remove, the glass.** Under 768px blur radius drops to 12-16px and the three
animated background blobs are frozen without their extra blur filter; `prefers-reduced-transparency` gives solid
panels; `MotionConfig reducedMotion="user"` honors reduced motion in Framer Motion. Animations were already
transform/opacity. No chart library exists (SVG), so nothing to lazy-load. **No Lighthouse budget was set** because
nothing could be measured (see P17-1).

**P17-8. Deliberately not done:** card views for the wide tables (Match Analytics, Team Averages, Rankings, Scout
Status) — they scroll horizontally inside their own container (Scout Status also has a sticky first column), which satisfies "no page
scroll"; whether they need cards should be decided from real screenshots. The 5-6 column stats row on the Pick List
may be tight at 360px (flagged in the audit). Touch drag on the Pick List was not touched (P12 already has a
long-press sensor and button moves).

**P17-9. Installable app.** `app/manifest.ts` (`display: standalone`, start URL `/dashboard`), icons generated by a
small committed script so there is no image tooling dependency (a trophy glyph on the brand gradient; replace the
PNGs in `public/icons/` with real artwork any time, keeping the names and sizes — `lib/mobile.test.ts` checks them).
No service worker was added, so the Firebase Messaging worker is untouched. The iPhone hint is a small component shown
only in an iOS browser tab, where notifications are offered (live practice results).

### P17: verification

`tsc` clean; `lib/mobile.test.ts` (16 tests); lint, the full vitest run and `next build` are reported in the final
summary. No Firestore rules changed. Not verified: everything visual (see P17-1).

## P18 — Themes overhaul, Settings > Appearance, sidebar fixes, and the blur bug

**P18-0. One question batch, answered "defaults".** (1) Berrisexual and Almond/Verian flags are **left out** (I wasn't certain of their colors); the Intersex flag is
shown as yellow to purple (`#ffd800` to `#7902aa`, it is a ring, not stripes) and Progress Pride as the chevron plus the six stripes. (2) Playwright was added
(`@playwright/test`, Chromium and WebKit downloaded). (3) The contrast guard runs in `prebuild` (so Vercel's build fails on a bad theme); no GitHub Actions
workflow was added. As in P1-1 and P17-0 the prompt's "React + Vite" was read as this Next.js 16 app.

**P18-1. "The Settings page" is Account Settings (`/account`).** Its old two-card Theme grid became an **Appearance** section (`AppearancePanel`). The nav label
and route are unchanged. The marketing header had the old pill switcher too; it now has the sun/moon toggle (hidden under `sm`, where the header is already full).

**P18-2. How the themes are built, and what changed for the existing two.** Every color that carries text (all gradient stops, primary, accent) is nudged in HSL
lightness only (hue and saturation kept) until text on it is 4.5:1 and it is 3:1 off the page; the contrast guard measures the result independently.
Consequences you can see: **Team Colors** keeps its red (`#e11d3c` becomes `#d71c39`) and its original dark surfaces exactly, but the orange end of its gradient is
deepened (`#ff7a45` to `#ca3a00`), because white-ish text on the old orange was 2.3:1 and the brief requires 4.5:1. **BIOBUZZ** dark is unchanged apart from the guard;
its old `secondary` (`#3a2a12`, near-invisible dark brown on a dark page) is now `#d97706`; its **light** mode is a deeper honey brown (`#b45309`), since amber can't carry
white text. In **light mode** buttons always carry white text (so fills are deep and saturated); in **dark mode** each theme takes white or near-black text, whichever
needs the smaller change (Cotton Candy, Glacier, Citrus and most flags end up pastel with dark text).

**P18-3. Neutrals.** An accent can't be black on a black page or white on a white page, so: **Obsidian** is ink (`#18181b`) in light and graphite (`#71717a`) in dark;
**Pearl** is near-white in dark and a warm pewter (`#78716c`) in light; **Slate** is slate gray in both. Surfaces and text still switch with the mode, and the glow flips
(light glow on dark, ink shadow on light). Pearl and Slate are close cousins in light mode; that's the cost of keeping buttons visible.

**P18-4. Light mode for components written for dark.** About 100 places use `bg-white/N` tints and 160 use pastel `text-red-300` / `amber-300` / `emerald-300` /
`blue-300` shades. Rather than restyle outside this prompt's scope, `app/globals.css` remaps them for `data-mode="light"` (translucent-black tints; the 700/800 shades of the
same hues). Where an icon sits on a gradient fill, `text-white` became `var(--color-primary-foreground)` (9 spots) so it is legible on every theme. **I only looked at the
fixture page (shell + Appearance + glass samples) in light mode, not every app page**, so an individual page with its own hardcoded colors may still need a pass.

**P18-5. Flags.** 18 flags: Rainbow, Progress, Gay (MLM), Lesbian, Bisexual, Pansexual, Demisexual, Omnisexual, Transgender, Non-binary, Asexual, Aromantic, Genderfluid, Genderqueer,
Agender, Polysexual, Intersex, Bigender. Each is its widely recognized sequence as a smooth gradient, labelled "Pride: ...". "Other popular ones" was limited to flags I am
certain of; please eyeball the colors in `lib/themes.ts` (they are plain hex lists). Progress Pride is in true left-to-right order from the hoist: black, brown, light blue, pink,
white, then the six stripes. Every flag shares one fixed dark glass and text treatment (the page is the flag's colors deepened); stripes that are black or white are lightened or
darkened by the same fit as everything else, so a flag's button gradient is a legible version of its colors, not the raw stripes.

**P18-6. Light/dark on flags.** While a flag is active the applied mode is `dark`, the Settings Mode control and the sun/moon toggle are disabled (Settings says why and names the
saved choice), and `colorMode` is never overwritten, so leaving the flag restores the user's own choice. Light/Dark/System and the theme are saved independently.

**P18-7. Persistence and first load.** `ThemeProvider` moved inside `AuthProvider`. The account's `themeId` / `colorMode` win over this browser's once the profile loads (as the glass level
does); a missing `colorMode` keeps this browser's, or the system's. **Two first-run effects after deploy:** (a) the initial mode follows the system, so someone whose device is in light
mode sees Team Colors *light* on their first load; (b) the old sidebar switcher only ever saved to localStorage, so a user whose account says `team` but who had picked BIOBUZZ locally
will see their account's theme once.

**P18-8. Connection chip.** Placed in the desktop sidebar footer (full width; a dot with a portal tooltip when collapsed), the mobile top bar (fixed `6.75rem` width, the wordmark hides under 420px
to make room) and the mobile drawer. Offline with submissions waiting reads "Offline · N"; "Syncing N" is amber and pulses. The solid backing is `--surface-solid`, an opaque theme color (not
tied to `--glass-shade`). The droplet badge and the glass popover's offline message are removed.

**P18-9. Sidebar arrow.** Cause: the arrow was a child of the `overflow-hidden` glass panel and positioned half outside it, so the outer half was clipped. Fix: an outer `aside` that only sizes and
positions, an inner glass box that clips, and the arrow as the inner box's sibling. It exists only from 1024px up (below that the app uses the drawer), so "tablet" means iPad landscape and up;
phones and portrait tablets have no arrow. The test hit-tests five points on the button, including the outer edge, expanded and collapsed, at 1040 / 1280 / 1536px (not exactly 1024:
Playwright's Windows WebKit counts its classic scrollbar against `min-width: 1024px`).

**P18-10. Contrast guard: what it does and doesn't cover.** Thresholds 4.5 / 4.5 / 3 with a small margin (4.55 / 3.2) in the fitting. Body and muted text are measured on the page's
worst case (each blob at full strength), one and two stacked glass layers, floating overlays (also over pure black and white), and the solid chip, **at the default glass level**; the glass
slider below 1 makes overlays more see-through by the user's choice and is not guarded. Known gaps: `--color-primary` used directly as small text color (8 places) is held to 3:1, not 4.5;
phase-bar and avatar colors are fixed palettes, not themed.

**P18-11. Blur bug, cause 1 (theme-switch transition). Not reproduced; removed anyway.** The old `ThemeProvider` wrapped every change in `document.startViewTransition(...)` on the root, and
`globals.css` animated `body`'s colors for 0.6s. A root view transition snapshots the document, and glass (`backdrop-filter`) layers are the classic thing that breaks across one in WebKit.
I could not reproduce it: with the old code temporarily restored, the blur test passed in Chromium and WebKit (Playwright's Windows WebKit; I have no real iPhone). I removed it because it
is the one theme-switch mechanism that touches the root, and replaced it with a 450ms `theme-animating` class that only transitions color properties on elements. Treat this as a
precaution that fits the brief, not as a confirmed fix for an iPhone-only symptom; please check on a real iPhone. Other suspects from the brief, checked: no ancestor of glass has
opacity, filter, mask, clip-path, blend mode or will-change at rest (asserted for every theme x mode); a missing token is impossible now (every rule is generated from one complete
`ThemeTokens` shape and tested); the glass slider and the mobile "lighter blur" are driven by `--glass-shade` and viewport width only, never by the theme; a theme change is two attribute
swaps, so nothing remounts.

**P18-12. Blur bug, cause 2 (confirmed, and bigger): the build was deleting the unprefixed `backdrop-filter`.** The first run of the new test found `backdrop-filter: none` on every glass
element, in every theme, in Chromium, before any switching. Cause: Next's CSS pipeline (Lightning CSS, default targets Chrome 111 / Safari 16.4) keeps **only** `-webkit-backdrop-filter`
when the unprefixed property is written first, which is how `globals.css` was written (and Tailwind's `backdrop-blur-sm` came out prefixed-only too). Only Safari understands the prefixed form, so
Chrome, Edge and Firefox showed **no glass blur at all**, in dev and in the existing production CSS (`.next/static/chunks/*.css` from before P18 has `.glass-panel{...-webkit-backdrop-filter...}`
and no unprefixed twin). I reproduced it in isolation with `lightningcss` (unprefixed-first: prefixed only; prefixed-first: both). Fix: every pair in `globals.css` is now prefixed-first, and
the three `backdrop-blur-sm` scrims became `.scrim-blur`. `lib/glass-css.test.ts` guards the order, bans `backdrop-blur-*`, and runs the real Lightning CSS transform on `globals.css`; I confirmed
it fails on the old order. This may or may not be what you saw on your phone (Safari kept its blur), but it is why Chrome users never had any.

**P18-13. The Playwright suite.** `npm run test:e2e` (4 projects: Chromium and WebKit, a desktop and a phone viewport; Pixel 7 and iPhone 14 emulation). It needs a page to run on without a Firebase
login, so the real Sidebar, Topbar, PageTransition and Appearance panel render on `/e2e/theme-check`, which is a 404 unless `E2E_THEME_CHECK=1` (set only by `playwright.config.ts` for its own server;
Vercel never sets it). It tests `next dev` by default; `E2E_PROD=1` tests a production build. The test waits for hydration (the page-transition wrapper starts at opacity 0), then for each theme x mode
asserts every glass sample's `backdrop-filter` is non-`none` and identical to the baseline, and that no ancestor is a backdrop root. It is not in any CI (there isn't one); it needs the browsers
(`npx playwright install chromium webkit`) and takes about 1-4 minutes per project.

**P18-14. Firestore.** No rules change: `colorMode` is a new optional field on the user's own doc, which the existing own-doc update rule allows (a rules test was added; the full emulator suite, 276 tests,
passes). Observation, **not changed**: the admin member-edit rule only pins `teamId`, `isOwner` and the role fields, so an admin can write *any other* field on a teammate's user doc (`name`, `themeId`,
`colorMode`, `glassLayerLevel`). Worth tightening in a later rules pass.

**P18-15. Deliberately not done.** A GitHub Actions workflow (there is no CI to hook into); a per-page light-mode visual audit of the signed-in app (needs a login; see P18-4); real-device iPhone verification;
Lighthouse or pixel-diff blur checks (the test asserts computed styles and ancestors, as the brief describes).

### P18: verification

`tsc` clean; eslint 0 errors (the 2 existing TanStack Virtual warnings); `vitest run` 884 tests in 57 files, including new `themes.test.ts` (the contrast guard for all 60 theme x mode combinations, registry,
generated CSS, pre-paint script), `theme-color.test.ts`, `theme-prefs.test.ts`, `connection-status.test.ts`, `glass-css.test.ts`; `npm run build` passes (its `prebuild` runs the guard);
`npm run test:rules` 276 tests pass; Playwright: all four projects pass.

## P19 — Several FTC teams under one account

**P19-0. One question batch, answered "defaults", plus one change.** The defaults: the migration keeps whatever `number` the team has now as the first FTC team
(the second team is not invented: an admin adds it in Team Settings); it runs server-side on every sign-in; a member with no team counts as every team;
signed-out surfaces get neutral wording; the "viewing as" team is saved on the user's doc. The change: **Team Settings is its own page**, not a section of
Account Settings (see P19-1). As in P1-1, P17-0 and P18-0, the prompt's "React + Vite" was read as this Next.js 16 app.

**P19-1. Team Settings is `/team-settings`.** The prompt says "In Settings, add Team Settings"; at the user's request it is its own page with its own
sidebar entry (above Account Settings, so the account's settings sit next to the personal ones), visible to everyone and read-only for non-admins. Account
Settings (`/account`) is unchanged: it stays the personal page (profile, password, appearance).

**P19-2. There was no "FRC" text.** The sidebar line already said "FTC 3468 MAGNAtech", hard-coded, and wrong for this account. It is now data-driven.
The same hard-coded team appeared on signed-out and static surfaces that can't read team data (marketing page, footer, page metadata, PWA manifest): they now
say "A scouting app for FTC teams" / "Built for FTC scouting teams", and the signed-in footer lists the account's FTC teams. The sign-up and scout-form
placeholders ("3468", "MAGNAtech") are generic examples now. **Left as they were:** `3468` in unit-test fixtures, in `lib/mock-data.ts` (nothing imports it),
and in the bulk-import CSV template's example row (an example, not an identity).

**P19-3. Ids, mirrors and legacy fields.** FTC team ids are stable strings (`ft-<number>` for the migrated first team so a repeated or half-finished
migration always agrees with itself; `fteam_<8 chars>` for teams added later), so changing a team's number never breaks anyone's assignment. Rules can't
project a list of maps, so `teams.fieldTeamIdList` mirrors the ids and member assignments are checked against it; the editor always writes both together.
The legacy `number`/`name` mirror the first team on every save and are still read as a fallback, so nothing that predates P19 can show "no team". A team's
`name` is optional (`""`); where it is missing the UI shows just "FTC 35792".

**P19-4. Migration.** Server-side (`/api/team/sync-field-teams`, Admin SDK), best-effort after every sign-in, any member may trigger it (it only fills in what's
missing, so the result doesn't depend on who ran it). Team doc in a transaction, members in batches; members who already have a `fieldTeamIds` list are never
touched, so an admin's later assignments survive any number of runs. It does not guess a second team: **if the existing `number` isn't one of your two teams
(35792 / 35794), an admin fixes the number of the first team and adds the other in Team Settings after deploy** (the first team keeps its id, so assignments
carry over). New members (join, owner auto-attach) start on every FTC team; the account creator starts on the first.

**P19-5. "No team" means "all teams".** A member with nothing recorded, or only teams that no longer exist, counts as on every FTC team for display, defaults
and filters (the member editor says so, and rows show an "All teams" chip). The alternative (an unassigned member appearing nowhere) would hide people after a
removal or an unticked box. Data access is the same either way.

**P19-6. The "viewing as" team.** `users/{uid}.activeFieldTeamId`, written by the user themself (a display preference, like the glass level), resolved against
their assigned teams: the saved team if they are still assigned to it, else their first assigned team. So removing the team someone was viewing, or
unassigning them from it, just moves them to their first team; no cleanup is needed.

**P19-7. Rules, and what they can't check.** Only an admin or the owner can edit `fieldTeams`, `accountName` and members' `fieldTeamIds`; a member's own-doc
rule pins `fieldTeamIds`, so the self-assign rule is "an admin can (through the admin rule), anyone else can't". Owner protections (FIX2) are unchanged: an
owner's row is edited only by that owner. **Two deliberate choices:** (a) the `teams` update rule changed from `isAdmin()` to `canManageMembers()` (admin or
owner), so the owner can edit FTC teams even if their admin flag were ever stale; in practice owners are always admins, so nothing else changes. (b) A
stale (unchanged) assignment never blocks a role edit; only a *change* is checked against the account's teams. **Not expressible in rules:** per-entry shape of
`fieldTeams` (number 1 to 5 digits, unique); the Team Settings editor validates it, and only admins can write it. The pre-existing looseness noted in P18-14
(an admin can write other fields on a teammate's doc) still applies, now including `activeFieldTeamId`.

**P19-8. FIRST lookup.** `getTeamByNumber` uses the default season. A typed number is checked 500 ms after the last keystroke; a hit fills the name only if the
admin hasn't typed one (or still has the auto-filled one); a miss ("FIRST has no FTC team with this number this season") and a failure ("Couldn't check
FIRST right now") both leave Save available, because a manual name always works. The lookup is a convenience, not a gate.

**P19-9. Removal and saving.** The last team can't be removed (the button is disabled with a tooltip, validation and the rules also refuse an empty list).
Removing a saved team that has members assigned opens a "move them to" dialog; the move happens in the **same batch** as the save, with its audit entry. A
removal whose target is removed later in the same edit is followed on to a surviving team. Editing works on a local draft; if someone else saves while you edit
you see a notice and **last write wins** (the realtime listeners are not merged into a draft you are typing in).

**P19-10. Sidebar.** The account name (when set) replaces the old subtitle under the wordmark; the active team sits below it. One FTC team assigned: a plain
display, no popover. Several: a button opening a listbox popover (portal, `glass-overlay` high-opacity backing so names stay legible in every theme; arrow
keys, Enter, Escape). Collapsed: just the number. Signed-out/marketing surfaces have no provider and render nothing.

**P19-11. Team Management.** Per-member checkboxes live in the member editor (hidden when there is only one FTC team: nothing to choose). The team filter is
a single select (All / one team); unassigned members match every team. Bulk: row checkboxes (only rows the viewer may edit are selectable), a "select all
shown" box and a floating bar to **add to** or **remove from** one team; each affected member gets an `edit-member-teams` audit entry in the same batch. An
admin may assign themself (the rules allow it through the admin path); nobody else may.

**P19-12. Ripple effects.** "Our team" = **any** FTC team on the account wherever a page highlights (a filled "Us" tag, a tinted row, a ring on chips and
cards), in Team Averages, Rankings, Team Breakdown, Match Breakdown and Match Scout Analytics. "Active team" drives the Dashboard (header strip, next match,
rank, record: they all read `ourNumber`) and the Pick List's starting "our team"; the Pick List has its own switcher (page-local, doesn't change the saved
choice). Scout Accuracy's Team filter decides who is **shown** but, unlike Role/Event, doesn't create its own ranking pool: a scout's rank shouldn't change
because you looked at one team. The Assignments filter narrows the attendance/scout picker (quick selects act on who's shown; people already selected but
filtered out stay selected).

**P19-13. Deliberately not done.** Team Profile pages for our own teams don't carry the tag; the Pick List board doesn't mark a sister team's row; dashboard
widgets other than the header strip simply follow the active team; events, assignments and scouting data are not scoped per FTC team (the prompt says shared);
the join code is still per account. Light-mode and real-device checks of the new controls: only the Playwright fixture (Chromium and WebKit, desktop and phone) in
the default theme.

### P19: verification

`tsc` clean; eslint 0 errors (the 2 existing TanStack Virtual warnings); `vitest run` 928 tests in 59 files pass (new: `field-teams.test.ts` 35, `field-teams-context.test.tsx` 7, plus
additions to `member-access` and the scout-stats engine); `npm run test:rules` 299 pass (16 new rules tests, 7 new migration/API tests); `npm run build` passes; Playwright
`e2e/field-teams.e2e.ts`: 10 pass (the 10 desktop-only ones skip on the phone projects), and the existing sidebar and connection-chip tests still pass.

### P19: commands to run

1. **Deploy the rules first (or together with the app):** `firebase deploy --only firestore:rules`. Without them the app still works, but nothing enforces who may
   edit FTC teams or assignments.
2. Push `preview` / merge as usual (Vercel deploys the app). **No new environment variables.**
3. After the first sign-in the account is migrated automatically. Then, as an admin, open **Team Settings** (sidebar), check the first team's number and name (it is whatever
   the account's number was before), and **add the other team** (35792 / 35794). Assign members in **Team Management** (per-member Edit, or select several and use the bar).
4. To run the browser tests: `npx playwright install chromium webkit` once, then `npm run test:e2e` (or `npx playwright test e2e/field-teams.e2e.ts`).

## P20 — Team applications (owner-approved) and ownership transfer

**P20-0. One question batch, answered "defaults" except email.** (1) `OWNER_EMAILS` is assumed to be only you; if it ever lists several people in one account, the earliest-created user already flagged owner keeps team ownership and the
others become plain admins (still platform owners). (2) A team FIRST doesn't list (or an unreachable FIRST API) is a **signal**, not a block. (3) The applicant's role is a dropdown of the existing roles; it becomes the primary role of
their new account, where they are also admin and owner. (4) A rejected applicant may apply again straight away (the rate limits and the one-pending rule still apply; Block is the permanent stop). (5) **Email was approved** ("you can make email
infrastructure"), so applicants and the platform owner get emails instead of the status page alone (still shown there too). As in P1-1, P17-0 and later, the prompt's "React + Vite" was read as this Next.js 16 app: the client key is
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, not `VITE_TURNSTILE_SITE_KEY`.

**P20-1. The two owners.** Platform owner = `OWNER_EMAILS`, as the `platformOwner` claim (+ the `isPlatformOwner` mirror). Team owner = `teams.ownerUid`. The old `owner` claim is gone (stripped on the next sign-in); the platform-only routes check
the verified token **and** the live `OWNER_EMAILS` list, so removing an email takes effect on the next request (the Firestore rules can only see the claim, so the review-queue collections stay readable until that person's next sign-in
refreshes it, which only matters for reading applications, never for writing: every write is a server route). `users.isOwner` is kept as a **mirror** of `ownerUid` (server-written, in the same transaction) so the roster, the badge and
`canEditMember` need no extra read; the rules do not trust it once `ownerUid` exists.

**P20-2. "I remain owner and am never locked out."** Until an account has an `ownerUid`, the rules fall back to the legacy `isOwner` flag, so nothing changes in the window between deploying and the first sign-in. The first sign-in by anyone on
the account then runs the bootstrap and writes `ownerUid` for the already-flagged owner. The bootstrap only fills an empty `ownerUid`, inside a transaction, so `sync-roles` can't take ownership back after a transfer (a test signs the platform
owner in repeatedly after handing the account over). An account with nobody flagged and no platform owner on it stays ownerless until a platform owner joins it and signs in, or a recovery transfer is done.

**P20-3. Platform owners are admins, and they are members of one account.** `sync-roles` makes a platform owner an admin (never revoked automatically). Creating a team (when the switch is on) makes its creator the team owner, since otherwise an
account created by a non-platform-owner would have nobody who could ever transfer it.

**P20-4. Applying needs a signed-in, verified email.** An applicant first signs in (Google counts as verified; email/password must click the link), because the server reads `email_verified` from their ID token. That means anyone can create
a Firebase sign-in account (as before: Signup was never CAPTCHA'd); what the protections guard is the **application**. Signup and Finish Setup show "Apply to create a team" only while public creation is off.

**P20-5. Anti-bot measures, and what each one costs a human.** All server-side. **Honeypot** (`orgUrl`) and **minimum time-to-submit** (4 seconds; the browser can't fake it, because the server issues a signed start token when the form opens, valid
for 2 hours). **Turnstile** when configured; if the secret is unset the route still runs everything else and the platform owner sees a warning banner and a "No CAPTCHA" signal on each application; if the secret is set but the site key isn't,
every application is refused and the warning says so. **Rate limits**: 3 applications per IP per hour and 3 per email per hour (both hashed with an HMAC, never stored raw), plus a 40/hour per-IP cap on every request so invalid requests can't be
used to hammer the route; one pending application per applicant, per canonical email (so `a.b+x@gmail.com` is the same mailbox as `ab@gmail.com`) and per team number. Counters are Firestore docs (`rateLimits`), no new infrastructure; a TTL policy on
`expiresAt` is optional. **Disposable email**: a hand-maintained list in `lib/disposable-domains.ts` (add a domain there to refuse it). **Sizes/sanitizing**: a 16 KB body cap, per-field limits, control and bidi/zero-width characters stripped,
links must be http(s). The IP's hash is the only network identifier stored, and only in the platform-owner-only private doc.

**P20-6. What the review queue shows.** The signals are recorded at submission and are advice, not rules: email verified (and how), FIRST found / name matches / not listed / unreachable (current season), sign-in account age, a free vs custom email
domain, whether CAPTCHA ran, seconds spent on the form, repeats from the same IP in the hour, and whether an account already lists that FTC number. An existing account for the number is refused at submission (they should join it) and again at
approval (an account could appear in between). Only the **first** FTC number of older accounts could be looked up before; `fieldTeamNumbers` (a mirror `fieldTeamsWrite()` now maintains, filled in by the P19 migration on the next sign-in) makes
every FTC team on an account findable.

**P20-7. Approval is a transaction.** Team, applicant, application status and audit entries are written together, or not at all, and simultaneous approvals create exactly one team (tested). The new account's own Audit Log gets a minimal
"Team Application Approved" entry with no applicant details; the full record goes to `platformAuditLog`, which only platform owners can read, so another team's admins never see applicant data. Platform owners get an in-app count badge (Admin Panel
tab and sidebar item), a web push to devices that enabled notifications (the same tokens live-score pushes use), and an email to `OWNER_EMAILS`.

**P20-8. Transfer rules I chose.** The recipient must be an **admin** with a **verified email** (checked on the server, from Firebase Auth, not from the roster) both when the request is made and when it is accepted. "Type the team number" accepts
**any** of the account's FTC team numbers (an account can have several since P19). Re-authentication means a sign-in no older than 5 minutes, enforced from the ID token's `auth_time` (the browser re-authenticates, then refreshes the token); the
refusal itself is unit-tested (`isRecentSignIn`, `checkTransferRequest`), but not at the HTTP level, because faking the clock under live emulator calls hangs. One pending transfer per account; expiry (7 days) is lazy, so an expired transfer simply
can't be accepted and a new request replaces it. A pending transfer is voided if the account's owner changes in between (a recovery transfer clears it, and accepting a request whose requester is no longer the owner fails as "stale").
Either the owner or whoever requested it can cancel.

**P20-9. Recovery (force transfer).** Platform owners get Admin Panel > Recovery: every account's FTC teams, owner and **admins** (nothing else: no scouting data, no join codes, no non-admin members). Forcing a transfer needs a reason, a recent
sign-in and the typed team number; the new owner must be an existing member with a verified email and is made an admin and owner; the old owner stays an admin; it is labelled "(platform owner, recovery)" in that account's own Audit Log and also
written to `platformAuditLog`. This is the one place a platform owner sees any other account's member names and emails.

**P20-10. Email.** A small sender over Resend's HTTP API (no dependency); unconfigured = silently skipped. I did not build bounce handling, unsubscribe links or templates beyond the six messages; they are transactional and few. Emails never contain
join codes, and the rejection email repeats exactly the reason the applicant can already read in the app.

**P20-11. Deliberately not done.** Nothing is automatic: no auto-approval, ever. No browser (Playwright) test of the apply flow, because it needs a Firebase sign-in; the form, status card and a signed-out page were checked visually in light and dark,
and every route is tested against the emulators. The Turnstile widget itself isn't exercised end-to-end (it needs Cloudflare); the server verification is unit-tested with a mocked fetch. Applicants can't edit or withdraw a pending application (they can
apply again after it is decided or expires). No per-applicant notification when a platform owner is added or removed mid-review.

### P20: verification

`tsc` clean; eslint 0 errors (the 2 existing TanStack Virtual warnings); `vitest run` all pass (new: `applications.test.ts`, `team-owner.test.ts`, `server/security.test.ts`); `npm run test:rules` (rules + API emulator tests) all pass, including the
cross-account isolation and the owner-bootstrap tests; `npm run build` passes.

### P20: commands to run

1. **Deploy the rules first (or together with the app):** `firebase deploy --only firestore:rules`.
2. Push `preview` / merge as usual. **No env var is required** for the app to work. To turn the protections on, add in Vercel (Production and Preview): `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (create a Cloudflare Turnstile site: see
   `docs/DEPLOYMENT.md` section 9b), and for email `RESEND_API_KEY`, `EMAIL_FROM` and `APP_URL` (section 9c). Optional: `APPLICATION_SECRET` (any long random string). Redeploy after changing env vars.
3. **Sign out and back in once** after deploying: that runs the owner bootstrap (writing `ownerUid` for the existing owner) and refreshes your token to carry the new `platformOwner` claim.
4. Check Admin Panel > Team Applications: the warning banners tell you exactly which protections aren't configured yet. Public creation stays off; applicants use Sign up > Apply to create a team.
5. Optional: a Firestore TTL policy on the `expiresAt` field of the `rateLimits` collection group (Firebase Console > Firestore > TTL).

## P21 — Form schema v2 and the form engine

**P21-0. Questions and defaults (no more asked; you were away).** Read "React+Vite" as this Next.js app. (1) **Existing entries: adapter only, no backfill.** Old entries are read through `entryValues()` and never rewritten, so
there is nothing to migrate and no migration to get wrong. (2) **New BIOBUZZ entries dual-write the legacy `fields`** (as well as `values`) so an old tab or a rollback still reads them; any form that has dropped a legacy key
stops dual-writing. (3) **Score shape** stays `{ auto, teleop, endgame, total }`, plus an optional `byPhase` only when a custom phase scored. (4) **zod** added as the validator. (5) **@dnd-kit** (already installed for P22) is for the builder. (6) **Seasons stay
code-defined** (`lib/seasons.ts`); forms are chosen per season through `teams.activeForms`. (7) Email stays a no-op when unconfigured (P20).

**P21-1. BIOBUZZ is behaviour-identical, and that is tested, not asserted.** The old hard-coded form, scoring and Match Analytics table are frozen as fixtures that nothing imports (`lib/forms/fixtures/biobuzz-v1*.ts`),
and `lib/forms/biobuzz-regression.test.ts` compares the new engine to them: fields/order/defaults, scores on 1,000 seeded random entries, the adapter, the dual-write, table columns and cells, byte-identical CSV, a CSV
round trip, flags and team stats from both storage shapes. If one of those ever has to change, BIOBUZZ's behaviour changed; change the fixture only on purpose.

**P21-2. Built-ins live in code; an account only stores what it changed.** An edit to BIOBUZZ is a copy-on-write override that starts as a draft and changes nothing for scouts until published. The override's first version is
`builtin.version + 1`, so entries scouted before it keep resolving to the original in code. "Reset to built-in" turns the override off without deleting any version. If the code-defined original later changes, the override
is flagged (`builtinChangedSince`), never silently merged.

**P21-3. Published versions are immutable and numbered 1, 2, 3…** (an override continues from the built-in's version). Entries record `formId` + `formVersion`, so any old entry can always be shown with the form it was
scouted with. Drafts can be invalid; a version can't. Forms are archived, never deleted (an entry's `formId` must always resolve). An unresolvable active form falls back to the season's built-in so scouting never breaks.

**P21-4. A scout's form is fixed for a practice session.** `useLockedForm` takes the season's active form once the account's forms have loaded and never changes it, so both robots of an alliance (and a live/lobby
pair) use one version even if an admin publishes mid-session. A real-event scout gets the latest on their next load.

**P21-5. Rescoring reads the *current* form.** Rescore / Recalculate Accuracy resolve each entry's form to the account's **latest** published version for its `formId` (`FormResolver`), so changing a scoring rule and rescoring
applies the new rule to old entries as intended. The entry's stored `formVersion` is what the entry was scouted with and is unchanged; its stored `score` is what the rescore updates.

**P21-6. Mixed versions in one table are unioned.** Analytics builds one table from every version in scope (sections by id, fields by key, the first form's definition wins). A field renamed through `keyAliases` shows under
its current key for old and new entries alike. A cell for a field an entry's version never recorded is blank (an em dash), not 0, so "didn't ask" is never confused with "asked, none".

**P21-7. The Game filter scopes by a set of form ids.** An analytics Game (season) includes the season's built-in form, the form currently active for it and any account form tagged with the season id, so entries scouted with
an edited or custom form still appear. (Previously `entry.formId === season id`, which only worked while the form id and season id were the same.)

**P21-8. Scoring off means "n/a", never an error.** Entries from a form with `scoringEnabled: false` are written with `scored: false`, score 0, no score/accuracy columns, no score-based flags, and accuracy
"n/a" in solo, live, lobby and real-event paths. In a table that mixes scored and unscored forms their score cells are blank.

**P21-9. Hidden means ignored.** A field that a `visibleWhen`, its parent field or its hidden category hides is not scored, not required and not counted in stats, but its stored value is kept, so flipping a condition
off and on again loses nothing.

**P21-10. Key rules.** Keys are unique and stable; renaming one requires a `keyAliases` entry (the builder in P22 adds it), because the key is what old entries are stored under. The three system fields keep the fixed keys
`match`, `scoutName`, `teamNumber`: they live on the entry itself, not in `values`.

**P21-11. Validation is strict on the way in.** `parseForm` (zod, strict) rejects unknown keys and types, control characters in short labels and over-size forms; `checkForm` errors block publishing, warnings don't. Rules can't
check a nested form element by element, so every write path (the stores, the import) runs the same zod schema before writing; the rules cover ownership, ids, shape of the doc and write-once versions.

**P21-12. CSV import recomputes.** Import trusts only the input columns (Match / Team / Scout and the form's fields); score, accuracy and flags are recomputed against the form the rows are stamped with (the season's
active form). The file's headers are the form's `csvHeader` (default `Phase - Category - Label`), so a CSV exported from the table imports back into the same form.

**P21-13. Portable forms are custom copies.** Exporting BIOBUZZ gives a custom form with no link to the built-in (so importing it in another account never becomes an "override"). Import never overwrites: it returns a draft
for the caller to name and save.

**P21-14. Who can write forms.** The rules let admins and the owner write (`canManageMembers()`); P22's UI gates the builder with the same people through `can('manageForms')`. Scouts can read forms (they have to fill them in).


## P22 — Form Builder UI

**P22-0. Questions and defaults (you were away).** "React Router" is read as this Next.js app: the builder lives in the existing Admin Panel (a new Forms tab), not a new route. @dnd-kit (already used by the Pick List) does drag and drop.

**P22-1. Restore never goes live by itself.** "Restore" puts an old version into the draft; it is published as a new version like any edit (versions stay immutable and numbered upward). Discarding a draft goes back to the live version or the built-in.

**P22-2. Copy-on-write is silent until the first save.** Opening a built-in shows a notice and writes nothing; the first edit's autosave creates the account's override draft. Scouts keep the built-in until the override is published.

**P22-3. Autosave only saves a form that parses.** A structurally invalid form (an empty label, which the strict schema rejects) isn't written; the header says "Not saved yet" and why, and Back warns before losing it. Semantic problems (`checkForm`) are allowed in a draft and only block publishing.

**P22-4. Undo/redo works everywhere in the builder, text boxes included**, because the inputs are controlled and native undo is unreliable there. Typing in one box is one step. Delete, Ctrl+D, Alt+arrows and `?` are off while typing. The undo history lives for the builder session and isn't saved.

**P22-5. Key rename rule.** A field's key follows its label until it is edited by hand or was ever published. Renaming a key that was ever published (in any version, or the built-in) adds an alias so old entries still read; the diff says whether old entries will read under the new key.

**P22-6. Impact warnings are advisory but explicit.** A change that affects scores or data, on a form that has entries, needs a tick before publish and points at the Rescore tool; nothing rescores automatically. "Entries affected" is all entries of the form (any version), since a rescore reads the current form.

**P22-7. Preview is a test fill of the real form.** Device frames constrain width only (Tailwind breakpoints follow the browser window, not the frame), so use "Open as scout" and the window size for true breakpoints. There is no submit in the preview.

**P22-8. Colours are theme tokens.** Field and category colours are `primary/secondary/accent/success/warning/danger`, never a raw colour, so text stays legible in every theme. That is why there is no "low-contrast custom colour" warning: it can't happen.

**P22-9. Phones are read-mostly.** Under 1024 px: the forms list, the structure (read-only), the preview and simple edits (label, help, required, points, option text). Adding, moving, deleting and dragging are desktop-only, with a note.

**P22-10. The template library (P23) entry is present but disabled** in the New form dialog.

**P22-11. Not built (didn't fit cleanly).** Bulk edit exists as a pure operation (`updateFields`) with tests but has no multi-select UI on the canvas; per-field edits and Duplicate cover the common cases. Categories reorder by buttons, not by dragging (fields and palette items do drag).

## P23 — Form templates

**P23-0. Questions and defaults** (all taken as recommended): a top-level `formTemplates` collection; official ones seeded by a platform-owner button; the checksum is a corruption/edit detector only; 3 requests/hour, 5 pending, 256 KB; one report per account per template, never an automatic takedown; a new version of a public template is re-reviewed while the approved one stays live; updates are offered, never applied; the BIOBUZZ template keeps its season tags; platform owners are notified (push + email) and authors emailed.

**P23-1. Private means private, to the platform owner too.** Rules let the platform owner read only `public-pending` and public templates. A private or rejected template can't be read by anyone outside its own account. Moderation never needs more: a request is reviewed in the state `public-pending`, and a pending *update* sits in a subcollection readable by its author and the platform owner.

**P23-2. Why most template writes go through the server.** Browsers can create, edit and delete only a private template (rules). Publishing, updating a public one, unpublishing, every moderation decision, reports and use-counting are `/api/templates` actions, so `importCount`, `official` and `visibility` can't be set from a console, rate limits and the pending cap can't be skipped, and every publish is re-validated server-side (rules can't validate the nested form).

**P23-3. A public template's update is a separate pending version.** The approved version stays readable and usable until the platform owner approves the new one (which then replaces it and bumps `version`) or rejects it (it's discarded and the public version is untouched). The author can't edit a public template directly: they unpublish it (back to private) or send an update.

**P23-4. "Official" belongs to the platform owner.** It can't be set on create or edit (rules), only by `set-official` / `seed-official` (server, platform owner), and a take-down clears it. Official templates are owned by the platform owner's account and shown under the author name "CompEpicurus". Seeding again changes nothing unless the code-defined content (its checksum) changed; then it adds a version, so accounts that used it see "Update available".

**P23-5. The Blank starter has scoring off.** A form that scores but has nothing scoring can't be published, so the starter turns scoring off and says so; turn it on in Form settings when you add points.

**P23-6. Uses are counted once per account.** The first time an account uses a public template (including by updating from it) its count goes up by one; using it again doesn't, and the author's own use doesn't count. The counter is a server transaction with a per-account marker (`imports/{teamId}`), so a browser can't inflate it.

**P23-7. Text is cleaned, links are https only.** Templates and imported files have HTML tags stripped (and it's said so), and any `http://`, `javascript:`, `data:`, `mailto:` or similar link in any text is refused rather than rewritten. A bare "<" in text ("under < 5") is not HTML and is kept.

**P23-8. Checksum mismatch is a warning.** A hand-edited export legitimately doesn't match, and a checksum anyone can recompute isn't a signature, so a mismatch warns in the import preview and never blocks (the file still has to pass the strict parse, sanitizing and `checkForm`). A *stored* template whose checksum doesn't match its form is refused for publishing and for use.

**P23-9. Import is two steps.** "Check file" parses and validates the text and shows what would be created; nothing is saved until "Create form". "Fix automatically" appears only when the sole errors are duplicate ids or keys, and renames the later duplicate; it never touches anything else.

**P23-10. Update available compares your form with the new template version**, not old template with new: the old template snapshot isn't kept. The dialog's diff is what the new version differs by from what you have, which is what you need to decide. Applying creates a new draft named "<your form> (vN)" and leaves your form, its versions and its entries alone.

**P23-11. Notifications.** Platform owners get a push (devices with notifications on) and an email (when email is configured) for each new publish request or public update; the Template Review tab lists the queue live and has no badge count. Authors are emailed each decision, with the reason.

**P23-12. Not built.** A count badge for the queue on the Admin tab or sidebar; a public "author's other templates" view; editing a template's form inside the builder (you update a template from a form instead); a "Seed official templates" deploy-time step (it's a button).

## P24 — Practice scouting workspace

**P24-0. Questions and defaults** (all as recommended): widths stored as shares of the workspace, on the user doc with a `localStorage` fallback; Focus mode also hides the app sidebar and Fullscreen takes the whole workspace; `F`, `C` and `Esc` as the shortcuts; side-by-side from 768px with the phone layout below; the comments drawer binds to the field with the `comments` role through `commentsMode`; a `fill` prop on the players; the browser tests run against a fixture page rather than the three real (signed-in) screens.

**P24-1. The three real screens aren't driven end to end by a browser test.** They need a signed-in account and Firestore. They are covered by the type check, by a unit test that each renders `<ScoutingWorkspace`, and by the fixture, which runs the same workspace and `ScoutForm` in the same two-robot flow and action bar. Check once by hand on a real session (see the report).

**P24-2. The drawer pushes the video aside instead of overlaying it** on tablet and desktop. The prompt says Trial's controls mustn't be covered by the drawer; an overlay would cover the right-hand controls of a YouTube player, so the video re-fits beside the drawer (it shrinks while the drawer is open). On phones the drawer is a sheet over the form area (the video stays visible above it), never over the action bar.

**P24-3. No rules change for the saved layout.** A member can already update their own non-role fields; the values are validated when read (a number strictly between 0 and 1, then clamped), so a hand-edited value can't break the layout. A value only this browser had is saved to the account once.

**P24-4. Focus mode is a tablet/desktop feature.** On phones the video's collapse-to-mini button does that job, `F` does nothing, and the sidebar and top bar stay (the top bar is sticky and small).

**P24-5. Fullscreen needs the browser to allow it** (`document.fullscreenEnabled`); where it doesn't (some iPhones) the button isn't shown. Dialogs and dropdowns opened in fullscreen portal into the fullscreen element so they're visible.

**P24-6. A window shorter than 520px keeps its page scroll.** Locking the page there would clip the workspace; the workspace's minimum height is 420px.

**P24-7. Live and lobby comments are labelled `Robot: #1234`** (they have one robot); the solo screen's are `Robot 1: #1234` / `Robot 2: #5678` and cleared for each robot. The comments text is the form's `comments` value, so it's saved with the entry exactly like the old inline field, including the Live and lobby entries.

**P24-8. The form hides the comments field only when it can be edited elsewhere.** `commentsMode="popout"` without `onCommentsChange`, or a form with no `comments`-role field, shows the field inline as before.

**P24-9. Not built.** Remembering the focus/mini state between sessions (the layout widths are remembered, the modes are per visit); a separate layout for tablet portrait (it uses the side-by-side layout at 768px and up, with the form at its 320px minimum or more).

## P25 — Member profiles

**P25-0. Questions and defaults** (all as recommended): the avatar is saved on the profile and mirrored on the user doc; `visibility` stores the preference and the effective value is computed (admin or owner => public); admins can clear bio and pronouns of non-owner members, each clear is audited; `displayName` is profile-only;
"Joined" comes from the user doc's `createdAt` and "Last active" is computed from sessions and entries (no new writes); the accuracy rows reuse `computeScoutStats`; the streak is consecutive local-time days; the badges are one config list; the pages are `/people/:uid` and `/profile`, with "Privacy and profile" as a section of Account Settings.

**P25-1. "Public" means public to the member's own team.** Nothing here is readable outside the account (the rules require the same team), and nothing is indexable.

**P25-2. A non-admin teammate looking at a private profile gets "permission denied" from Firestore, and the page shows that as the limited card.** The limited card (picture, account name, primary role, "This profile is private") is built from the user doc, which every teammate can already read. It deliberately shows the **account name**, not the profile's display name,
because the display name lives in the profile doc they can't read. The activity section is not mounted for them.

**P25-3. The honest limits (also stated in Settings).** Private covers the profile page and its own text (display name, bio, pronouns). It does **not** hide anything the team already shares: a private member's entries, practice sessions, accuracy and rank still show in Analytics, Scout Accuracy, Scout Status, Assignments, the leaderboards
and the Team Management / People lists (name, email, roles), and admins can always see the profile. Making that data private would change how scouting works for the whole team, which this prompt doesn't do.

**P25-4. Admins and the owner are always public.** The toggle is disabled with an explanation and the rules refuse a change. Their saved preference is kept (a first save as an admin is `public`), so a demotion restores it with no write. If someone is promoted while private, their profile is visible at once (the rules read the target's admin flag).
`DEFAULT_PROFILE_VISIBILITY` is read by the UI; the rules' "first save as an admin is public" and "no profile yet is readable" are fixed, so change the constant and re-check the rules together if you ever make the default private.

**P25-5. Admins can only clear.** The rule allows an update that sets `bio` and `pronouns` to `''` and changes nothing else (`displayName` and `avatar` are not moderated; the prompt names only bio and pronouns). The owner's profile can only be edited by the owner. A rule can't prove the audit entry exists, so the client writes both in one batch.

**P25-6. Google pictures are limited to `https://lh*.googleusercontent.com`.** The rules and the UI both check it, so a profile can't point at an arbitrary URL (a tracking pixel). The image is loaded with `referrerPolicy="no-referrer"` and falls back to initials if it fails. The Google option appears only for a member signed in with Google.

**P25-7. Text is sanitized on save and rendered as text.** HTML tags and control characters are stripped, blank-line runs collapsed and the length capped (280 / 30 / 40); the rules cap the lengths too. The page shows it with `whitespace-pre-wrap` as plain text; links aren't made clickable.

**P25-8. Target completion at the current event is a simple version of Scout Status.** It uses the primary active event, and the member's manual targets (summed over categories) if an admin set any, else the number of distinct matches Assignments gives them, against the number of Real Event entries they've scouted there (excluded ones left out).
Scout Status's per-category match ranges and category switches are not re-applied (a profile has no controls for them), so the figure can differ from Scout Status when ranges are set. It is hidden when the member isn't part of that event (not attending, no entries, no target).

**P25-9. Streak and activity.** A "day" is the viewer's local calendar day; the streak is alive if the last practice day is today or yesterday. It counts completed solo Trial/Competitive sessions (the same sessions the accuracy cards count, including excluded ones: excluded sessions still count as practice done). "Last active" is the latest of the member's session
end times and entry times (not logins). "Joined" is hidden for accounts whose user doc has no `createdAt`.

**P25-10. A rule change on `users`.** A member's own update now validates `avatar`, and the admin role-edit rule requires `avatar` to be unchanged, so an admin can't set or clear someone's picture. Nothing else about those rules changed.

**P25-11. Where pictures show.** The profile pages, Settings, the sidebar, People, Team Management rows and the member editor. The leaderboards, the credits board and the assignments picker keep the initials discs (they work from data that doesn't carry the avatar); say if you want them upgraded.

**P25-12. Not built.** Notifications, per-field privacy (only the whole profile), blocking individual teammates, a profile search, editing a profile on someone's behalf, and a way for a teammate to report a profile.

## FIX4 — Profiles, Credits, Active Events, and the Match List

**FIX4-0. No clarifying questions were asked.** The prompt said to ask only if something truly blocked me, and the work was not blocked. (This batch of four prompts was run while the user was away, so for P26-P28 the same applies: defaults were taken and logged.)

### 1. Profiles: public/private

**FIX4-1. Root cause: I could NOT reproduce a rules or logic failure, so the fixes below are for the causes I could actually find.** I ran the exact batch Settings writes (`saveOwnProfile`: the profile plus the `users/{uid}.avatar` mirror) against the real rules in the emulator as a non-admin member, an admin and the owner, in every state (first save, public to private, private back to public, reads by self, teammate, admin, owner). All of it passes: the rules already do what the prompt asks (a profile's owner always reads and edits it; admins always read; a teammate is refused when private; admins and the owner are forced public). So the symptom must come from the wiring around the rules. Causes found and fixed:
1. **The choice only took effect after a second, easy-to-miss "Save profile" press**, with no feedback on the toggle itself, so it read as "the setting can't be changed". Public/Private now **saves the moment it is chosen** (own write, using the stored text so half-typed text is never saved by accident), with a confirmation line ("Your profile is now private."), or an error that puts the choice back. The rest of the form still saves with its button, and the visibility change no longer restarts the form (the form key no longer includes visibility), so typed-but-unsaved text survives.
2. **A refused read of your OWN profile showed the limited "private" card to its owner** (`denied` applied to everyone). Your own profile is now always shown in full; if the read itself was refused (which only happens when the deployed rules lack the P25 `profiles` rules, i.e. rules weren't deployed) it says so in a note and tells you what to check.
3. **A denied listener never recovered.** Firestore ends a listener for good once the rules refuse it, so a teammate looking at a profile that went private and then public again stayed on the limited card until a reload (the old comment claimed otherwise). `useProfile` now re-opens a refused listener every 20 s (`DENIED_RETRY_MS`).
4. Checked and **not** the cause: a forced-public flag applied too broadly (`isAdmin` is only the user's own flag), the Settings control and the profile page reading different documents (both `profiles/{uid}`), a stale cache (the key includes uid and team).
**If your real symptom was a "Couldn't save your profile" error, the most likely cause is that the P25 rules were never deployed to Firebase** (a never-deployed `profiles` rule denies every read and write for everyone). Deploy them: `firebase deploy --only firestore:rules`. The new messages say this.
**FIX4-2. Tests.** `firestore.rules.test.ts` "FIX4: profile visibility, every viewer x every state" (the batch as the app writes it, all three kinds of member, the read matrix); `e2e/profiles.e2e.ts` (a non-admin flips public to private to public and each choice saves at once; a failed save puts the choice back; the typed text survives; you always see your own full profile, also when the read is refused; a teammate with a refused read still gets the limited card).

### 2. Credits

**FIX4-3. Root cause.** In the current code the page never rendered an editor-only branch (`CreditsBoard` always rendered the content for admins and members alike), so "credits only visible in edit mode" is not something I could reproduce; the "perpetually in edit mode" feel was FIX3's choice to show the admin controls permanently. `CreditsBoard` now takes `editing` (default off) and only shows controls when the user is an admin **and** `editing` is on; the normal view is identical markup for admins and members (a test compares the two renders byte for byte).
**FIX4-4. Edit mode.** An **Edit credits** button (admins only; members get no button at all) switches to edit mode and **Done** leaves it. It is plain in-memory state: off on every visit and reload, never stored, never entered automatically. Every credits change is saved the moment it is made (one transaction, as before), so "unsaved changes" means a change still being written: **Done asks first (and closing the tab warns) only while one is in flight.** In-app navigation can't be intercepted in the App Router, but edit mode doesn't survive leaving anyway. The "this is the starter list" note now shows only in edit mode.

### 3. Active Events

**FIX4-5. The order is the primary.** `primaryCode` is always the first event: every function in `lib/active-events.ts` returns a state that holds this (`moveActiveEvent`, `reorderActiveEvents`; the star is `moveActiveEvent(…, 0)`); `readActiveEvents` reads a team saved with the primary in the middle with it moved to the front (nothing to migrate: the next admin change writes it that way); `buildActiveEventsFields` writes `activeEventCodes[0] === activeEventCode`. **A rules change:** `validActiveEvents()` now requires `activeEventCodes[0] == activeEventCode` (the old rule only required the primary to be in the list), so the invariant can't be broken by any client; the existing rules tests were updated and one added. Pickers and switchers already used `orderPrimaryFirst()`, which is now simply the stored order.
**FIX4-6. UI.** Drag by the grip (mouse, press-and-hold on touch, keyboard Space/arrows), plus move up/down buttons and the star; dragging another event to the first place makes it primary, with a polite "X is now the primary event" note. Admins only (the rules only let admins write the team doc, as before). With reorder controls the list is one column below the `lg` breakpoint and two above (to fit the controls at 36 px touch targets); members see the previous layout. The condensed bar shows the **event code for every event** with the full name as a `title` tooltip and in the expanded popover, as before; nothing about the zero-height sticky slot changed, and an e2e test checks nothing below moves.

### 4. Match List

**FIX4-7. Statuses.** The FIRST API gives `played` and a scheduled start, not "in progress". **Completed** = played. Within a tab, the first unplayed match whose scheduled start has passed by at most 15 minutes (`IN_PROGRESS_WINDOW_MS`) is **In Progress**; every other unplayed match is **Upcoming** (including ones the schedule has slipped past: they are still ahead). The **next upcoming** match is the first Upcoming one **in each event and tab** (the match after the one on the field, when there is one), marked "Next" and scrolled to when a view opens (first load, a new event or tab, never on a refresh or a filter).
**FIX4-8. Tabs.** Practice, Qualifications and Playoffs; playoff rows use the Scout Status classifier's `SF5` / `F14` labels. The page opens on the tab holding the event's next match, else the latest phase with matches. **All events** shows one group per event (in active-event order, primary first), each with its own next match.
**FIX4-9. Data and refresh.** It reuses `useEventMatches` (the shared 3-minute schedule cache); I added `updatedAt`, `refreshing` and `refresh()` to it (the old data stays on screen while it reloads, and a failed refresh keeps the last good list, flagged as failed). The open page asks again every 3 minutes while the tab is visible; the manual button forces it (the server-side 3-minute de-dupe in `lib/ftc/http.ts` can still answer a press within a few minutes of the last fetch from its own cache; I left that alone). "Our" teams are all of the account's FTC teams (P19, `useIsOurTeam`). Completed matches link to `/analytics/match-breakdown?event=…&match=Q12` (playoff matches use the `F` prefix Match Breakdown understands).
**FIX4-10. Registration.** There is no `PAGES` registry yet (that is P26): for now Match List is in the sidebar nav (`lib/nav.ts`) and the shell's `REALIZED_PAGES` list. P26 registers it as an **open** page. Nothing gates it.
**FIX4-11. Tests.** `lib/match-list/model.test.ts` (labels, ours, status, next, tabs, filters, time zones), `e2e/match-list.e2e.ts` (fixture `/e2e/match-list`: scroll to next, highlights, tabs, filters, search, event switcher, refresh and last-updated, error notice, skeletons without layout shift, empty state, phone layout), `e2e/event-panel.e2e.ts` (fixture `/e2e/event-panel`), `components/credits/credits-board.test.tsx`, `lib/active-events.test.ts`.

## P26 — Page access and role gating

**P26-0. No clarifying questions were asked.** The user was away; the prompt's defaults were taken and are logged here.

**P26-1. The registry** is `lib/page-access/pages.ts` (`PAGES`: id, title, routes, `access: open | restricted | admin`, default roles). A path belongs to the page whose route is its longest match, so `/analytics/scout-status` is the restricted Scout Status while every other `/analytics/*` is the open Analytics. `People` owns `/people` and `/profile` (member profiles). **Routes no page owns are never gated** (Team Settings, login, the e2e fixtures): the prompt didn't list Team Settings, and it already limits itself to admins in its own page. The six new forms are registered at `/lead-scout-form`, `/pit-scout-form`, `/team-strategy-form`, `/match-strategy-form`, `/drive-reflection-form`, `/helper-form` even though they don't exist yet (P28/P29 build them at those routes); registering a page with no route yet costs nothing.
**P26-2. `canAccessPage(user, pageId, config)`** (`lib/page-access/access.ts`, pure, tested) is the one decision: admin or owner yes; an open page yes; an admin-only page no; a restricted page when one of the person's roles (primary or secondary) has it, or they have an explicit grant, **minus** an explicit deny (a deny beats a grant; an admin is never denied). `explainAccess` returns the reason for the Admin Panel ("Role: Lead Scout", "Extra page granted", "Closed by an override"). The nav (`visibleNav`), the route guard (`PageGuard`), `usePermissions` and the Preview all call it; `pageAccessAllowed()` in `firestore.rules` is its twin for gated writes.
**P26-3. Data.** `teams/{teamId}/settings/pageAccess` = `{ roleGrants: { [role]: pageId[] }, memberOverrides: { [uid]: { grant, deny } }, pageRoles, updatedBy, updatedAt }`. **`pageRoles` is an addition to the prompt's shape**: a mirror of `roleGrants` the other way round (page id to the roles that have it), because security rules can't loop over a map or a list, so "one of my roles is in `pageRoles[pageId]`" is the only way to ask it. It is always written together with `roleGrants` (`pageAccessDocData`) and is complete for every restricted page; the rules can't verify the two agree (only admins write the doc, and one function builds both). Requests: `teams/{teamId}/pageAccessRequests/{uid}_{pageId}` = `{ teamId, uid, name, pageId, pageTitle, status: pending | approved | denied, createdAt, decidedBy?, decidedAt? }`.
**P26-4. Migration and failure modes.** There is no batch migration: with no doc, **everything reads as the defaults** (pure code and the rules' per-call-site default roles), so nothing breaks before the doc exists; the first admin session that finds no doc writes the defaults in a transaction (idempotent, `ensurePageAccessDoc`). A role missing from a stored doc gets its defaults (adding a role later never locks it out); unknown page ids are dropped when reading. **If the doc can't be read** (rules not deployed yet, offline with no cache) the client falls back to the defaults rather than locking everyone out of the app; the rules still decide every write. **Existing admins and the owner keep full access** (admin is checked first, in code and in rules).
**P26-5. What the rules gate.** Create/update of **`assignments`**, **`eventAttendance`** (the Assignments page's attendance list) and **`scoutTargets`** (Scout Status) now require page access (`assignments` and `scout-status`), where it used to be admin-only (assignments, attendance) and admins plus Lead Scouts (targets). So **Team Coaches can now edit Scout Status targets** (they can open the page by default) and Lead Scouts can generate and publish assignments; an admin can change both with the matrix. `usePermissions().can("editScoutTargets" | "editAssignments")` follow the same check, so a control the UI shows is one the rules accept. The old `canEditScoutTargets()` helper and the rules function of the same name are now unused (kept for their tests). **Gated forms and their entries (`formEntries`) don't exist yet**: the helper is ready for P27 to use (`pageAccessAllowed('<page-id>', [<default roles>])`). Not changed: Forms (admin-only by `canManageMembers()` already), the team doc (Event Selection stays admin-write: roles that can open the page see it read-only, as before for members), member editing (admin-only, FIX2).
**P26-6. What is gated only in the UI, honestly.** Pages whose underlying data every team member can read are gated in the **navigation and the route guard, not by rules**, because other pages need the same data: **Scout Accuracy** (the leaderboards, profile cards and My Scouting read the same sessions and entries), **Scout Status** (reading; the targets writes ARE gated), **Event Selection** (the active events drive every picker), **Team Management** (the roster feeds People and every picker), and **Assignments** (reading; My Scouting and the Match Scout Form need the schedule). Someone who knows the Firestore paths can still read that data with their own signed-in browser: this is a "who sees which page" control, not a secrecy boundary for team-internal data. The route guard is client-side like the rest of the app (no server middleware).
**P26-7. Admin Panel > Page Access** has three tabs: **Requests** (pending first with Approve, which adds an explicit grant, and Deny; a count on the tab; the last few decided), **Roles** (the matrix: restricted pages by roles, a sticky solid first column, scrolls sideways on phones, saves as you tick), **Members** (pick a member: per page Follow roles / Grant / Deny with where each page's access comes from, plus **Preview as member**: the navigation they'd see and the pages they can open, computed by the same functions). It is a data preview, not impersonation: the Admin Panel stays your own. Team Management gets a per-member **Page access** button (admins) that opens the same editor in a dialog. An admin or owner row shows a note instead (they can always open everything). Every edit is a transaction on the latest stored doc (so two admins compose) with an `edit-page-access` audit entry; deciding a request writes `decide-page-access-request`.
**P26-8. Request access.** One request per person and page (id `{uid}_{pageId}`); only **restricted** pages can be requested (an admin-only page shows no button). Re-asking after a denial is allowed; a pending one can't be re-sent. Approval = a grant for that member (an existing deny on the page is lifted). The person is told to reload after an approval (the access doc is live, so it normally works at once).
**P26-9. Nav.** Hidden: restricted and admin pages the person can't open (the sidebar, which is also the mobile menu). The old rule that hid Admin Panel from non-admins is kept (same outcome through the registry). Dashboards still link to some restricted pages for some roles; those links land on the no-access screen with its Request button.
**P26-10. Changelog.** Two **draft** entries were added to the starter drafts (seeded as drafts the next time an admin opens the Changelog; nothing is published): "Match List, reorderable events, and fixes" (FIX4) and **"Page access" (P26)**, written for you to review. The Changelog only has the types New / Improved / Fixed / Removed, so the "who can open what" changes are labelled Improved.
**P26-11. Tests.** `lib/page-access/access.test.ts` (registry contents exactly as listed, path mapping, every role against every default, secondary roles, grants, denies, admin, open pages, editing, parsing, the `pageRoles` mirror, nav hiding); `firestore.rules.test.ts` "P26: page access in the rules" (the gated writes for admin/owner/primary/secondary/other roles with no doc, with the defaults, with a changed matrix, grants and denies; the doc and requests rules); `components/page-access/page-guard.test.tsx` (the guard for direct URLs); `e2e/page-access.e2e.ts` (the matrix, overrides with sources, preview, requests approve/deny, the no-access flow, phone widths).

## P27 — Form system extensions for the new forms

**P27-0. No clarifying questions were asked** (the user was away). A subagent built the Vercel Blob plumbing (`lib/blob/*`, `lib/server/blob-auth.ts`, `app/api/blob/*`); I reviewed its tests and wired it into the form.

**P27-1. Form types and the system fields.** `FormType` is now `match-scout | lead-scout | pit-scout | team-strategy | match-strategy | drive-reflection | helper | custom` (`FORM_TYPES`), and `REQUIRED_SYSTEM_FIELDS[formType]` says which pickers each must carry once, in Pre-Match, always required (match-scout: match, team, scout as before; lead-scout / match-strategy / drive-reflection: event, match, alliance, scout; pit-scout / team-strategy: event, team, scout; helper: event, scout; custom: none). New system types `eventPicker` (key `eventCode`) and `alliancePicker` (key `alliance`). **A system field is now "a picker of a system type under its fixed key"** (`isSystemField` in `lib/forms/types.ts`): a `teamPicker` under any other key is an ordinary, deletable field, which is what the per-team box needs (`checkForm`: `team-picker-key` if it sits outside a per-team group). The prompt's "teamPicker inside the box so the team can be changed" and "system field the builder can place but not delete" are both satisfied this way. The builder's palette has a **Pickers** section (adds a missing system picker to Pre-Match; a team picker into the selected category's per-team group); `setFormType` adds the pickers the new type needs and never removes any. A blank form of a type other than match-scout has scoring off.
**P27-2. New field types.** `slider` (integer `min`/`max`/`step`, optional `ticks`, `endLabels`; native range input with a 32 px thumb; **never scores**: unscored in every mode), `image` (`maxCount` 1-10, `capture`), `sequence` (`steps[]` catalog: `maxCount` 1 or 0 = unlimited, `pin` first/last/none), `matrix` (`rows`, `cols`, `disabledCells`). **Values are wider now**: `FormValue = FieldValue | string[] | Record<string, boolean> | ImageValue[]` (`FormValues` maps keys to it). `entryValues()` used to drop everything but primitives and now keeps lists and maps (a latent bug the new types exposed; covered by the CSV round-trip test). Matrix values are stored as one map under the field's key (`{ "leave_auto": true, ... }`, every offered cell present), not as separate top-level keys: the prompt says "one boolean per cell keyed row_col", and keying them under the field avoids two grids colliding. Analytics and CSV still get one column per cell. A step "pinned" must be once-only, at most one first and one last (`checkForm`).
**P27-3. Per-team repeating groups.** A `FormGroup` may have `repeat: { source: "allianceTeams", maxSlots }` (1-4). Its fields are stored per slot (`t1_notes`, `t2_notes`...; `lib/forms/repeat.ts`), generated for analytics and CSV per slot, validated for the slots actually shown (`validateValues(..., { slotCount })`), and follow `keyAliases`. The renderer draws `min(alliance size, maxSlots)` boxes: **2 in a qualification, up to 3 in the playoffs, from the schedule** (2 until an alliance is chosen). Fields in such a group can't score, be conditional, carry stat roles or collide with a slot key, and the form needs an alliance picker (`checkForm`). The schedule fills each box's team picker until the person corrects it (their change is kept).
**P27-4. Sticky notes setting** (`form.stickyNotes: { enabled, defaultOpen }`, builder toggle, `StickyNote` shape `{ id, text, color, createdAt, pinned? }` on entries). The **summary `comments` is derived** by `derivedComments`: the form's comments field text and the notes' text joined with " | ", exactly the old value when there are no notes (BIOBUZZ regression suite unchanged). A **Notes** analytics/CSV column (type `notes`, derived: exported, never imported). The panel itself is P28.
**P27-5. Plan versus actual** (`form.compareWith: { formId, matchOn, fieldMap }`, `lib/forms/compare.ts`). The latest entry of `formId` that agrees on every `matchOn` part is the plan; mapped fields prefill unless the person edited them (and **follow a plan that changes while the form is open**); a caution icon with "Planned: Hive" sits beside each differing answer, with a summary ("2 differences from plan"); `linkedEntryId` and a `planDifferences` count are stored on the entry and shown as an analytics column. A field in a per-team group maps for every slot automatically (`role` -> `t1_role`, `t2_role`...; the plan form is assumed to use the same slot keys). A key the plan never answered is not a difference. The plan lookup itself (which entries to search) is the page's (P28).
**P27-6. Analytics and CSV.** `buildGameSchema` derives: slider = a number column; sequence = a summary column ("Start → Hive → Park", imported back by label) plus a count column per step (derived); matrix = a yes/no column per offered cell; image = a gallery column (URLs joined " | ", imported back as URLs without size/path) plus a photo-count column; slots = one column per slot ("Notes (team 1)"). Columns carry `valueKey`, `parseCell` and `derived`. CSV **import still requires the Match / Team / Scout columns**, so it stays a match-scout feature; for the other forms the same columns export (non-match forms use `formEntryToRow`, which presents a `FormEntry` as the row the table and CSV already read: `scored: false`, no accuracy). The Match Analytics table draws the `photos` column as up to three thumbnails (each opens the photo) with a +N, and `notes` collapsed to one line like Comments.
**P27-7. Photos.** `image` fields upload to Vercel Blob (client uploads): compressed in the browser (1600 px, JPEG 0.82, EXIF fixed; a file the browser can't decode is sent as is when it is an allowed type under 6 MB), queued in IndexedDB (survive a reload and bad Wi-Fi, retry with backoff and when the network returns), and shown as Waiting / Uploading / Failed (tap to retry) / done. A path is `kind/teamId/eventCode/teamNumber/{uidTag}-{random}.jpg`: the uid tag (a hash) is what lets "uploader or admin only" deletes work with no database. The server route checks the Firebase ID token, the caller's team, that the path matches the request, and `canAccessPage` for the form's page (`pageIdForForm`: the six built-in form ids map to their pages; any other form id is treated as the open Match Scout Form page). **A submit never waits for a photo**: `PhotoUploadProvider.attachWhenDone(queueIds, entryPath, fieldKey)` attaches a finished photo to the saved entry (`arrayUnion` on `values.<key>`), remembered across reloads. A photo uploaded in the current visit and removed is deleted from storage at once; deleting a photo of an already-saved entry, or a deleted entry's photos, needs the caller to use `deleteUploaded` (the page code in P29; not wired to entry deletion yet). Setup: `docs/DEPLOYMENT.md` section 13 (the store must be created **public**; blob URLs are public but unguessable).
**P27-8. `formEntries/{entryId}`.** Fields as in the prompt (`teamId`, `uid`, `scoutName`, `formId`, `formVersion`, `formType`, `eventCode`, optional `matchKey` ("Q12"), `alliance`, `teamNumber`, `values`, `stickyNotes`, `linkedEntryId`, `planDifferences`, `flags`, `excluded`, timestamps). **Rules:** every teammate reads; **create** needs the form type's page access (P26's `pageAccessAllowed`: lead-scout, pit-scout, team-strategy, match-strategy, drive-reflection, helper; `custom` is open to the team), as yourself, in your team, with a strict shape and server timestamps; **update**: an admin may edit but never change who/where/what form/when, and the **writer may change only `values`, `stickyNotes` and `updatedAt`** (that is how a late photo is attached; the prompt said owners read and admins edit, this one extra is needed for photos and note edits); **delete: admins only**. Two composite indexes added. `useFormEntries` sorts newest first on the client.
**P27-9. The generic renderer** `components/forms/form-renderer.tsx` (`FormRenderer`) draws a non-match form (sections, the new controls, the event / alliance / team / scout pickers, per-team boxes, plan marks); the **match picker is a slot** (`renderMatchPicker`) the page fills with the existing picker (P28). `ScoutForm` still renders match-scout forms; both use the shared `RenderedField`. The builder's Preview uses `FormRenderer` with sample events and teams for non-match forms. New builder controls: palette entries for every new type, inspector sections (slider, photos, step list, grid rows/columns/cells), per-group "one box per team", form settings (form type, sticky notes, plan versus actual).
**P27-10. Not done / limits.** The sticky notes panel (P28). Deleting a saved entry's photos from storage. CSV import for the non-match forms. Per-slot matrices and photos are exported per slot but the builder offers a per-team group only with ordinary fields in the tests. The Next.js dev server prints a harmless one-off hydration warning when a form is built with random ids on the server and in the browser; the e2e fixture seeds its ids.
**P27-11. Tests.** `lib/forms/p27.test.ts` (types and required pickers, slider, sequence rules, matrix, photos, repeating groups with 2 and 3 team alliances, slot aliases, plan comparison, sticky-note comments, analytics columns and a CSV round trip, portable export/import of every new setting, non-scoring forms), `lib/form-entries.test.ts`, the blob suites (`lib/blob/*.test.ts`, `lib/server/blob-auth.test.ts`: unauthenticated is the route's 401; wrong type, oversize, wrong team, wrong path, someone else's tag, a page the role can't open, grants and denies, admin), `firestore.rules.test.ts` "P27: formEntries" (15), `e2e/form-renderer.e2e.ts` (fixture `/e2e/form-renderer`).

## Commands to run locally

```bash
# Install the Firebase CLI if you haven't already
npm install -g firebase-tools

# Pure-logic unit tests (scoring, accuracy, auto-flags) — already run and passing
npm run test

# Firestore security rules AND API route tests — requires a JVM + the
# Firebase CLI (both Auth and Firestore emulators), neither available in
# the sandboxed environment this was built in
npm run test:rules

# Once your Firebase project's config AND a FIREBASE_ADMIN_* service account
# are in .env.local (see .env.example and docs/DEPLOYMENT.md):
npm run dev
# then walk through: Signup (password) with "Create a team" -> copy the
# join code -> sign up a second account with "Join a team" and that code ->
# log out, log back in with "Continue with Google" on a third email -> land
# on Finish Setup, join the same team -> Account Settings: Link Google on
# the first (password) account, confirm "Sign-in methods" shows both ->
# Team Management role/admin edits (including the last-admin block) ->
# if OWNER_EMAILS/ADMIN_EMAILS are set, confirm that email becomes
# owner/admin only after clicking the verification email's link, and that
# its Team Management row shows locked controls -> Admin Panel's "Allow
# team creation" switch (owner only) -> Event Selection as admin vs.
# non-admin (this now also exercises the session-cookie auth proxy — Event
# Selection calls getEvents() under the hood) -> Scout Form submit -> Match
# Analytics -> toggle devtools network throttling to "Offline" and confirm
# the nav shows "N pending sync", then back online and confirm it clears.
#
# Without FIREBASE_ADMIN_* configured, Event Selection (and anything else
# calling the FIRST API) will show "Sign in to view FIRST API data." even
# while logged in — that's lib/server/require-user.ts failing closed because
# there's no Admin SDK to verify the session cookie against. Expected until
# those three env vars are set.
#
# P3: as an admin, go to Admin Panel > Match Library, enter USWABON1 (BIOBUZZ
# season), click Import — confirm it reports "Rookie Rumble: imported 24
# matches, skipped 0" (no playoffs exist for this event) and the table shows
# each match's score + difficulty pill with no video. Try the "Refresh
# scores" button and confirm it doesn't duplicate rows. Try the bulk CSV
# button with a `matchKey,url,startSec,endSec` file (matchKey values look
# like `USWABON1_Q1`) and confirm the matching rows pick up a video. Flip
# "Use placeholder video for testing" and confirm MockVideoPlayer's
# play/pause/timeline work if you wire it into a test page (no scout-facing
# page renders <VideoPlayer/> yet — that's P4).

# P4: go to Practice Scouting -> pick BIOBUZZ -> Trial -> Easy (or whatever
# difficulty USWABON1's imported matches landed in) -> pick a match (video or
# placeholder) -> Start -> scout Team A -> Next Robot -> Break Menu: try
# "Continue to Team B" (saves Team A's entry, resets the video, moves to
# Team B) -> finish Team B -> Results screen shows accuracy/comparison vs.
# the real official score. Re-open the same match in Match Select and
# confirm it now shows "Scouted · by you". Start a second session, get past
# robot 1, and in the Break Menu choose "Pause Session" — confirm you land
# back on the Practice Scouting landing screen with a "Paused session"
# banner blocking a new Season Select, "Resume" picks back up at robot 2,
# "Discard" deletes it and the banner clears. Start a third session and use
# "Cancel"/"Change Match"/the Break Menu's "End Session" — confirm each
# discards with nothing saved and the match goes back to (or stays) "Fresh"
# in Match Select. Switch to Competitive mode and confirm the video has no
# visible pause/seek controls and ignores spacebar/arrow keys.

# P5: after a few completed practice sessions and at least one scored real
# event, go to Scout Accuracy -> Trial Mode -> confirm the leaderboard,
# summary stats, and your own row's rank. Toggle a role filter on -> confirm
# the table narrows and "Ranking basis" offers "Role Leaderboard"; switch to
# it and confirm ranks recompute to just the filtered scouts, then switch
# back to "Preserve original ranks" and confirm a visible scout's rank
# matches what it showed with no filter at all. Open View Details on a
# scout with a flagged session -> confirm Dismiss Flag / Exclude both work
# (admin only — confirm a non-admin signed-in user doesn't see Scout
# Accuracy's management controls at all, including on /my-scouting) and
# that an excluded session shows struck-through but stays counted in
# "Sessions completed." Try "Hard Reset Scout Data" on a test scout's Trial
# data -> confirm their completed Trial sessions (and entries) are gone and
# their Trial leaderboard row flips to "?". Switch to Real Event -> change
# the Calculation dropdown across All Events / {Event} / (Trial) / (
# Competitive) variants -> confirm numbers change plausibly and a scout with
# no real entries shows "?". Go to My Scouting -> confirm your own three
# cards' accuracy/rank match what Scout Accuracy shows under the same
# filters, and that no admin controls render anywhere on the page.

# P6: as an admin, go to Assignments -> pick the active event -> Attendance:
# select a handful of members, Save attendance -> confirm People now shows
# "Attending" on exactly those members. Schedule -> Randomize -> leave
# ranges blank, pick Qualification, try each rotation pattern, pick 5-6
# attending scouts -> Generate -> confirm the preview grid shows 4 scouts
# per match and per-scout totals differing by at most 1 (or a warning if
# not, for Custom Interval with an odd scout count) -> Save/Publish ->
# confirm "Undo to previous version" appears after publishing a second
# schedule, and restores the first. Click a cell to swap in a different
# scout -> confirm a warning appears if it double-books someone in that
# match or unbalances counts, but the swap still applies. Try "Prioritize
# teams" with only 4-5 scouts selected -> confirm only the prioritized
# teams' cells have names, every other cell is empty. Sign in as a
# non-admin -> confirm Assignments shows only a read-only "your
# assignments" list. Go to Match Scout Form as a scout with an assignment
# for the active event -> confirm the "Next assignment" banner shows and
# "Load this assignment" fills in the match/team -> submit -> confirm the
# banner advances to the next unscouted assignment. Go to My Scouting ->
# confirm "My upcoming assignments" lists the same scout's remaining slots.

# P7: on Practice Scouting's Difficulty screen, click Live -> paste a
# YouTube link (watch/live/youtu.be all work) -> confirm it either
# auto-suggests an event with "Yes, that's the event" or asks you to pick
# one from the season's event list -> pick/confirm a match number (it
# should suggest the next unplayed one) or enter the 4 teams manually if
# the match isn't posted yet -> pick your alliance/robot (if nobody else is
# live on this match you get a free choice of any of the 4; if a teammate
# already has one robot on an alliance, you're forced onto its partner) ->
# confirm the stream embeds (or shows "Open in new tab" for an
# unrecognized URL) and <ScoutForm mode="live"> renders beside it -> submit
# -> confirm the session moves to "completed" and a "waiting for scores"
# panel shows (since no real official match data exists yet in dev) with
# an "Enable notifications" button. From a second account, start a live
# session on the SAME match/alliance but don't pick a robot yet -> confirm
# the Practice Scouting landing page's Presence panel shows "join" and
# clicking it forces you onto the uncovered robot, skipping straight to the
# session screen. Back on the landing page, confirm "Pending robots" lists
# any alliance partner nobody ever scouted, with a working "Scout now".
# Open the top-of-app pill on another page while exactly one scout is live
# solo on a match -> confirm it shows and dismissing it hides it until the
# match composition changes. To exercise the scoring path without a real
# live event, manually edit a completed live session's two entries' + the
# event's matches in Firestore to simulate a posted official score, then
# call POST /api/live/check-scores signed in as that session's owner (or
# GET /api/cron/poll-live-scores with `Authorization: Bearer <CRON_SECRET>`)
# -> confirm both sessions get `accuracy` filled in, a `notifications/{id}`
# doc is created for each, and the Results screen (or the global "Scores
# are available" popup, if you're elsewhere in the app) shows the
# breakdown. Re-run the same poll call -> confirm nothing changes (no
# duplicate notification docs, no re-computation) — this is the
# idempotency check from P7-6.

# P8: on Practice Scouting, pick a season and mode, then click Live
# Practice Lobby -> Host a Lobby -> confirm the join code appears and a
# random match gets picked automatically (or try Pick Match, pick a target
# difficulty, and confirm the list is sorted both-matching-target first).
# From 3 other signed-in accounts, go to Practice Scouting's landing page
# and enter that join code under "Join Lobby" -> confirm all 4 show up in
# the host's player list in realtime. Toggle "I'm the video displayer" and
# "I'll scout too" -> confirm Start stays disabled with an odd/too-small
# player count and enables at 4+. Click Start -> confirm every player sees
# a countdown, then their own Team X reveal, the shared video (or just the
# form, if video-displayer is on and you're not the host), and a sticky
# Submit. Submit from 3 of the 4 -> confirm the 4th's submit auto-triggers
# results (or use the host's "End Scouting" to force it without everyone
# finishing) -> confirm the winning pair is highlighted, the rest are
# ranked, any non-finishing pair shows "Did not finish," and "View
# breakdown" shows each robot's own score vs. the official one. As host,
# click "Play Again" -> confirm it returns to the waiting room with a new
# match and the same players, and Start works again without stale
# "already submitted" state. Refresh one player's tab mid-round -> confirm
# they land back in the same spot (their own session, not a fresh one).
# Close the lobby -> confirm everyone sees "This lobby has been closed."

# P9: on Match Analytics, check "Practice Scouted Matches" -> confirm the
# banner appears, the table switches to practice/live entries with a
# Session ID column and a Practice/Live source badge, and Import CSV /
# Recalculate Accuracy disappear while Export CSV still works. Try the
# Mode/Source selects and the event chip row -> confirm the table narrows.
# Open Config on a practice row -> confirm "Stats Exclusion" now says
# "session" and toggling it changes that scout's Scout Accuracy average
# for that session (check My Scouting or Scout Accuracy afterward).
# Uncheck the toggle -> confirm the normal real-event view is unchanged.
#
# Go to Admin Panel -> confirm five tabs: Match Library (unchanged),
# Sessions, Rescore, Audit Log, Backups. Sessions: look up a known Session
# ID (from a practice/live/lobby run) -> confirm the detail dialog shows
# everything (scout, season, mode, match, alliance, robots, entries,
# accuracy breakdown, flags, platform, timestamps, lobby/pair info for a
# lobby session) -> dismiss a flag, toggle exclude, edit an entry's field
# values and confirm the score recalculates and the session's accuracy
# updates -> check Audit Log shows the edit with full before/after. Try
# browsing/filtering by scout, kind, and mode instead of searching by ID.
# Rescore -> Real Event Entries: enter your active event's code -> Preview
# Rescore -> confirm it reports how many entries would change -> Apply ->
# confirm Match Analytics reflects it. Rescore -> Practice/Live/Lobby
# Sessions: leave filters blank -> Preview Rescore -> confirm solo/lobby/
# live groups each show correctly, then Apply (watch the progress count)
# -> re-run Preview immediately after and confirm it now reports 0 changes
# (idempotent). Try "Refresh official scores" for a library event you've
# already imported -> confirm it reports an update, not a duplicate.
# Backups: click "Download All Data (JSON)" -> confirm a file downloads
# and "Last export" updates; click "Download Entries (CSV)" -> confirm
# that downloads too. Confirm every Rescore/Edit/Backup action you just
# took shows up correctly in the Audit Log tab's filters.

# FIX1: after `firebase deploy --only firestore:rules` (below) and a deploy of
# this branch: sign in as an admin and open Active Events -> the first admin
# visit silently migrates the team doc (activeEventCodes = [activeEventCode]).
# Tap two more events -> confirm both get the check animation + glow, the
# first stays starred, the Selected events panel lists them, and scrolling
# down swaps it for the condensed bar (tap it for the popover with remove
# buttons) with no content jump. Remove an event that already has scouted
# entries -> confirm the confirmation dialog. Open Match Scout Form -> confirm
# an Event pick appears (and disappears again with one event active).
# Team Management -> Edit a member -> change primary/secondary roles + admin
# -> Save -> confirm the glow, the realtime update in a second browser, and
# an "Edit Member Roles" row in Admin Panel > Audit Log. Confirm the owner row
# shows "Locked" and your own admin switch is disabled.
# Layout check: DevTools > Rendering > Layout Shift Regions, 6x CPU
# slowdown, click every sidebar entry -> no shift region at the top of the
# page content.
npm run test:rules   # needs Java + firebase-tools; includes the new FIX1 blocks

# P10 (no rules or env changes). Open Analytics > Team Averages as an admin:
# the filter bar should show Game, Events (default 'Active events (N)'),
# Practice, and the Accuracy ALL / 75% / 85% / 90% / Custom control with an
# info tooltip and 'N of M entries shown'. Pick 85% -> confirm the URL gains
# ?acc=85, N drops, then click Rankings / Match Scout Analytics / a team
# row and confirm the filters carry over (and Back restores them). Match
# Scout Analytics: no Accuracy control; Event becomes a single select; Import
# CSV / Recalculate still work. Custom: type 150 -> 100, 0 -> 1, letters
# ignored, max 3 digits. Toggle Practice -> Mode/Source appear and the event
# list shows library events. Click a team -> Team Profile: header, tiles,
# chart hover (and arrow keys), match list links, averages, comments. Open
# /analytics/teams/99999 -> 'No scouted data' empty state. Rankings: change
# 'Rank by', raise Min. entries -> low-sample teams drop below, unranked;
# click column headers -> rank numbers stay put. The official rank chip
# needs the live FIRST API (FTC_API_* set) — verify its field names there.

# P11 (no rules or env changes). Analytics > Match Breakdown with an active
# event that has played matches (needs FTC_API_* set): each match shows its
# label, a 'N/4 robots scouted' chip, red/blue totals, and an animated bar;
# unscouted matches are muted 'Not scouted'. Tap a match -> the drawer shows
# each robot's total, auto/teleop/endgame bar, element chips, incidents, the
# alliance totals, accuracy, and small 'Official 85 (incl. 10 penalty)' text;
# team numbers open Team Profile; 'View raw entries' opens Match Scout
# Analytics on that match. Choose Accuracy 90% -> any alliance below it is
# dimmed with 'Below accuracy filter (NN%)' and shows no scouted numbers;
# ALL shows everything. Toggle Practice -> the list switches to library
# matches. From a Team Profile, click a match row -> it opens already
# expanded. Analytics > Team Breakdown: card grid, search, sort, low-sample
# badge, reliability pill (hover for incident rates); cards open the profile.

# P12 (rules changed — deploy them first; no env changes). Analytics > Pick List
# with an active event (needs FTC_API_*): our team is pinned in the header card
# and absent from both lists; the filter bar's Event control is a single select
# (also with Practice on). Before qualification matches: O. Rank / Pick % are
# '-' with a gentle note. Once ranked: Available lists in official-rank order;
# sort by each column; search a number or name. Drag a team from Available to
# Picked (grip handle), reorder within Picked, drag one back to Available to
# remove it; also use Add / Move up / Move down / Remove. On a phone width the
# columns become Available / Picked (n) tabs. Open the page in two browsers as
# two editors: changes appear live, 'Last edited by X' pulses, and adding
# different teams at the same moment keeps both. Sign in as a plain Match
# Scout: the board is view-only. Columns > EPA Off hides the column and it
# stays off after a reload. Reset list asks first. Admin Panel > Audit Log shows
# 'Edit Pick List' entries. Raise the Accuracy filter -> S. Rank / S. Avg /
# S. High change, O. columns do not.
firebase deploy --only firestore:rules   # pickLists rules + the auditLog carve-out
npm run test:rules   # needs Java + firebase-tools; 114 rules tests incl. the P12 ones

# P13 (no rules or env changes). Dashboard as each kind of user:
# - A Match Scout with an assignment: 'My next assignment' -> Scout now opens
#   the Match Scout Form with that match + robot already loaded.
# - Header strip (every role): event + status, our official rank and record,
#   and our next match with 'Scheduled <time>', alliance color, and partner.
#   CHECK the countdown against the real schedule at an event (needs FTC_API_*):
#   the API's start time is read as event-local time — verify it isn't off by
#   the viewer's timezone.
# - Set two active events -> an event select appears in the strip; clear all
#   active events -> a friendly empty state (admins: 'Go to Active Events').
# - A user with a secondary role gets a segmented role control (the last choice
#   is remembered); an admin also gets 'View as role' + the Admin strip (last
#   backup, flagged practice sessions, team creation On/Off).
# - Pit Scout / Judge Awards / Media each show one 'Coming soon' card.
# - Open the dashboard with throttled network: every card is a skeleton the
#   same size as its content (no layout shift).

# P14 (rules changed — deploy them first; no env changes, no new indexes).
# As an admin, open Changelog: five starter entries appear as dashed 'Draft'
# cards (once — reload and delete one, they don't come back). Publish a couple
# with the eye button; Pin one; Edit one (change rows, move up/down, a link
# like [docs](https://example.com), try http:// and javascript: and confirm the
# editor refuses to save them); Delete one — the confirmation names it. Sign in
# as a plain member in another browser: only published entries show, no admin
# buttons, no drafts; the Changelog nav item shows a dot until the page is
# opened, then it clears; publish another entry as the admin and confirm the dot
# comes back on the member. Try the type chips (counts), search ('docs' finds
# link text), Expand all / Collapse all; the newest two start open. Throttle the
# network: skeleton cards of a steady size, no jump. Admin Panel > Audit Log
# shows Create/Edit/Delete Changelog Entry. Credits: as admin, the starter list
# shows with a note; add a section, rename it, add credits (name, description
# with a link, https link, https image URL — try http:// and confirm it's
# refused), drag sections and credits by the grip, use the up/down buttons, delete
# one (named confirmation), collapse a section. Reload: your version is saved.
# As a member: the same page, read-only. Footer links (Credits, Changelog) show
# on every page, including the landing page.
firebase deploy --only firestore:rules   # changelog + credits rules
npm run test:rules   # firestore.rules.test.ts: 148 tests incl. 34 for P14 (api-routes.emulator.test.ts has 11 pre-existing failures, unrelated)

# FIX2 (rules changed — deploy them first; no env changes, no new indexes).
# As the owner (an email in OWNER_EMAILS, verified), the only member of the team:
# Team Management -> your own row now has an enabled Edit button and the Owner
# badge next to your name. Change your primary role and secondary roles and Save;
# the Admin switch is shown ON with a lock icon, disabled, and hovering it says
# 'Owner access can't be removed.' Admin Panel > Audit Log shows 'Edit Member
# Roles' for it. With a second account on the team: edit its roles, grant it
# admin, then revoke it. Sign in as that admin: your own row and other members are
# editable, the owner's row has a DISABLED Edit button whose tooltip reads 'Only the
# owner can edit this member.' Sign in as a plain member: every row has a disabled
# Edit button ('Only admins can edit roles.'). Unverified owner email: sign up with
# the OWNER_EMAILS address and don't click the link -> the banner reads 'Verify your
# email to activate owner access.' with Resend email; click the link in the email,
# then 'I've verified — refresh' -> the Owner badge and owner controls appear without
# signing out.
firebase deploy --only firestore:rules   # the new users/{uid} update rule + isOwner()/canManageMembers()
npm run test:rules   # needs Java + firebase-tools; now 187 tests across both files, all passing

# P15 (rules changed — deploy them FIRST; no env changes, no new indexes).
# IMPORTANT order: deploy the rules, then open the app once as an ADMIN. That stamps the
# existing match library (origin 'api', published true) — until then scouts' practice match
# lists are empty, because members now only read published matches. Check: Admin Panel >
# Match Library > Imported: matches show an 'API' badge; a scout's Practice Scouting > pick a
# difficulty still lists the matches.
# Manual events: Admin Panel > Match Library > Manual events > Add manual event (name, season,
# optional code/date/source link; leave the code blank to get MAN-…). Add match: fill the
# form; paste a YouTube link in any form (youtu.be/…?si=…&t=90 pre-fills 1:30 as the start);
# play the preview and use Set start here / Set end here. A penalty larger than its score, a
# repeated team, or a non-YouTube link is refused. Edit the event to set a Default video, then
# Fast entry: type teams/scores, Tab through, Enter — the number bumps and the link is kept.
# Bulk import: pick or create the event once, set defaults, Download template, or paste rows
# copied from Google Sheets/Excel (with or without the header); the preview lists errors per
# row and which rows would update existing matches; Import -> matches show 'Needs review' and
# scouts can't see them; Publish all. Select several: Set video link, Unpublish, Delete.
# Edit a match that practice sessions already used -> the dialog says how many and offers the
# Rescore tab. Then as a scout: Practice Scouting lists the manual matches (small 'Manual'
# tag), they work in solo, live and the lobby, and Analytics' Practice event filter lists the
# manual event. Importing/refreshing an API event never touches a manual match (the message
# says how many were left alone).
firebase deploy --only firestore:rules   # libraryMatches + libraryEvents rules
npm run test:rules   # needs Java + firebase-tools; 219 tests across both files, all passing

# FIX3 (rules AND indexes changed — deploy both FIRST; no env changes).
# Deploy: firebase deploy --only firestore:rules,firestore:indexes
# (an older deployed firestore.rules reproduces the original 'Missing or insufficient
# permissions' exactly; the indexes file also had to be fixed so the deploy accepts it.)
# Then, as a Match Scout, a plain member, and the owner: Practice Scouting > Season > Mode >
# Difficulty > pick a match -> the session starts (no permission error); finish it -> Results; pause
# a session and confirm the Resume banner; open Live Practice and the Lobby (create one, join it
# from a second account with the code). If a match list is empty, an admin presses Admin Panel >
# Match Library > 'Update library' once (it also runs automatically for an admin). To see the new
# error card, break your connection or sign out in another tab: 'Couldn't load matches' with Retry
# and Copy details (paste it to see the collection path and code).
# Credits: as an admin the page shows the same sections as a member, with Add/Edit/Reorder/Delete
# inline and no edit-mode toggle; as a member there are no controls.
# Optional times: Admin Panel > Match Library > Manual events: add a match with a YouTube link and
# leave Start and End blank (also try start only, end only); in a CSV or pasted row leave
# startSec/endSec blank -> no error in the preview; edit an imported match's video with a blank
# time. Practice that match in Competitive mode: it starts at 0:00 (or the start) and ends when
# the video ends; finishing at 30% of the video raises 'Finished Early'.
# Glass slider: the droplet in the sidebar footer (also when collapsed, and in the mobile menu)
# opens the slider; drag it, reload, and sign in on another browser -> same level; the home-page
# slider follows it. Turn Wi-Fi off (or go offline in devtools): an amber badge appears on the
# droplet, tapping it says 'Offline: N submissions will sync when you're back online.'; online
# with nothing pending shows no badge at all.
firebase deploy --only firestore:rules,firestore:indexes
npm run test:rules   # needs Java + firebase-tools; 266 tests across both files, all passing

# P16 (rules changed — deploy them first; no env changes, no new indexes).
# Analytics > Scout Status with an active event (needs FTC_API_*) and some scouted entries:
# the page uses the same filter bar as the other Analytics pages — change the Event, turn Practice on,
# set an Accuracy threshold, and every number follows. Only 'Match Scout' is a live tab (the rest are
# greyed out: 'Coming soon'). Category chips: Practice / Qualifications / Semi-Finals / Finals.
# As an admin or Lead Scout: Setup > Range entry (try 2-4, 8, 10-12 and a bad chip), Max match targets
# (an API number with 'from API', edit it -> 'manual', 'Reset to API'), Individual scout targets (Match
# Scouts marked attending on Assignments appear; cells prefill from a published schedule; type a number
# -> 'manual'; 'Add team member'). As a plain member the same panels are collapsed and read-only. With two
# events selected, 'Editing targets for' offers the totals view or one event. CHECK the Finals detection
# at a real event with playoffs (the API's series numbers are unverified): if the wrong matches are labeled
# SF/F, type the real finals numbers in the Finals range. The table: sort, search, expand a scout, the
# 'Open ... in Match Scout Analytics' link; the status pill (Behind vs On track). Match coverage: a check
# per scout per robot (two scouts = two checks), a red X for a played match with an unscouted robot, a
# muted circle for matches not played yet, 'Show only missing'.
firebase deploy --only firestore:rules   # scoutTargets rules
npm run test:rules   # needs Java + firebase-tools; 275 tests across both files, all passing

# P17 (no rules, indexes, or env changes). Browser checks the build environment couldn't do:
#   npm i -D playwright && npx playwright install chromium webkit
#   npm run dev   (other terminal), then: node scripts/mobile-audit.mjs
#   (signed-in routes: npx playwright codegen --save-storage=.auth/state.json http://localhost:3000/login,
#    then AUTH_STATE=.auth/state.json node scripts/mobile-audit.mjs)
#   npx lighthouse http://localhost:3000/dashboard --form-factor=mobile --only-categories=performance
# On a phone: scout form with one hand (sticky score bar above the home indicator, numeric keypad in the
# picker), open any dialog (bottom sheet), droplet button in the top bar, rotate to landscape, then 'Add to
# Home Screen' (iPhone: Share > Add to Home Screen; Android: Install app) and open it standalone.
# Icons: node scripts/generate-icons.mjs  (only to change the art)

# P21 (form schema v2): no env or index changes. Deploy the rules (forms collection + versions subcollection + teams.activeForms):
#   firebase deploy --only firestore:rules
# Nothing is migrated; BIOBUZZ and every old entry work unchanged. To verify locally:
#   npm test                # 1,100+ unit tests, incl. lib/forms/biobuzz-regression.test.ts (the old BIOBUZZ is the oracle)
#   npm run test:rules      # 360 tests across both emulator files (needs Java + firebase-tools)
#   npm run build && npm run test:e2e

# P22 (Form Builder UI): no env, rules or index changes beyond P21's rules deploy. Browser tests:
#   npx playwright install chromium webkit   (first time)
#   npm run test:e2e                         (includes e2e/form-builder.e2e.ts)
# Try it: Admin Panel > Forms > Edit BIOBUZZ (needs the P21 rules deployed to save drafts).

# P23 (templates): no env or index changes. Deploy the rules (formTemplates), then, once, as the platform owner:
#   Admin Panel > Template Review > Seed official templates   (publishes the BIOBUZZ and Blank templates)
#   npm run test:rules   # now 400+ tests across both emulator files, incl. the template rules and /api/templates

# P24 (practice workspace): no env, rules or index changes. Browser tests (screenshots land in e2e/screenshots/):
#   npm run test:e2e   # includes e2e/practice-workspace.e2e.ts
# Check once by hand on a real session: Practice Scouting > solo / Live / lobby: resize the divider, Focus (F), Fullscreen, Comments (C), reload to see the width kept.

# P25 (profiles): no env or index changes; the rules changed (profiles/{uid} and the users avatar checks), so deploy them with the app. Tests:
#   npm run test:rules   # now includes 'P25: profiles/{uid}...' (25 tests)
#   npm run test:e2e     # includes e2e/profiles.e2e.ts
# Check once by hand with two real accounts: set one to Private in Account Settings > Privacy and profile, open /people/<their uid> as the other, and as an admin.

# Deploying rules (not done by this prompt — do this yourself when ready)
firebase deploy --only firestore:rules,firestore:indexes

# See docs/DEPLOYMENT.md for the full Vercel env var list and Firebase Auth
# authorized-domains step.
```
