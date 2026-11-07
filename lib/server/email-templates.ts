import type { EmailMessage } from "@/lib/server/email";

// P20: the wording of every email the app sends. Pure functions (no I/O) so the text is tested, and every
// user-supplied value is HTML-escaped in the html body (the plain-text body is the source of truth).

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function wrap(heading: string, paragraphs: string[], action?: { label: string; url: string }): { text: string; html: string } {
  const text = [heading, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : []), "", "CompEpicurus"].join("\n");
  const html = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#18181b">`,
    `<h2 style="margin:0 0 16px;font-size:20px">${escapeHtml(heading)}</h2>`,
    ...paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`),
    action ? `<p style="margin:20px 0"><a href="${escapeHtml(action.url)}" style="background:#18181b;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>` : "",
    `<p style="margin:24px 0 0;color:#71717a;font-size:12px">CompEpicurus</p>`,
    `</div>`,
  ].join("");
  return { text, html };
}

function message(to: string | string[], subject: string, heading: string, paragraphs: string[], action?: { label: string; url: string }): EmailMessage {
  const { text, html } = wrap(heading, paragraphs, action);
  return { to, subject, text, html };
}

export const emailTemplates = {
  applicationReceived(p: { to: string; name: string; teamNumber: number; statusUrl: string }): EmailMessage {
    return message(
      p.to,
      `We received your application for FTC ${p.teamNumber}`,
      "Application received",
      [`Hi ${p.name},`, `Thanks for applying to create a CompEpicurus account for FTC ${p.teamNumber}. The platform owner reviews every application by hand. You'll get an email when there's a decision, and you can check the status any time by signing in.`, "Applications that aren't reviewed within 30 days expire."],
      { label: "Check your application", url: p.statusUrl }
    );
  },

  newApplicationForOwner(p: { to: string[]; applicantName: string; applicantEmail: string; teamNumber: number; teamName: string; role: string; queueUrl: string }): EmailMessage {
    return message(
      p.to,
      `New team application: FTC ${p.teamNumber}`,
      "A new team application is waiting",
      [`${p.applicantName} (${p.applicantEmail}) applied to create an account for FTC ${p.teamNumber}${p.teamName ? ` (${p.teamName})` : ""} as ${p.role}.`, "Open the review queue to see the verification signals and approve, reject or block it."],
      { label: "Open the review queue", url: p.queueUrl }
    );
  },

  applicationApproved(p: { to: string; name: string; teamNumber: number; appUrl: string }): EmailMessage {
    return message(
      p.to,
      `Your CompEpicurus account for FTC ${p.teamNumber} is ready`,
      "You're approved",
      [`Hi ${p.name},`, `Your application for FTC ${p.teamNumber} was approved. Your team's account has been created and you're its owner and an admin. Sign in to set up your team, share the join code with your teammates, and choose your events.`],
      { label: "Open CompEpicurus", url: p.appUrl }
    );
  },

  applicationRejected(p: { to: string; name: string; teamNumber: number; reason: string; statusUrl: string }): EmailMessage {
    return message(
      p.to,
      `Your application for FTC ${p.teamNumber}`,
      "Your application wasn't approved",
      [`Hi ${p.name},`, `We couldn't approve your application for FTC ${p.teamNumber}.`, `Reason: ${p.reason}`, "If that's something you can fix (for example, a clearer way for us to verify your team), you're welcome to apply again."],
      { label: "View your application", url: p.statusUrl }
    );
  },

  templatePublishRequested(p: { to: string[]; templateName: string; authorName: string; update: boolean; queueUrl: string }): EmailMessage {
    return message(
      p.to,
      `Template review: ${p.templateName}`,
      p.update ? "A public template has an update to review" : "A template is waiting for review",
      [`${p.authorName} ${p.update ? "sent a new version of" : "asked to publish"} the form template "${p.templateName}".`, "Open Template Review to preview it and approve or reject it."],
      { label: "Open Template Review", url: p.queueUrl }
    );
  },

  templateDecision(p: { to: string; name: string; templateName: string; decision: "approved" | "rejected" | "update-rejected" | "taken-down"; reason?: string; appUrl: string }): EmailMessage {
    const headline = { approved: "Your template is public", rejected: "Your template wasn't approved", "update-rejected": "Your template update wasn't approved", "taken-down": "Your template was taken down" }[p.decision];
    const line = {
      approved: `"${p.templateName}" was approved. Other teams can now find and use it.`,
      rejected: `"${p.templateName}" wasn't approved for the public library. It stays private to your account.`,
      "update-rejected": `The new version of "${p.templateName}" wasn't approved. The version already public stays as it is.`,
      "taken-down": `"${p.templateName}" was removed from the public library.`,
    }[p.decision];
    return message(
      p.to,
      `${headline}: ${p.templateName}`,
      headline,
      [`Hi ${p.name},`, line, ...(p.reason ? [`Reason: ${p.reason}`] : []), ...(p.decision === "approved" ? [] : ["You can edit the template and ask again."])],
      { label: "Open CompEpicurus", url: p.appUrl }
    );
  },

  ownershipTransferRequested(p: { to: string; toName: string; fromName: string; teamLabel: string; expiresInDays: number; appUrl: string }): EmailMessage {
    return message(
      p.to,
      `${p.fromName} wants to make you the owner of ${p.teamLabel}`,
      "Ownership transfer waiting for you",
      [`Hi ${p.toName},`, `${p.fromName} asked to transfer ownership of the ${p.teamLabel} CompEpicurus account to you. The owner can manage ownership and protections for the account; ${p.fromName} stays an admin.`, `Sign in to accept or decline. The request expires in ${p.expiresInDays} days.`],
      { label: "Review the request", url: p.appUrl }
    );
  },

  ownershipTransferred(p: { to: string; name: string; teamLabel: string; newOwnerName: string; forced: boolean; appUrl: string }): EmailMessage {
    return message(
      p.to,
      `Ownership of ${p.teamLabel} changed`,
      "Account ownership changed",
      [`Hi ${p.name},`, `${p.newOwnerName} is now the owner of the ${p.teamLabel} CompEpicurus account.${p.forced ? " This was a recovery transfer carried out by the platform owner." : ""}`, "If this wasn't expected, contact your team."],
      { label: "Open CompEpicurus", url: p.appUrl }
    );
  },
};
