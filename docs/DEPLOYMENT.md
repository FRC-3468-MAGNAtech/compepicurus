# Deployment (Vercel + Firebase)

This app deploys on Vercel. Firebase provides Auth and Firestore only — no
Firebase Cloud Functions, no Firebase Hosting. Server-side work (the FIRST
API proxy today; scheduled checks / push sending in later prompts) runs as
Next.js Route Handlers / Server Actions, which Vercel runs as serverless
functions automatically — there's nothing extra to configure for that part.

## 1. Vercel project setup

Import this repo into Vercel as you would any Next.js app (framework preset:
Next.js). No `vercel.json` is needed: unlike a client-routed SPA (which is
what the original prompt template assumed, hence its rewrite-on-refresh
requirement), Next.js App Router is server-rendered and file-routed, so
there's no 404-on-refresh problem to work around.

## 2. Environment variables

Set these in the Vercel dashboard under Project Settings → Environment
Variables, for both **Production** and **Preview**. Names must match
`.env.example` exactly.

### Client (exposed to the browser — not secret)

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Console → Project Settings → General → Your apps → Web app config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | same |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | same |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | same |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | same |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | same |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | same (optional — only if Analytics is enabled) |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (P20; the prompt called it `VITE_TURNSTILE_SITE_KEY`, but this is a Next.js app). Optional but strongly recommended: see §9. |

These aren't secret — Firebase's web config is designed to be public; actual
security comes from `firestore.rules`. They're still kept out of the repo
(`.env.local`, gitignored) purely so different environments (e.g. a second
Firebase project for testing) can use different values without a commit.

### Server-only (never add `NEXT_PUBLIC_` — these must never reach the browser)

| Variable | Where to get it |
|---|---|
| `FTC_API_USERNAME` | Your FIRST account's API username |
| `FTC_API_KEY` | Your FIRST account's API key |
| `FIREBASE_ADMIN_PROJECT_ID` | Firebase Console → Project Settings → Service Accounts → Generate new private key (downloads a JSON file) → `project_id` field |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Same JSON file → `client_email` field |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Same JSON file → `private_key` field — see the gotcha below |
| `CRON_SECRET` | Any random string you generate (e.g. `openssl rand -hex 32`). Required by `app/api/cron/poll-live-scores` (P7) — the job's request must send it as `Authorization: Bearer <CRON_SECRET>`. See §8 below for scheduling it. |
| `OWNER_EMAILS` | Comma-separated emails (e.g. `you@example.com`) that are **platform owners** (P20): they approve team applications, switch public team creation on/off and can recover accounts, and are always admins of their own account. Synced on every login by `app/api/auth/sync-roles` — **after** that email verifies. This is *not* team ownership: each account's owner is `teams/{teamId}.ownerUid` and is transferable (see §9). |
| `ADMIN_EMAILS` | Comma-separated emails that should get admin (not owner) the same way. Optional. |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key (P20), server-only. Verifies the CAPTCHA on team applications. Optional: without it applications still run every other protection and the platform owner sees a warning. See §9. |
| `RESEND_API_KEY` | Resend API key (P20), for application and ownership-transfer emails. Optional: without it (or `EMAIL_FROM`) no email is sent and everything still shows in the app. See §9. |
| `EMAIL_FROM` | The sender, e.g. `CompEpicurus <notify@yourdomain.org>`, on a domain you verified in Resend. Optional (see above). |
| `APP_URL` | Your public URL, e.g. `https://compepicurus.vercel.app`, used for links in emails. Optional: falls back to Vercel's own URL variables. |
| `APPLICATION_SECRET` | Any long random string (P20). Signs the application form's start token and keys the stored IP/email hashes. Optional: derived from `FIREBASE_ADMIN_PRIVATE_KEY` when unset. |

**Pasting the private key:** the downloaded JSON's `private_key` field is a
single string with literal `\n` sequences marking line breaks (it is *not*
pre-formatted with real newlines). Paste it into Vercel's env var value
field exactly as it appears in the JSON file — quotes and `\n` included.
`lib/firebase/admin.ts` un-escapes those `\n`s back into real newlines at
runtime, since most dashboard env var inputs (Vercel's included) only accept
single-line values.

## 3. Enable the Google sign-in provider (manual — I do this myself)

Firebase Console → Authentication → Sign-in method → add **Google** as a
provider, and give it a support email. Nothing in the app needs reconfiguring
once that's on — `lib/auth.tsx` constructs a plain `GoogleAuthProvider()` with
no extra setup.

## 4. Firebase Auth → Authorized domains

Firebase Console → Authentication → Settings → Authorized domains. Add your
production domain (e.g. `compepicurus.vercel.app` or a custom domain).

This now matters for real sign-in, not just for password-reset emails:
Google sign-in's popup/redirect flow (P1b) checks the *current* domain
against this list and fails outright if it isn't there. Preview deployments
get a new `*.vercel.app` subdomain per deployment, and Firebase Authorized
Domains doesn't support wildcards, so Google sign-in (and the password-reset
email's continue link) will only work on domains you've explicitly added —
add a specific preview domain if you need either to work from that preview;
neither is required for ordinary password sign-up/login.

## 5. Firestore rules & indexes

Not deployed by this prompt — do this yourself once you're ready:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

## 6. FIRST API proxy — requires a signed-in user

`getEvents`/`getEvent`/`getTeamsForEvent`/`getMatchesForEvent`
(`lib/ftc/actions.ts`) each check for a valid session before calling the
FIRST API — a Firebase ID token exchanged for an HttpOnly session cookie via
`app/api/auth/session`, verified server-side with the Firebase Admin SDK
(`lib/server/require-user.ts`). This requires `FIREBASE_ADMIN_*` to be set
(above); without it, every FIRST API call fails closed with an
"unauthorized" `ActionResult` rather than silently serving data to anyone
who can reach the deployed app.

Responses are also cached in-memory per server instance for ~3 minutes
(`lib/ftc/http.ts`) to stay well under FIRST's API rate limit — this is
intentionally "light" caching (reset on cold start, not shared across
instances), which is fine since event data doesn't change faster than that
during a live competition.

## 7. Local development

```bash
npm install
cp .env.example .env.local   # fill in real values — never commit .env.local
npm run dev
```

`next dev` already runs the API routes (`/api/team/create`, `/api/team/join`,
`/api/auth/sync-roles`, `/api/public/config`, `/api/admin/team-creation`,
`/api/auth/session`) alongside the rest of the app — nothing extra (like
`vercel dev`) is needed for local development against your real Firebase
project.

`npm run build`, `npm run lint`, and `npm run test` should all be run (and
pass) before deploying. `npm run test:rules` additionally needs a JVM and
the Firebase CLI (`npm install -g firebase-tools`) — it runs both
`firestore.rules.test.ts` and `api-routes.emulator.test.ts` (P1b) against
the Auth + Firestore emulators together; see `docs/ASSUMPTIONS.md` (P1-12,
P1b-9) for why neither was verified in this session.

## 8. Live scoring — Cloud Messaging & scheduling the poll job (P7)

### 8a. Firebase Cloud Messaging (web push)

1. Firebase Console → Project Settings → Cloud Messaging → **Web Push
   certificates** → Generate key pair. Put that value in
   `NEXT_PUBLIC_FIREBASE_VAPID_KEY` (table above).
2. Nothing else to configure — `lib/notifications.ts`'s
   `requestAndRegisterPush` registers `app/firebase-messaging-sw.js` (a
   dynamic Route Handler, not a static file, so it can read your
   `NEXT_PUBLIC_FIREBASE_*` config at request time) and the Admin SDK side
   (`lib/firebase/admin.ts`'s `getAdminMessaging()`) needs only the same
   `FIREBASE_ADMIN_*` credentials already set up in §2.
3. **iOS caveat**: Safari on iOS only delivers web push to a site that's
   been added to the Home Screen (installed as a PWA) — a plain browser tab
   can request permission but will never receive anything. The "Enable
   notifications" button's copy already explains this
   (`isLikelyUnsupportedIOSBrowser()`); there's nothing to configure for it,
   it's a platform limitation.
4. This was not verified end-to-end against a real device in development
   (no network access in that environment) — see `docs/ASSUMPTIONS.md`
   (P7-10). Test it yourself after deploying: Enable notifications on a
   real phone/desktop browser, then trigger `/api/cron/poll-live-scores`
   for a session of yours and confirm a notification actually arrives, both
   with the tab open (foreground) and closed (background, via the service
   worker).

### 8b. Scheduling `/api/cron/poll-live-scores`

This route needs to run every couple of minutes while a live match might
be in progress — Vercel's own Cron Jobs run as often as once a day on the
Hobby plan (the committed `vercel.json` sets that daily run as a fallback
floor, not the real mechanism), so a short interval needs an **external
scheduler** calling the route over HTTPS:

- **cron-job.org** (free, simplest): create a job hitting
  `https://<your-domain>/api/cron/poll-live-scores` every 2–5 minutes, with
  a custom header `Authorization: Bearer <CRON_SECRET>`.
- **GitHub Actions** (if you'd rather keep it in-repo): a `schedule:` cron
  trigger (as frequent as every 5 minutes) running a `curl` step with the
  same header, using a repo secret for `CRON_SECRET`.

Either way, verify it's wired correctly by checking the route returns
`{ checked, resolved }` (not 401) and that `CRON_SECRET` in your scheduler
matches the one in Vercel's env vars exactly.

Vercel's *own* cron invocations (the `vercel.json` entry) automatically
send `Authorization: Bearer $CRON_SECRET` using the env var already
configured in your project — no extra setup needed for that fallback call
specifically, only for the external scheduler's more frequent one.

The client-side fallback (`app/api/live/check-scores`, polled automatically
by `components/layout/scores-ready-watcher.tsx` whenever a signed-in
scout's app is open with a pending live session) needs no scheduler setup
at all — it only helps while someone's actually using the app, which is
why the cron route above still matters for the "nobody has the app open
right now" case.

## 9. Team applications and ownership (P20)

Public team creation stays **off**. Other teams apply at `/apply` (reached from Sign up → *Apply to create a team*), and the
platform owner approves each one under **Admin Panel → Team Applications**. Approval is never automatic.

### 9a. Two kinds of owner

- **Platform owner**: an email in `OWNER_EMAILS` (verified). Gets the `platformOwner` custom claim; approves applications; turns public
  creation on/off; can force-transfer an account for recovery (Admin Panel → Recovery). It opens the application tools and nothing else:
  it gives no access to any account's scouting data.
- **Team owner**: `teams/{teamId}.ownerUid`. What the Owner badge and the owner protections follow. Transferable from
  **Team Settings → Ownership**. `sync-roles` only ever sets it for an account that has none (the one-time bootstrap: the user already
  flagged as owner keeps it, so you aren't locked out) and never takes it back after a transfer.

The first sign-in after deploy runs the bootstrap automatically. After that, sign out and in once so your token carries the new
`platformOwner` claim (the old `owner` claim is removed).

### 9b. Create a Cloudflare Turnstile site (the CAPTCHA)

1. Sign in at <https://dash.cloudflare.com> (a free account is enough) → **Turnstile** → **Add site**.
2. Name it (e.g. *CompEpicurus applications*), add your production domain (and your Vercel preview domain if you want to test there; add `localhost` for local
   development), widget mode **Managed**.
3. Copy the **Site key** into `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the **Secret key** into `TURNSTILE_SECRET_KEY` (Vercel → Project Settings → Environment Variables,
   Production and Preview), then redeploy.
4. Set both or neither. The Team Applications tab warns you if the server has a secret but the browser has no site key (every application would be refused) or
   if neither is set (applications run unchallenged, protected only by the honeypot, timing check, rate limits and disposable-email filter).

For local testing without your own site, Cloudflare publishes always-pass test keys (site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`).

### 9c. Email (optional)

Email is used for: a new application (to `OWNER_EMAILS`), the applicant's receipt and decision, and ownership-transfer notices. Create an account at
<https://resend.com>, **verify a sending domain**, create an API key, then set `RESEND_API_KEY` and `EMAIL_FROM` (a sender on that domain) and `APP_URL`.
With any of the first two unset, nothing is sent and nothing breaks: every notice is also shown in the app, and an email failure never fails a request.

### 9d. Firestore rules and cleanup

```bash
firebase deploy --only firestore:rules
```

Deploy the rules **before or together with** the app. New collections (all written only by server routes): `teamApplications`, `applicationPrivate`,
`applicationBlocks`, `platformAuditLog`, `rateLimits`. Optional: add a Firestore **TTL policy** on the `expiresAt` field of the `rateLimits` collection group
(Firebase Console → Firestore → TTL) so the small rate-limit counters clean themselves up. Nothing depends on it.

## 10. Form schema v2 (P21)

No new environment variables. The only deploy step is the Firestore rules (new `forms` collection and its write-once `versions` subcollection, and validation of `teams.activeForms`):

```bash
firebase deploy --only firestore:rules
```

Deploy the rules **before or together with** the app: the app reads `forms` on every screen after sign-in (a missing rule shows as an empty forms list, so scouting still falls back to the built-in BIOBUZZ form, but an
admin couldn't save a form until the rules are live). Nothing is migrated: existing entries keep their stored shape and are read through an adapter, and BIOBUZZ keeps working exactly as before. No index is needed
(the only query is `forms` where `teamId ==` the account's id).

To check the rules locally (needs Java and firebase-tools): `npm run test:rules`.

## 11. Form templates (P23)

No new environment variables or indexes (every query is equality-only on `visibility`, `ownerTeamId` and `hasPendingUpdate`, which Firestore serves from its automatic indexes). Deploy the rules **before or together with** the app:

```bash
firebase deploy --only firestore:rules
```

The new collection is `formTemplates` (with `updates`, `reports` and `imports` subcollections, written only by `/api/templates`). Then, once, as the platform owner (an email in `OWNER_EMAILS`), open **Admin Panel > Template Review** and
press **Seed official templates**: it publishes the BIOBUZZ Match Scout and Blank (standard phases) templates. Press it again after an app update that changes BIOBUZZ and it adds a new version of the official template.

Review notifications reuse the P20 setup: push to devices where a platform owner enabled notifications, and email to `OWNER_EMAILS` when `RESEND_API_KEY`, `EMAIL_FROM` and `APP_URL` are set (authors are emailed the decision the same way). With
email unset nothing breaks: the Template Review tab always shows the queue.

## 12. Member profiles (P25)

No new environment variables or indexes (profiles are read by document id only). Deploy the rules **before or together with** the app, because the new Settings section and profile pages write and read `profiles/{uid}` and the `users/{uid}.avatar` mirror:

```bash
firebase deploy --only firestore:rules
```

Nothing needs migrating: a member has no profile document until they save one, and until then their profile is shown with the defaults (`DEFAULT_PROFILE_VISIBILITY` in `lib/profile/config.ts`, public to their team). Admins' and the owner's profiles are always visible to teammates whatever their saved preference says.
Moderation clears are recorded in the Audit Log as "Cleared Profile Bio / Pronouns".

## 13. Photo uploads (Vercel Blob)

The form `image` field stores photos in Vercel Blob. Until a Blob store is connected, `/api/blob/upload` and `/api/blob/delete` answer `503 not-configured` and the app keeps working (the form shows that photos can't be uploaded yet).

1. In the Vercel dashboard open your project, go to the **Storage** tab and **Create** a **Blob** store. Choose **Public** access (the app uploads with `access: "public"`).
2. **Connect** the store to the project for **Production and Preview** (Development too if offered). Vercel adds the `BLOB_READ_WRITE_TOKEN` environment variable for you.
3. For local development, run `vercel env pull .env.local` (or copy the token from the store's settings into `.env.local` by hand). Never commit it. `.env.example` lists the variable name only.
4. Redeploy so the new variable is picked up.

How it works and what to know:

- **Uploads go straight from the browser to Vercel Blob.** Our route `/api/blob/upload` only issues a one-use token for one path, after checking the signed-in user, their team, and that they can open the page that owns the form. The photo bytes never pass through a Vercel Function, so the 4.5 MB function body limit does not apply (the app still compresses to about 1600 px JPEG and caps files at 6 MB).
- **Blob URLs are public but unguessable.** The path is `kind/teamId/eventCode/teamNumber/uidTag-random.jpg` with 128 bits of randomness and no user-entered text. Anyone who has a URL can view the photo without signing in, so don't treat photos as private.
- **Quotas.** The free (Hobby) plan has limits on storage and data transfer. Check the current numbers on Vercel's pricing page rather than relying on this document, and watch the store's usage in the dashboard during the season.
- **`onUploadCompleted` is not relied on.** Vercel's completion webhook can't reach `localhost`, so the browser takes the URL from `upload()`'s result and saves it with the form entry instead. The route accepts the webhook and does nothing with it.
- **Deletes** go through `/api/blob/delete`: only the person who uploaded a photo, or an admin or team owner of the same team, can delete it. Photos of another team are always refused.
- **Offline.** Photos wait in the browser (IndexedDB) and upload when the connection returns, so a scout in a bad-wifi pit doesn't lose them.
