import "./globals.css";
import type { Metadata } from "next";
import { LanguageProvider } from "@/components/language-provider";
import { AppStateProvider } from "@/components/app-state-provider";
import { SiteHeader } from "@/components/site-header";
import { MatchmakingModalProvider } from "@/components/matchmaking-modal-provider";
import { ServiceWorkerCleanup } from "@/components/service-worker-cleanup";
import { GoogleAnalytics } from "@/components/google-analytics";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "VultStrike Arena — Counter-Strike 2 Competitive Hub",
  description:
    "VultStrike Arena lets you queue for 1v1, 2v2, and 3v3 CS2 matches, track rankings, and earn rewards with zero server hassle",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gaId = process.env.NEXT_PUBLIC_GA_ID?.trim() || undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-black text-white">
        <GoogleAnalytics gaId={gaId} />
        <LanguageProvider>
          <AppStateProvider>
            <MatchmakingModalProvider>
              <ServiceWorkerCleanup />
              <div className="noise-overlay min-h-screen flex flex-col">
                <SiteHeader />
                <div className="flex-1">{children}</div>
                <SiteFooter />
              </div>
            </MatchmakingModalProvider>
          </AppStateProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
