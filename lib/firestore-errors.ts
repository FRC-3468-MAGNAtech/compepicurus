// Turning a Firestore failure into something a scout can act on and an admin can
// diagnose (FIX3). Pure — no Firebase import, it only reads `code`/`message` off
// whatever was thrown, so it is unit tested.

export type FirestoreFailure = {
  /** What the app was doing, in the user's words: "Couldn't load matches", "Couldn't start that session." */
  context: string;
  /** Firestore error code without the prefix: "permission-denied", "failed-precondition", … or "unknown". */
  code: string;
  /** The error's own message, verbatim (e.g. "Missing or insufficient permissions."). */
  message: string;
  /** The collection path and query constraints that failed, when known — e.g. `libraryMatches where seasonId == "biobuzz", published == true`. */
  path: string | null;
  /** When it happened (ISO). */
  at: string;
};

const stripPrefix = (code: string) => code.replace(/^firestore\//, "");

export function describeFirestoreError(context: string, err: unknown, path: string | null = null, now: Date = new Date()): FirestoreFailure {
  const raw = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof raw?.code === "string" ? stripPrefix(raw.code) : "unknown";
  const message = typeof raw?.message === "string" && raw.message !== "" ? raw.message : typeof err === "string" ? err : "Unknown error";
  return { context, code, message, path, at: now.toISOString() };
}

/** The one-sentence explanation shown under the title. */
export function failureExplanation(f: Pick<FirestoreFailure, "code">): string {
  switch (f.code) {
    case "permission-denied":
      return "The app wasn't allowed to read or write that data. This usually means the database rules on the server are out of date, or your account is missing something it needs. Copy the details and send them to an admin.";
    case "unavailable":
    case "deadline-exceeded":
      return "Couldn't reach the server. Check your connection and try again.";
    case "failed-precondition":
      return "The database is missing an index for this request. Copy the details and send them to an admin.";
    case "unauthenticated":
      return "You've been signed out. Sign in again and retry.";
    default:
      return "Something went wrong talking to the server. Try again, and if it keeps happening copy the details and send them to an admin.";
  }
}

/** Plain text for "Copy details" — what an admin needs to find the failing query. */
export function failureDetails(f: FirestoreFailure): string {
  return [`${f.context}`, `code: ${f.code}`, `message: ${f.message}`, f.path ? `path: ${f.path}` : null, `at: ${f.at}`].filter(Boolean).join("\n");
}

/**
 * Logs a Firestore failure with its collection path and query constraints — in
 * development every permission error is printed here in full (FIX3), and in
 * production the same line still goes to the console.
 */
export function reportFirestoreError(context: string, err: unknown, path: string | null = null): FirestoreFailure {
  const failure = describeFirestoreError(context, err, path);
  console.error(`[firestore] ${context} — ${failure.code}${path ? ` — ${path}` : ""}: ${failure.message}`);
  return failure;
}
