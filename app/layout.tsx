import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { themeCss, themeInitScript as themeInitScriptSource } from "@/lib/theme-css";
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
  description: "A scouting app for FTC teams.",
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

// Every theme's variables, generated from the registry (lib/themes.ts) and the pre-paint script that picks the saved
// theme + mode (or the system's) before anything renders, so there is never a flash of the wrong theme (P18).
const themeStyles = themeCss();
const themeInitScript = themeInitScriptSource();

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="team"
      data-mode="dark"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <style id="theme-tokens" dangerouslySetInnerHTML={{ __html: themeStyles }} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* The theme, light/dark mode and glass level are all saved per user, so they sit inside the auth provider (FIX3, P18). */}
        <AuthProvider>
          <ThemeProvider>
            <GlassLayerProvider>
              <MotionProvider>
                <BackgroundBlobs />
                {children}
              </MotionProvider>
            </GlassLayerProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
