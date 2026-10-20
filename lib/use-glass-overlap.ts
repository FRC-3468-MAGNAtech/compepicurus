"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

// Any of the base/page-level glass surface classes — deliberately excludes
// glass-overlay itself (a floating surface stacked on another floating
// surface is an edge case we don't need to chase) and excludes the plain
// bg-black/N modal scrim Dialog uses (which carries none of these classes),
// so a dialog sitting over its own opaque backdrop is correctly detected as
// NOT glass-on-glass even though the backdrop itself blurs.
const BASE_GLASS_CLASS_PATTERN = /\bglass-(panel|card|strong|pill)\b/;

function hasGlassClass(el: Element): boolean {
  const className = el.className;
  return typeof className === "string" && BASE_GLASS_CLASS_PATTERN.test(className);
}

/**
 * Detects whether a floating glass surface (a dropdown, tooltip, popover —
 * anything positioned fixed/absolute above the rest of the page) is
 * currently rendered directly over another glass surface, by sampling what
 * `elementsFromPoint` actually finds underneath its own corners/center once
 * it's positioned. This is the real signal for "stacked translucency makes
 * text unreadable" rather than a per-component guess made ahead of time —
 * a surface floating only over plain background/blobs doesn't have that
 * problem and shouldn't need the adjustable treatment.
 */
export function useGlassOverlap(ref: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [overGlass, setOverGlass] = useState(false);

  useLayoutEffect(() => {
    if (!active) {
      // Deliberate: resets the result as soon as the surface closes, so a
      // stale "yes" from the last time it was open can't briefly flash when
      // it reopens somewhere else before the new measurement lands.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverGlass(false);
      return;
    }
    // Wait one frame so the floating element has been positioned/painted
    // before we sample what's underneath it.
    const raf = requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const samplePoints: [number, number][] = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + 2, rect.top + 2],
        [rect.right - 2, rect.bottom - 2],
      ];
      const found = samplePoints.some(([x, y]) =>
        document.elementsFromPoint(x, y).some((el) => !node.contains(el) && hasGlassClass(el))
      );
      setOverGlass(found);
    });
    return () => cancelAnimationFrame(raf);
  }, [active, ref]);

  return overGlass;
}
