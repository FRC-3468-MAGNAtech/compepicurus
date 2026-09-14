"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { motion } from "framer-motion";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "group relative h-7 w-12 shrink-0 rounded-full border border-[var(--glass-border)] outline-none transition-[background-color,border-color] duration-300 data-[state=checked]:border-transparent",
        className
      )}
      style={{ background: "var(--glass-bg-strong)" }}
      {...props}
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-data-[state=checked]:opacity-100"
        style={{ background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }}
      />
      <SwitchPrimitive.Thumb asChild>
        <motion.span
          layout
          transition={spring}
          className="relative block h-[22px] w-[22px] translate-x-0.5 rounded-full bg-white data-[state=checked]:translate-x-[22px]"
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.35)" }}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}
