"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let active = true;

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        if (active) {
          void registration.update().catch(() => {});
        }
      } catch {
        // Gracefully ignore registration errors (e.g. insecure context or blocked SW)
      }
    };

    void registerServiceWorker();

    return () => {
      active = false;
    };
  }, []);

  return null;
}
