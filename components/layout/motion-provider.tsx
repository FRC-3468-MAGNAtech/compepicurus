"use client";

import { MotionConfig } from "framer-motion";

/**
 * Makes every Framer Motion animation respect the OS "reduce motion" setting (P17):
 * with it on, transform and layout animations (the springs) are skipped, while opacity
 * fades still play. CSS animations are already handled in app/globals.css.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
