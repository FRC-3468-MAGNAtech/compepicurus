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
| `CRON_SECRET` | Any random string you generate (e.g. `openssl rand -hex 32`). **Reserved for a future scheduled job (P2+) — nothing reads it yet.** Set it now so it's already in place when that lands. |
| `OWNER_EMAILS` | Comma-separated emails (e.g. `you@example.com,mentor@example.com`) that should always have owner + admin access, synced on every login by `app/api/auth/sync-roles` — **after** that email verifies. Set it to your own email before you first sign up. |
| `ADMIN_EMAILS` | Comma-separated emails that should get admin (not owner) the same way. Optional. |

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
