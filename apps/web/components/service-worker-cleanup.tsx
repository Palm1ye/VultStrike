"use client";

import { useEffect } from "react";

const STORAGE_KEY = "vs_sw_cleanup_v1";

export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const already = window.localStorage.getItem(STORAGE_KEY);
      if (already === "done") return;

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          registrations.forEach((registration) => {
            registration.unregister().catch(() => undefined);
          });
        });
      }

      if ("caches" in window) {
        window.caches.keys().then((keys) => {
          keys.forEach((key) => {
            window.caches.delete(key).catch(() => undefined);
          });
        });
      }

      window.localStorage.setItem(STORAGE_KEY, "done");
    } catch {
      // Best effort only.
    }
  }, []);

  return null;
}
