"use client";

import Link from "next/link";
import { useAnalyticsHref } from "@/lib/analytics/filter-context";

/**
 * A link between Analytics pages that carries the current filters in its
 * query string — the filters live in the URL, so any plain `<Link>` between
 * subpages would silently reset them. `params` adds page-specific params
 * (e.g. `{ team: "254", match: "Q3" }` for a Match Scout Analytics deep link).
 */
export function AnalyticsLink({
  href,
  params,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string; params?: Record<string, string> }) {
  const withFilters = useAnalyticsHref();
  return <Link href={withFilters(href, params)} {...props} />;
}
