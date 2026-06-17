"use client";

// TEMPORARY boot-timing overlay (perf investigation, 2026-06-18). Operator reports
// ~2s app boot. Rather than guess the cost, read the browser Navigation Timing API
// on the real device and show the split — redirect chain vs server time (TTFB) vs
// download vs hydrate — so the dominant cost is fixed with data, not structure.
// ON by default; the operator screenshots one cold launch. Remove after measuring.

import { useEffect, useState } from "react";

export function BootTiming() {
  const [on, setOn] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(true);

    function read() {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (!nav) return;
      const ms = (n: number) => `${Math.max(0, Math.round(n))}ms`;
      const out = [
        `nav.type    ${nav.type}`,
        `redirect    ${ms(nav.redirectEnd - nav.redirectStart)}  (x${nav.redirectCount})`,
        `TTFB(srv)   ${ms(nav.responseStart - nav.requestStart)}`,
        `download    ${ms(nav.responseEnd - nav.responseStart)}`,
        `dom+hydrate ${ms(nav.domContentLoadedEventEnd - nav.responseEnd)}`,
        `to-load     ${ms(nav.loadEventEnd - nav.startTime)}`,
      ];
      for (const st of nav.serverTiming ?? []) out.push(`srv:${st.name}  ${ms(st.duration)}`);
      setLines(out);
    }

    // loadEventEnd is 0 until the load event fires — read after it completes.
    if (document.readyState === "complete") {
      window.setTimeout(read, 0);
    } else {
      window.addEventListener("load", () => window.setTimeout(read, 0), { once: true });
    }
  }, []);

  if (!on) return null;

  return (
    <div
      data-testid="boot-timing"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 2147483647,
        padding: "6px 8px",
        margin: 8,
        background: "rgba(0,0,0,0.82)",
        color: "#0ff",
        font: "11px/1.4 ui-monospace, Menlo, monospace",
        whiteSpace: "pre",
        borderRadius: 6,
        pointerEvents: "none",
      }}
    >
      {`boot timing\n${lines.length ? lines.join("\n") : "measuring…"}`}
    </div>
  );
}
