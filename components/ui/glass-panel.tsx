"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";

export interface GlassPanelProps extends HTMLMotionProps<"div"> {
  interactive?: boolean;
  strong?: boolean;
}

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ className, interactive = false, strong = false, children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        className={cn(
          "glass-card p-6",
          strong && "glass-strong",
          interactive && "cursor-pointer glow-ring",
          className
        )}
        whileHover={interactive ? { scale: 1.02, y: -2 } : undefined}
        whileTap={interactive ? { scale: 0.985 } : undefined}
        transition={spring}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);
GlassPanel.displayName = "GlassPanel";
