"use client";

import { useState } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { motion } from "framer-motion";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function Switch({
  className,
  checked,
  defaultChecked,
  onCheckedChange,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked ?? false);
  const isControlled = checked !== undefined;
  const resolvedChecked = isControlled ? checked : internalChecked;

  return (
    <SwitchPrimitive.Root
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(v) => {
        if (!isControlled) setInternalChecked(v);
        onCheckedChange?.(v);
      }}
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
      {/* Position is driven entirely by Framer's `animate` x-offset — no CSS
          transform classes here, so there's only one system moving this
          element instead of the Tailwind translate-x utility and Framer's
          `layout` FLIP animation fighting over the same `transform`. */}
      <SwitchPrimitive.Thumb asChild>
        <motion.span
          animate={{ x: resolvedChecked ? 22 : 2 }}
          transition={spring}
          className="relative block h-[22px] w-[22px] rounded-full bg-white"
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.35)" }}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}
