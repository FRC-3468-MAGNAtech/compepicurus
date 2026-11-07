import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminMessaging } from "@/lib/firebase/admin";
import { appBaseUrl, platformOwnerEmails, sendEmail } from "@/lib/server/email";
import { emailTemplates } from "@/lib/server/email-templates";

/**
 * P20: tells the platform owner(s) a new application arrived. Two best-effort channels (the in-app badge on the
 * Admin Panel needs no sending: it counts pending applications live): a web push to every device any
 * platform owner enabled push on (`users.fcmTokens`, the same tokens live-score notifications use), and an email to
 * the OWNER_EMAILS addresses (when email is configured). Neither can fail the application.
 */
export async function notifyPlatformOwnersOfApplication(
  db: Firestore,
  app: { applicationId: string; applicantName: string; applicantEmail: string; teamNumber: number; teamName: string; role: string }
): Promise<void> {
  const title = `New team application: FTC ${app.teamNumber}`;
  const body = `${app.applicantName} applied to create a team account.`;

  try {
    const messaging = getAdminMessaging();
    if (messaging) {
      const owners = await db.collection("users").where("isPlatformOwner", "==", true).get();
      const tokens = [...new Set(owners.docs.flatMap((d) => (Array.isArray(d.data().fcmTokens) ? (d.data().fcmTokens as string[]) : [])))];
      if (tokens.length > 0) {
        await messaging.sendEachForMulticast({ tokens, notification: { title, body }, data: { applicationId: app.applicationId, url: "/admin" } });
      }
    }
  } catch (err) {
    console.error("application push failed:", err instanceof Error ? err.message : err);
  }

  const to = platformOwnerEmails();
  if (to.length > 0) {
    await sendEmail(emailTemplates.newApplicationForOwner({ to, ...app, queueUrl: `${appBaseUrl()}/admin` }));
  }
}
