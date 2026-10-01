"use client";

import { useEffect } from "react";

/** Full page reload while a job is in progress (server-rendered status). */
export function JobAutoRefresh({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      window.location.reload();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [active]);

  return null;
}
