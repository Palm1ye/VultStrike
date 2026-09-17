"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function GoogleAnalytics({ gaId }: { gaId?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasTrackedInitial = useRef(false);

  const search = searchParams?.toString();
  const url = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    if (!gaId) return;

    // Initial load is already tracked by the first gtag('config', gaId) call.
    if (!hasTrackedInitial.current) {
      hasTrackedInitial.current = true;
      return;
    }

    // Track client-side route changes.
    if (!window.gtag) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = (...args: unknown[]) => {
        window.dataLayer?.push(args);
      };
    }

    window.gtag("config", gaId, { page_path: url });
  }, [gaId, url]);

  if (!gaId) return null;

  return (
    <>
      <Script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
window.dataLayer = window.dataLayer || [];
function gtag(){window.dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${gaId}');
        `}
      </Script>
    </>
  );
}
