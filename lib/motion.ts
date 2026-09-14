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

export const pageTransitionVariants = {
  initial: { opacity: 0, y: 14, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.985 },
};

export const cardEntranceVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.97 },
  show: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...spring, delay: i * 0.05 },
  }),
};
