"use client";

// Spec 95 diagnostic overlay — TEMPORARY. After three failed fixes for the
// "screen broken after the keyboard closes" report (paint nudge, snap-to-top,
// height relayout) the actual stale dimension is still unknown, so this prints the
// live iOS viewport metrics on the device. The operator opens the broken screen
// with ?vpdebug=1 (or localStorage.vpdebug="1"), closes the keyboard, and reads /
// screenshots the numbers — that pins down which dimension is wrong in one round
// instead of another blind guess. Inert (renders null) unless the flag is set, so
// it never reaches normal users. Remove once the real fix lands.

import { useEffect, useState } from "react";

function flagOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).has("vpdebug")) return true;
    return window.localStorage.getItem("vpdebug") === "1";
  } catch {
    return false;
  }
}

function readMetrics(): string[] {
  const vv = window.visualViewport;
  const doc = document.documentElement;
  const main = document.querySelector("main");
  const mainRect = main?.getBoundingClientRect();
  const active = document.activeElement;
  const r = (n: number | undefined) => (n === undefined ? "—" : Math.round(n).toString());
  return [
    `innerHeight     ${r(window.innerHeight)}`,
    `vv.height       ${r(vv?.height)}`,
    `vv.offsetTop    ${r(vv?.offsetTop)}`,
    `vv.pageTop      ${r(vv?.pageTop)}`,
    `doc.clientH     ${r(doc.clientHeight)}`,
    `body.rectH      ${r(document.body.getBoundingClientRect().height)}`,
    `main.rectH      ${r(mainRect?.height)}`,
    `main.clientH    ${r(main instanceof HTMLElement ? main.clientHeight : undefined)}`,
    `main.scrollH    ${r(main instanceof HTMLElement ? main.scrollHeight : undefined)}`,
    `main.scrollTop  ${r(main instanceof HTMLElement ? main.scrollTop : undefined)}`,
    `window.scrollY  ${r(window.scrollY)}`,
    `doc.scrollTop   ${r(doc.scrollTop)}`,
    `active          ${active ? active.tagName.toLowerCase() : "—"}`,
  ];
}

export function ViewportDebug() {
  const [on, setOn] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!flagOn()) return;
    // Client-only mount gate: the flag reads window, so we start false (matching
    // SSR) and flip on after hydration to avoid a mismatch. Temporary diagnostic.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(true);

    let n = 0;
    function update() {
      n += 1;
      setTick(n);
      setLines(readMetrics());
    }
    update();

    const vv = window.visualViewport;
    const events: Array<[EventTarget | null | undefined, string]> = [
      [window, "resize"],
      [window, "scroll"],
      [window, "orientationchange"],
      [document, "focusin"],
      [document, "focusout"],
      [vv, "resize"],
      [vv, "scroll"],
    ];
    for (const [target, type] of events) target?.addEventListener(type, update);
    return () => {
      for (const [target, type] of events) target?.removeEventListener(type, update);
    };
  }, []);

  if (!on) return null;

  return (
    <div
      data-testid="viewport-debug"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 2147483647,
        padding: "6px 8px",
        margin: 8,
        maxWidth: "60vw",
        background: "rgba(0,0,0,0.82)",
        color: "#0f0",
        font: "11px/1.35 ui-monospace, Menlo, monospace",
        whiteSpace: "pre",
        borderRadius: 6,
        pointerEvents: "none",
      }}
    >
      {`vpdebug #${tick}\n${lines.join("\n")}`}
    </div>
  );
}
