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

# Deploying rules (not done by this prompt — do this yourself when ready)
firebase deploy --only firestore:rules,firestore:indexes

# See docs/DEPLOYMENT.md for the full Vercel env var list and Firebase Auth
# authorized-domains step.
```
