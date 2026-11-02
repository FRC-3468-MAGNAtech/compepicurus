"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { pageTransitionVariants, pageTransition } from "@/lib/motion";

/**
 * Fade-in only — no exit animation, deliberately no AnimatePresence.
 *
 * The previous version wrapped the page in an AnimatePresence (without
 * `mode="wait"`) with a y-offset slide and a spring exit. Without `wait`, the
 * *outgoing* page stays in the document flow for the whole exit spring while
 * the incoming page mounts right below it, so the new page rendered lower
 * than its final position and then snapped up when the old one unmounted —
 * the "content starts too low, then jumps" bug (FIX1-1). A keyed element that
 * simply fades in has nothing in flow to leave behind, and the offset is
 * tiny enough (see pageTransitionVariants) that it can't read as a jump.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <motion.div key={pathname} variants={pageTransitionVariants} initial="initial" animate="animate" transition={pageTransition}>
      {children}
    </motion.div>
  );
}
