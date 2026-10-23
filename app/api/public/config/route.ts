import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { getTeamCreationEnabled } from "@/lib/server/team-settings";

/**
 * The one piece of server state the logged-out Signup page needs (whether
 * to show "Create a team") — deliberately not a Firestore read from the
 * client: `teams` and `appSettings` are both fully locked down to clients
 * in firestore.rules (see docs/ASSUMPTIONS.md, P1b), so this is the only
 * way an unauthenticated visitor learns the flag.
 */
export async function GET() {
  const db = getAdminFirestore();
  if (!db) {
    // Firebase Admin isn't configured — fail closed (no Create option)
    // rather than guessing, same convention as lib/server/require-user.ts.
    return NextResponse.json({ teamCreationEnabled: false });
  }
  const teamCreationEnabled = await getTeamCreationEnabled(db);
  return NextResponse.json({ teamCreationEnabled });
}
