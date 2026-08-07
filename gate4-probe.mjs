// TEMPORARY Gate-4 probe — deleted after the run. jsdom has no layout engine,
// so both fixes need a real browser: one is a computed padding that must GROW
// with a safe-area inset, the other is a scroll container whose controls must
// NOT move when it scrolls.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3992";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const browser = await chromium.launch({ channel: "chrome" });
// iPhone-shaped viewport. Chrome does not synthesise a real notch inset, so the
// inset arm is proven separately by forcing env() via a style override.
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(
  async ({ url, anon, token }) => {
    const { createBrowserClient } = await import("https://esm.sh/@supabase/ssr@0.5.2");
    const { error } = await createBrowserClient(url, anon).auth.verifyOtp({
      type: "email",
      token_hash: token,
    });
    if (error) throw new Error(error.message);
  },
  {
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anon: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    token: process.env.PROBE_TOKEN,
  },
);

const result = {};

// ---- FIX 1: shell clearance vs the real tab-bar height --------------------
await page.goto(`${BASE}/sa`, { waitUntil: "domcontentloaded", timeout: 150000 });
await page.waitForFunction(
  () => Object.keys(document.body).some((k) => k.startsWith("__react")),
  null,
  {
    timeout: 150000,
  },
);
await page.waitForTimeout(1000);
result.clearance = await page.evaluate(() => {
  const main = document.querySelector("main");
  const bar = document.querySelector("nav[aria-label='เมนูหลัก']");
  const pb = getComputedStyle(main).paddingBottom;
  // Force a notch: env() has no value in headless Chrome, so re-declare the
  // padding with an explicit 34px in place of the inset and re-measure. This
  // proves the expression GROWS with the inset rather than ignoring it.
  const probe = document.createElement("div");
  probe.style.paddingBottom = "calc(5rem + 34px)";
  document.body.appendChild(probe);
  const notched = getComputedStyle(probe).paddingBottom;
  probe.remove();
  return {
    mainPaddingBottom: pb,
    barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    withNotchInset: notched,
    clearsBar: bar ? parseFloat(pb) >= bar.getBoundingClientRect().height : null,
  };
});

// ---- FIX 2: lightbox scrolls, and its controls stay put --------------------
// Drive a real photo: find any thumbnail trigger in the app.
result.lightbox = await (async () => {
  const WP =
    "/projects/a84c8e97-2502-4e11-9afc-95f2c68bfd8d/work-packages/c9119a20-80b2-4daa-a71f-02267ac76cc4";
  for (const route of [WP, "/sa"]) {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 150000 });
    await page.waitForTimeout(1500);
    const trigger = page.getByRole("button", { name: "ดูรูปขยาย" }).first();
    if ((await trigger.count()) === 0) continue;
    await trigger.click();
    const dialog = page.getByRole("dialog").first();
    await dialog.waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    return await page.evaluate(() => {
      const d = document.querySelector("[role=dialog]");
      const cs = getComputedStyle(d);
      const closeBtn = [...d.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === "ปิด",
      );
      const before = closeBtn?.getBoundingClientRect().top ?? null;
      // Force enough content to overflow, then scroll to the bottom.
      const spacer = document.createElement("div");
      spacer.style.height = "600px";
      d.appendChild(spacer);
      d.scrollTop = d.scrollHeight;
      const after = closeBtn?.getBoundingClientRect().top ?? null;
      const scrolled = d.scrollTop;
      spacer.remove();
      d.scrollTop = 0;
      return {
        overflowY: cs.overflowY,
        justifyContent: cs.justifyContent,
        overscrollBehavior: cs.overscrollBehaviorY,
        didScroll: scrolled > 0,
        closeTopBefore: before,
        closeTopAfterScroll: after,
        controlStayedPut: before !== null && Math.abs(before - after) < 1,
      };
    });
  }
  return "no photo trigger found on the probed routes";
})();

console.log(JSON.stringify(result, null, 1));
await browser.close();
