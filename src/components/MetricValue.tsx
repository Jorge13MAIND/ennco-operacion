"use client";

import { useEffect, useState } from "react";

function formatMetric(value: number, format: "integer" | "mxn"): string {
  if (format === "mxn") {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
  }
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(value);
}

/**
 * Valor de métrica con count-up. El SSR y el primer render de cliente muestran
 * el valor final (cero hydration mismatch); la animación corre sólo post-mount
 * y sólo sin prefers-reduced-motion. El dato nunca se altera: sólo se recorre.
 */
export function MetricValue({ value, format = "integer" }: { value: number; format?: "integer" | "mxn" }) {
  const [animated, setAnimated] = useState<string | null>(null);

  useEffect(() => {
    if (value === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const started = performance.now();
    const duration = 1200;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - started) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimated(progress < 1 ? formatMetric(Math.round(value * eased), format) : null);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setAnimated(null);
    };
  }, [value, format]);

  return <>{animated ?? formatMetric(value, format)}</>;
}
