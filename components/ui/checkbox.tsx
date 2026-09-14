"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-[var(--glass-border)] bg-white/5 outline-none transition-colors duration-200 data-[state=checked]:border-transparent",
        className
      )}
      style={{
        background: "var(--glass-bg-strong)",
      }}
      {...props}
    >
      <CheckboxPrimitive.Indicator asChild forceMount>
        <motion.span
          initial={false}
          animate={{ scale: props.checked ? 1 : 0, opacity: props.checked ? 1 : 0 }}
          transition={springSnappy}
          className="flex h-full w-full items-center justify-center rounded-lg"
          style={{ background: "linear-gradient(135deg, var(--color-primary), var(--color-accent))" }}
        >
          <Check className="h-4 w-4 text-white" strokeWidth={3} />
        </motion.span>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
