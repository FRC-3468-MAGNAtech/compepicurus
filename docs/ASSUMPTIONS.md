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

## Commands to run locally

```bash
# Install the Firebase CLI if you haven't already
npm install -g firebase-tools

# Pure-logic unit tests (scoring, accuracy, auto-flags) — already run and passing
npm run test

# Firestore security rules tests — requires a JVM + the Firebase CLI,
# neither available in the sandboxed environment this was built in
npm run test:rules

# Once your Firebase project's config AND a FIREBASE_ADMIN_* service account
# are in .env.local (see .env.example and docs/DEPLOYMENT.md):
npm run dev
# then walk through: first-run setup -> copy the join code -> sign up a
# second account with it -> Team Management role/admin edits (including the
# last-admin block) -> Event Selection as admin vs. non-admin (this now also
# exercises the session-cookie auth proxy — Event Selection calls getEvents()
# under the hood) -> Scout Form submit -> Match Analytics -> toggle devtools
# network throttling to "Offline" and confirm the nav shows "N pending
# sync", then back online and confirm it clears.
#
# Without FIREBASE_ADMIN_* configured, Event Selection (and anything else
# calling the FIRST API) will show "Sign in to view FIRST API data." even
# while logged in — that's lib/server/require-user.ts failing closed because
# there's no Admin SDK to verify the session cookie against. Expected until
# those three env vars are set.

# Deploying rules (not done by this prompt — do this yourself when ready)
firebase deploy --only firestore:rules,firestore:indexes

# See docs/DEPLOYMENT.md for the full Vercel env var list and Firebase Auth
# authorized-domains step.
```
