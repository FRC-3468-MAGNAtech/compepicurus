import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { AuthProvider } from "@/lib/auth";
import { GlassLayerProvider } from "@/lib/glass-layer";
import { BackgroundBlobs } from "@/components/layout/background-blobs";
import { MotionProvider } from "@/components/layout/motion-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CompEpicurus — FTC Scouting",
  description: "FTC Team 3468 MAGNAtech's scouting app.",
  // The manifest itself is app/manifest.ts. These make an iPhone "Add to Home Screen" install look right (P17).
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
  appleWebApp: { capable: true, title: "CompEpicurus", statusBarStyle: "black-translucent" },
};

// Mobile (P17): draw under the notch / home indicator (the bars use env(safe-area-inset-*)), and let the
// layout resize when the on-screen keyboard opens instead of the keyboard covering the page.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#17070c",
};

const themeInitScript = `
(function () {
  try {
    var theme = localStorage.getItem("compepicurus.theme") || "team";
    document.documentElement.setAttribute("data-theme", theme);
    var shade = parseFloat(localStorage.getItem("compepicurus.glass-shade"));
    if (shade >= 0.3 && shade <= 2) {
      document.documentElement.style.setProperty("--glass-shade", String(shade));
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="team"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider>
          {/* The glass level is saved per user, so it sits inside the auth provider (FIX3). */}
          <AuthProvider>
            <GlassLayerProvider>
              <MotionProvider>
                <BackgroundBlobs />
                {children}
              </MotionProvider>
            </GlassLayerProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
