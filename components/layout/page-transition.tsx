"use client";

import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { pageTransitionVariants, springSoft } from "@/lib/motion";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Deliberately no `mode="wait"`: that mode blocks mounting the new page
  // until the outgoing one's exit animation fully resolves, so anything
  // that stalls that exit (a tab losing focus mid-animation, framer-motion
  // missing a tick) leaves the new page invisible until something else
  // forces a re-render — exactly the "page doesn't load until I click"
  // symptom. Letting enter/exit run independently means the new page
  // always appears on schedule regardless of what the old one is doing.
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={pathname}
        variants={pageTransitionVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={springSoft}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
