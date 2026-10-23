import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { AuthProvider } from "@/lib/auth";
import { GlassShadeProvider } from "@/lib/glass-shade";
import { BackgroundBlobs } from "@/components/layout/background-blobs";

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
          <GlassShadeProvider>
            <AuthProvider>
              <BackgroundBlobs />
              {children}
            </AuthProvider>
          </GlassShadeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
