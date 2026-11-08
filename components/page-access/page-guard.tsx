"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { NoAccessScreen, type RequestStatus } from "@/components/page-access/no-access-screen";
import { Shimmer } from "@/components/ui/shimmer";
import { useAuth } from "@/lib/auth";
import { pageForPath, type PageDef } from "@/lib/page-access/pages";
import { requestPageAccess, usePageAccess, usePageAccessRequests } from "@/lib/page-access/store";

/**
 * P26: the route guard. Wraps the signed-in app's pages: a path owned by a registered page the person can't open shows the
 * no-access screen (never an error or a blank page); every other path (open pages, and routes no page owns) renders as it
 * always did. Restricted pages wait for the access doc (a skeleton, not a flash of the page).
 */
export function PageGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can, loaded } = usePageAccess();
  const page = pageForPath(pathname);

  if (!page || page.access === "open") return <>{children}</>;
  if (!loaded) return <Shimmer className="h-64" />;
  if (can(page.id)) return <>{children}</>;
  return <ConnectedNoAccess page={page} />;
}

function ConnectedNoAccess({ page }: { page: PageDef }) {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { requests } = usePageAccessRequests(teamId, { all: false, uid: user?.uid ?? null });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = requests.find((r) => r.pageId === page.id);
  const status: RequestStatus = mine ? mine.status : "none";

  const send = async () => {
    if (!user || !profile) return;
    setSending(true);
    setError(null);
    try {
      await requestPageAccess({ teamId: profile.teamId, uid: user.uid, name: profile.name }, page.id);
    } catch {
      setError("Couldn't send that request. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  return <NoAccessScreen pageTitle={page.title} adminOnly={page.access === "admin"} status={status} sending={sending} error={error} onRequest={() => void send()} />;
}
