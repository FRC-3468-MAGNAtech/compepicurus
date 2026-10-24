"use client";

import { createContext, useContext, useRef, useState } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useGlassOverlap } from "@/lib/use-glass-overlap";

// Radix's own Presence only recognizes CSS animations/transitions when
// deciding whether to keep a closed element mounted — it can't see Framer
// Motion's WAAPI-driven exit animation, so without this it unmounts
// SelectContent immediately and the exit animation never gets to play.
// `forceMount` bypasses Radix's presence entirely; we track `open` ourselves
// and let AnimatePresence own the mount/unmount lifecycle instead.
//
// IMPORTANT: SelectContent must still fully *unmount* while closed (not
// just be hidden via opacity) — Radix's Select.Content runs a mount-effect
// (`hideOthers`, for accessibility) that sets `pointer-events: none` on
// every OTHER element on the page the moment Content mounts, undoing it
// only on Content's *unmount*. A version of this file once force-mounted
// Content permanently (to fix SelectValue showing a blank label until
// first opened, see SelectValue below) and that cleanup then never ran
// again after the very first Select anywhere mounted, permanently
// disabling every click on the entire site. Don't repeat that — fix the
// blank-label issue at the call site (explicit `children` on
// `<SelectValue/>`) instead of by keeping Content mounted.
const SelectOpenContext = createContext(false);

export function Select({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isControlled = open !== undefined;
  const resolvedOpen = isControlled ? open : internalOpen;

  return (
    <SelectOpenContext.Provider value={resolvedOpen}>
      <SelectPrimitive.Root
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={(v) => {
          if (!isControlled) setInternalOpen(v);
          onOpenChange?.(v);
        }}
        {...props}
      />
    </SelectOpenContext.Provider>
  );
}

// Radix only resolves a label for the current value from a matching
// <SelectItem/>'s rendered <SelectItemText/> — which, since SelectContent
// below unmounts while closed, means the trigger shows nothing until the
// dropdown has been opened at least once. Callers must pass the current
// value's label as `children` explicitly (`<SelectValue>{label}</SelectValue>`)
// instead of relying on that auto-detection, so it's correct from the very
// first render. `placeholder` still applies whenever `children` is empty/undefined.
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-11 w-full items-center justify-between gap-2 rounded-2xl border border-[var(--glass-border)] bg-white/5 px-4 text-sm outline-none transition-shadow duration-300 focus:shadow-[0_0_0_3px_rgba(var(--glow),0.25)] data-[state=open]:shadow-[0_0_0_3px_rgba(var(--glow),0.25)]",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDown className="h-4 w-4 text-[var(--muted-foreground)]" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const open = useContext(SelectOpenContext);
  const contentRef = useRef<HTMLDivElement>(null);
  // Only shapes genuinely stacked over another glass surface should respond
  // to the shading slider — detected from what's actually rendered
  // underneath, not assumed just because this is a dropdown. See
  // lib/use-glass-overlap.ts.
  const overGlass = useGlassOverlap(contentRef, open);

  return (
    <SelectPrimitive.Portal>
      <AnimatePresence>
        {open && (
          <SelectPrimitive.Content
            position="popper"
            sideOffset={8}
            forceMount
            className={cn(
              "glass-overlay z-50 overflow-hidden rounded-2xl p-1 shadow-2xl",
              className
            )}
            {...props}
            asChild
          >
            <motion.div
              ref={contentRef}
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={spring}
              style={overGlass ? undefined : ({ "--glass-shade": 1 } as React.CSSProperties)}
            >
              <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
            </motion.div>
          </SelectPrimitive.Content>
        )}
      </AnimatePresence>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-xl px-3 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-white/10",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="ml-auto">
        <Check className="h-4 w-4 text-[var(--color-primary)]" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
