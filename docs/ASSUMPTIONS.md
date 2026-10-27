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
`components/layout/connection-status.tsx` subscribes to
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

**P1b-3. Owner rows are locked for *everyone*, including the owner's own
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

# Deploying rules (not done by this prompt — do this yourself when ready)
firebase deploy --only firestore:rules,firestore:indexes

# See docs/DEPLOYMENT.md for the full Vercel env var list and Firebase Auth
# authorized-domains step.
```
