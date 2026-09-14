"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { springSnappy } from "@/lib/motion";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]",
  {
    variants: {
      variant: {
        primary:
          "text-[var(--color-primary-foreground)] shadow-[0_8px_24px_-6px_rgba(var(--glow),0.55)]",
        glass: "glass-pill text-[var(--foreground)] hover:shadow-[0_0_24px_2px_rgba(var(--glow),0.3)]",
        ghost: "text-[var(--foreground)] hover:bg-white/8",
        outline: "border border-[var(--glass-border)] text-[var(--foreground)] hover:bg-white/6",
        danger: "bg-red-500/90 text-white shadow-[0_8px_24px_-6px_rgba(239,68,68,0.55)]",
      },
      size: {
        sm: "h-8 px-3.5 text-xs",
        md: "h-10 px-5 text-sm",
        lg: "h-12 px-7 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "children">,
    VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, style, children, ...props }, ref) => {
    const isPrimary = variant === "primary" || variant === undefined;
    return (
      <motion.button
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        style={
          isPrimary
            ? {
                background:
                  "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
                ...style,
              }
            : style
        }
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        transition={springSnappy}
        {...props}
      >
        {children}
      </motion.button>
    );
  }
);
Button.displayName = "Button";
