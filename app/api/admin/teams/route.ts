import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { verifyBearerToken } from "@/lib/server/require-user";
import { isPlatformOwnerToken } from "@/lib/server/owner-admin";
import { readFieldTeams } from "@/lib/field-teams";

/**
 * P20: the list behind Admin Panel > Recovery (platform owner only): every team account's FTC teams, who owns it, and
 * its **admins** (the only people ownership can be moved to), so a platform owner can force-transfer an account whose
 * owner is gone. Deliberately minimal: no scouting data, no non-admin members, no join codes.
 */
export async function GET(request: Request) {
  const decoded = await verifyBearerToken(request);
  if (!decoded) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!isPlatformOwnerToken(decoded)) return NextResponse.json({ ok: false, error: "Only the platform owner can see this." }, { status: 403 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: "Server isn't configured." }, { status: 503 });

  const [teamsSnap, adminsSnap] = await Promise.all([db.collection("teams").get(), db.collection("users").where("isAdmin", "==", true).get()]);
  const adminsByTeam = new Map<string, { uid: string; name: string; email: string }[]>();
  for (const d of adminsSnap.docs) {
    const teamId = d.data().teamId as string | undefined;
    if (!teamId) continue;
    const list = adminsByTeam.get(teamId) ?? [];
    list.push({ uid: d.id, name: String(d.data().name ?? ""), email: String(d.data().email ?? "") });
    adminsByTeam.set(teamId, list);
  }

  const teams = teamsSnap.docs.map((d) => {
    const data = d.data();
    const admins = adminsByTeam.get(d.id) ?? [];
    const ownerUid = typeof data.ownerUid === "string" ? data.ownerUid : null;
    return {
      teamId: d.id,
      accountName: typeof data.accountName === "string" ? data.accountName : null,
      fieldTeams: readFieldTeams(data).map((t) => ({ number: t.number, name: t.name })),
      ownerUid,
      ownerName: admins.find((a) => a.uid === ownerUid)?.name ?? null,
      admins,
    };
  });
  teams.sort((a, b) => (a.fieldTeams[0]?.number ?? 0) - (b.fieldTeams[0]?.number ?? 0));
  return NextResponse.json({ ok: true, teams });
}
