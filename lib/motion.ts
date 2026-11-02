import type { Transition } from "framer-motion";

export const spring: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 28,
  mass: 0.9,
};

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 22,
  mass: 0.7,
};

export const springSoft: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 26,
  mass: 1,
};

export const tapScale = { scale: 0.96 };
export const hoverScale = { scale: 1.03 };

// Page-level entrance: opacity plus a 4px nudge at most, and a plain tween
// (not a spring) so position can never overshoot. The bouncy springs above
// stay on buttons, cards, and toggles — not on where the page itself sits.
export const pageTransitionVariants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
};

export const pageTransition: Transition = { duration: 0.18, ease: "easeOut" };

// Kept small: these stack on top of the page fade-in, and a large child
// offset on top of it read as the whole page starting low (FIX1-1).
export const cardEntranceVariants = {
  hidden: { opacity: 0, y: 4, scale: 0.99 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...spring, delay: i * 0.05 },
  }),
};
