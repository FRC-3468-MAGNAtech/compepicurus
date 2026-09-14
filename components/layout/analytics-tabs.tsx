"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { analyticsNav } from "@/lib/nav";
import { spring } from "@/lib/motion";

export function AnalyticsTabs() {
  const pathname = usePathname();

  return (
    <div className="glass-pill mb-6 flex w-full flex-wrap items-center gap-1 overflow-x-auto p-1.5">
      {analyticsNav.map((item) => {
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} className="relative">
            <motion.div
              whileHover={{ scale: active ? 1 : 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={spring}
              className={`relative z-10 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 ${
                active ? "text-[var(--color-primary-foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="analytics-tab-pill"
                  transition={spring}
                  className="absolute inset-0 -z-10 rounded-full"
                  style={{
                    background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
                    boxShadow: "0 4px 18px -4px rgba(var(--glow), 0.6)",
                  }}
                />
              )}
              <span className="relative">{item.label}</span>
            </motion.div>
          </Link>
        );
      })}
    </div>
  );
}
