"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-11 w-full rounded-2xl border border-[var(--glass-border)] bg-white/5 px-4 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] transition-shadow duration-300",
          "focus:shadow-[0_0_0_3px_rgba(var(--glow),0.25),0_0_24px_2px_rgba(var(--glow),0.2)] focus:border-transparent",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-2xl border border-[var(--glass-border)] bg-white/5 px-4 py-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] transition-shadow duration-300",
        "focus:shadow-[0_0_0_3px_rgba(var(--glow),0.25),0_0_24px_2px_rgba(var(--glow),0.2)] focus:border-transparent",
        className
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]", className)}
      {...props}
    />
  );
}
