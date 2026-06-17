"use client";

// Spec 95 diagnostic overlay — TEMPORARY. After five failed fixes for the "screen
// broken after the keyboard closes" report the actual stale dimension is still
// unknown, and the operator (reasonably) didn't enable the flag, so the screenshots
// carry the symptom but not the numbers. Now ON BY DEFAULT so the very next
// screenshot of the broken screen carries the live iOS viewport metrics — that pins
// down which dimension is wrong in one round instead of a sixth blind guess. Tap the
// top-left corner 5x to dismiss it (persists). Remove once the real fix lands.

import { useEffect, useState } from "react";

function flagOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Default ON; only OFF when explicitly dismissed (localStorage vpdebug="0").
    return window.localStorage.getItem("vpdebug") !== "0";
  } catch {
    return true;
  }
}

function readMetrics(): string[] {
  const vv = window.visualViewport;
  const doc = document.documentElement;
  const main = document.querySelector("main");
  const mainRect = main?.getBoundingClientRect();
  const active = document.activeElement;
  const r = (n: number | undefined) => (n === undefined ? "—" : Math.round(n).toString());
  const appVh = doc.style.getPropertyValue("--app-vh") || "—";
  return [
    `innerHeight     ${r(window.innerHeight)}`,
    `vv.scale        ${vv ? vv.scale.toFixed(2) : "—"}`,
    `vv.height       ${r(vv?.height)}`,
    `vv.offsetTop    ${r(vv?.offsetTop)}`,
    `vv.pageTop      ${r(vv?.pageTop)}`,
    `--app-vh        ${appVh}`,
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

  // Enable gesture (always active, even when the overlay is off): a standalone iOS
  // PWA has no URL bar / console to set the flag, so 5 quick taps in the very
  // top-left corner toggle localStorage.vpdebug and reload. Cheap; no state.
  useEffect(() => {
    let taps: number[] = [];
    function onTap(e: PointerEvent) {
      if (e.clientX > 32 || e.clientY > 32) {
        taps = [];
        return;
      }
      const now = e.timeStamp;
      taps = taps.filter((t) => now - t < 1500);
      taps.push(now);
      if (taps.length < 5) return;
      taps = [];
      try {
        // Default ON; tapping toggles: if currently shown, persist OFF ("0"),
        // else clear the off-flag so it shows again.
        window.localStorage.setItem("vpdebug", flagOn() ? "0" : "1");
        window.location.reload();
      } catch {
        /* private mode / blocked storage — nothing to do */
      }
    }
    window.addEventListener("pointerdown", onTap, true);
    return () => window.removeEventListener("pointerdown", onTap, true);
  }, []);

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
      {`vpdebug #${tick}  (corner×5 = off)\n${lines.join("\n")}`}
    </div>
  );
}
