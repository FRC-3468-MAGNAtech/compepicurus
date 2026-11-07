// P24: while the practice workspace is fullscreen, only that element (and what's inside it) is visible, so a Dialog or dropdown rendered into <body> would open
// invisibly. Radix portals take a `container`; this gives them the fullscreen element when there is one, else the default (<body>).
export function portalContainer(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.fullscreenElement;
  return el instanceof HTMLElement ? el : undefined;
}
