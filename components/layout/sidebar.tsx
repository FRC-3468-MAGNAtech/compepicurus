"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight, LogOut, Trophy } from "lucide-react";
import { mainNav, secondaryNav, type NavItem } from "@/lib/nav";
import { visibleNav } from "@/lib/page-access/nav";
import { useAccessUser, usePageAccess } from "@/lib/page-access/store";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";
import { ColorModeToggle } from "@/components/theme/color-mode-toggle";
import { ConnectionChip } from "@/components/layout/connection-chip";
import { FieldTeamSwitcher } from "@/components/layout/field-team-switcher";
import { useFieldTeams } from "@/lib/field-teams-context";
import { usePermissions } from "@/lib/permissions";
import { usePendingApplicationCount } from "@/lib/applications-client";
import { GlassLayerButton } from "@/components/theme/glass-layer-slider";
import type { ConnectionNotice } from "@/lib/connection-notice";
import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth";
import { getRole } from "@/lib/roles";
import { useChangelogUnread } from "@/lib/changelog/store";

function NavLink({
  item,
  collapsed,
  onNavigate,
  scope,
  unread = false,
  count = 0,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  scope: string;
  /** P14: show the "something new" dot (Changelog). Hidden while you're on the page itself. */
  unread?: boolean;
  /** P20: a count badge (the platform owner's pending applications on Admin Panel). */
  count?: number;
}) {
  const pathname = usePathname();
  const active = item.matchPrefix ? pathname.startsWith(item.href) : pathname === item.href;
  const Icon = item.icon;

  return (
    <Link href={item.href} onClick={onNavigate} className="relative block">
      <motion.div
        whileHover={{ x: collapsed ? 0 : 3 }}
        transition={spring}
        className={cn(
          "relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition-colors duration-200",
          active
            ? "text-[var(--color-primary-foreground)]"
            : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/6"
        )}
      >
        {active && (
          <motion.div
            layoutId={`sidebar-active-pill-${scope}`}
            transition={spring}
            className="absolute inset-0 -z-10 rounded-2xl"
            style={{
              background: "var(--theme-gradient)",
              boxShadow: "0 8px 24px -6px rgba(var(--glow), 0.55)",
            }}
          />
        )}
        <span className="relative shrink-0">
          <Icon className="h-[18px] w-[18px]" />
          {unread && !active && collapsed && <UnreadDot className="absolute -right-1 -top-1" />}
          {count > 0 && collapsed && <CountBadge count={count} className="absolute -right-2 -top-2" />}
        </span>
        {!collapsed && <span className="truncate">{item.label}</span>}
        {unread && !active && !collapsed && <UnreadDot className="ml-auto" />}
        {count > 0 && !collapsed && <CountBadge count={count} className="ml-auto" />}
      </motion.div>
    </Link>
  );
}

/** P20: "N waiting". Always the accent fill with its guarded on-accent text, so it stays legible in every theme. */
function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span className={cn("flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] px-1.5 text-[10px] font-semibold tabular-nums text-[var(--color-primary-foreground)]", className)} data-testid="admin-count">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> applications waiting</span>
    </span>
  );
}

function UnreadDot({ className }: { className?: string }) {
  return (
    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--color-accent)] shadow-[0_0_10px_2px_rgba(var(--glow),0.7)]", className)}>
      <span className="sr-only">New updates</span>
    </span>
  );
}

export function Sidebar({ mobileOpen, onClose, connection = null }: { mobileOpen?: boolean; onClose?: () => void; connection?: ConnectionNotice | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const { profile, logout } = useAuth();
  const router = useRouter();
  const name = profile?.name ?? "";
  const isAdmin = profile?.isAdmin ?? false;
  // P26: the nav hides pages this person can't open (the same check as the route guard). The Admin Panel is the admin-only page.
  const pageAccess = usePageAccess();
  const accessUser = useAccessUser();
  const canOpen = accessUser ? pageAccess.can : null;
  const visibleSecondaryNav = visibleNav(
    secondaryNav.filter((item) => item.href !== "/admin" || isAdmin),
    canOpen
  );
  const changelogUnread = useChangelogUnread(profile?.teamId ?? null, profile?.lastSeenChangelogAt);

  const handleLogout = () => {
    void logout();
    onClose?.();
    router.push("/");
  };

  return (
    <>
      {/* The outer aside only positions and sizes; the glass panel (which must clip its scrolling content) is an inner
          box, and the collapse arrow is a sibling of it. That's what lets the arrow straddle the edge: with it inside the
          overflow-hidden glass panel it was cut in half (P18). */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 84 : 272 }}
        transition={spring}
        className="sticky top-4 z-30 hidden h-[calc(100dvh-2rem)] shrink-0 lg:block"
      >
        <div className="glass-panel flex h-full flex-col gap-4 overflow-hidden p-4">
          <SidebarInner
            collapsed={collapsed}
            name={name}
            primaryRole={profile?.primaryRole}
            navItems={visibleSecondaryNav}
            changelogUnread={changelogUnread}
            connection={connection}
            onLogout={handleLogout}
            scope="desktop"
          />
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          data-testid="sidebar-collapse"
          className="glass-pill touch-compact absolute -right-3.5 top-8 z-10 flex h-7 w-7 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </button>
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={spring}
              className="absolute inset-0 bg-black/50 scrim-blur"
              onClick={onClose}
            />
            <motion.aside
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              transition={spring}
              className="glass-panel absolute left-3 top-3 bottom-3 flex w-[272px] flex-col gap-4 overflow-y-auto p-4"
            >
              <SidebarInner
                collapsed={false}
                name={name}
                primaryRole={profile?.primaryRole}
                navItems={visibleSecondaryNav}
          changelogUnread={changelogUnread}
          connection={connection}
                onLogout={handleLogout}
                onNavigate={onClose}
                scope="mobile"
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function SidebarInner({
  collapsed,
  name,
  primaryRole,
  navItems,
  changelogUnread,
  connection,
  onLogout,
  onNavigate,
  scope,
}: {
  collapsed: boolean;
  name: string;
  primaryRole?: string;
  navItems: NavItem[];
  changelogUnread: boolean;
  connection: ConnectionNotice | null;
  onLogout: () => void;
  onNavigate?: () => void;
  scope: string;
}) {
  const role = primaryRole ? getRole(primaryRole) : null;
  const { profile: me } = useAuth();
  const { accountName } = useFieldTeams();
  // P20: the platform owner sees how many team applications are waiting, on the Admin Panel item.
  const { isPlatformOwner } = usePermissions();
  const pendingApplications = usePendingApplicationCount(isPlatformOwner);
  const pageAccess = usePageAccess();
  const accessUser = useAccessUser();
  const canOpen = accessUser ? pageAccess.can : null;
  return (
    <>
      {/* P19: the team line is data-driven now (it used to be hard-coded): the account's optional name under the
          wordmark, and the active FTC team (number + name, with a switcher when assigned to several) below it. */}
      <div className="flex flex-col gap-2">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-1.5 py-1">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "var(--theme-gradient)" }}
          >
            <Trophy className="h-[18px] w-[18px] text-[var(--color-primary-foreground)]" />
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">CompEpicurus</div>
              {accountName && <div className="truncate text-[11px] text-[var(--muted-foreground)]">{accountName}</div>}
            </div>
          )}
        </Link>
        <FieldTeamSwitcher collapsed={collapsed} />
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto py-1">
        {visibleNav(mainNav, canOpen).map((item) => (
          <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} scope={scope} />
        ))}
        <div className="my-2 h-px bg-[var(--glass-border)]" />
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} scope={scope} unread={item.href === "/changelog" && changelogUnread} count={item.href === "/admin" ? pendingApplications : 0} />
        ))}
      </nav>

      <div className="flex flex-col gap-3 border-t border-[var(--glass-border)] pt-3">
        {/* P18: the internet status has its own always-visible spot (solid backing, no layout shift), and the theme picker
            is gone from here: the sun/moon is only the light/dark mode, the droplet is the glass slider. */}
        <div className={cn("flex", collapsed ? "justify-center" : "")}>
          <ConnectionChip connection={connection} collapsed={collapsed} />
        </div>
        <div className={cn("flex items-center gap-2", collapsed ? "flex-col" : "justify-center")}>
          <ColorModeToggle compact />
          <GlassLayerButton compact />
        </div>
        <div className="flex items-center gap-2.5 px-1">
          {/* P25: the name and picture open your profile. */}
          <Link href="/profile" onClick={onNavigate} aria-label="Your profile" className={cn("flex min-w-0 items-center gap-2.5", !collapsed && "flex-1")}>
            <Avatar name={name} size="sm" avatar={me?.avatar} />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{name}</div>
                {role && <div className={cn("mt-0.5 inline-block truncate rounded-full px-2 py-0.5 text-[10px] font-medium", role.className)}>{role.label}</div>}
              </div>
            )}
          </Link>
          <button
            onClick={onLogout}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] transition-colors hover:bg-white/8 hover:text-[var(--foreground)]"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
