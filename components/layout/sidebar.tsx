"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight, LogOut, Trophy } from "lucide-react";
import { mainNav, secondaryNav, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";
import { Avatar } from "@/components/ui/avatar";
import { useMockAuth } from "@/lib/mock-auth";

function NavLink({
  item,
  collapsed,
  onNavigate,
  scope,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  scope: string;
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
              background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
              boxShadow: "0 8px 24px -6px rgba(var(--glow), 0.55)",
            }}
          />
        )}
        <Icon className="h-[18px] w-[18px] shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </motion.div>
    </Link>
  );
}

export function Sidebar({ mobileOpen, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const { name, role, logout } = useMockAuth();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    onClose?.();
    router.push("/");
  };

  return (
    <>
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 84 : 272 }}
        transition={spring}
        className="glass-panel sticky top-4 z-30 hidden h-[calc(100vh-2rem)] flex-col gap-4 overflow-hidden p-4 lg:flex"
      >
        <SidebarInner collapsed={collapsed} name={name} role={role} onLogout={handleLogout} scope="desktop" />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="glass-pill absolute -right-3 top-8 flex h-7 w-7 items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
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
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
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
                role={role}
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
  role,
  onLogout,
  onNavigate,
  scope,
}: {
  collapsed: boolean;
  name: string;
  role: string;
  onLogout: () => void;
  onNavigate?: () => void;
  scope: string;
}) {
  return (
    <>
      <Link href="/dashboard" className="flex items-center gap-2.5 px-1.5 py-1">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }}
        >
          <Trophy className="h-[18px] w-[18px] text-white" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">CompEpicurus</div>
            <div className="truncate text-[11px] text-[var(--muted-foreground)]">FTC 3468 MAGNAtech</div>
          </div>
        )}
      </Link>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto py-1">
        {mainNav.map((item) => (
          <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} scope={scope} />
        ))}
        <div className="my-2 h-px bg-[var(--glass-border)]" />
        {secondaryNav.map((item) => (
          <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} scope={scope} />
        ))}
      </nav>

      <div className="flex flex-col gap-3 border-t border-[var(--glass-border)] pt-3">
        {!collapsed && <ThemeSwitcher compact />}
        <div className="flex items-center gap-2.5 px-1">
          <Avatar name={name} size="sm" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{name}</div>
              <div className="truncate text-[11px] capitalize text-[var(--muted-foreground)]">{role}</div>
            </div>
          )}
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
