import { pageForPath } from "@/lib/page-access/pages";

/**
 * P26: hides the nav items a person can't open. An item whose route no registered page owns (Team Settings, say) is kept; with
 * no signed-in person (`can` null: only the browser-test fixture) nothing is hidden. The same `pageForPath` the route guard uses,
 * so the nav and the guard can't disagree.
 */
export function visibleNav<T extends { href: string }>(items: T[], can: ((pageId: string) => boolean) | null): T[] {
  if (!can) return items;
  return items.filter((item) => {
    const page = pageForPath(item.href);
    return !page || can(page.id);
  });
}
