export function BackgroundBlobs() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      {/* P32: the painted page (gradient and pride themes: the theme's sampled OKLCH stops; solid themes: just the background color).
          Gradient intensity (Settings > Appearance) is this layer's opacity over the plain background above. A sibling of the glass,
          never an ancestor, so it can't turn a blur off. */}
      <div aria-hidden className="absolute inset-0" data-testid="page-gradient" style={{ background: "var(--page-bg)", opacity: "var(--gradient-strength)" }} />
      <div
        className="bg-blob absolute -left-1/4 -top-1/4 h-[70vw] w-[70vw] rounded-full opacity-60 blur-3xl"
        style={{
          background: "radial-gradient(circle, var(--blob-1), transparent 70%)",
          animation: "drift-a 26s ease-in-out infinite",
        }}
      />
      <div
        className="bg-blob absolute -right-1/4 top-0 h-[60vw] w-[60vw] rounded-full opacity-50 blur-3xl"
        style={{
          background: "radial-gradient(circle, var(--blob-2), transparent 70%)",
          animation: "drift-b 32s ease-in-out infinite",
        }}
      />
      <div
        className="bg-blob absolute bottom-[-20%] left-1/4 h-[65vw] w-[65vw] rounded-full opacity-50 blur-3xl"
        style={{
          background: "radial-gradient(circle, var(--blob-3), transparent 70%)",
          animation: "drift-c 29s ease-in-out infinite",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(var(--glow), 0.08), transparent 60%)",
        }}
      />
    </div>
  );
}
