// Spec 400 U2 Gate-3 real-flow probe. TEMPORARY.
// The claim under test is a COUNT difference between two roles, which is the
// only honest way to prove a roster read that RLS decides.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = "http://localhost:3401";
const link = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ type: "magiclink", email: env.DEV_PREVIEW_EMAIL }),
}).then((r) => r.json());

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
page.setDefaultTimeout(120_000);
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.evaluate(
  async ([url, anon, token]) => {
    document.cookie = "assumed_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    let mod;
    try {
      mod = await import("https://esm.sh/@supabase/ssr@0.5.2");
    } catch {
      mod = await import("https://cdn.jsdelivr.net/npm/@supabase/ssr@0.5.2/+esm");
    }
    await mod.createBrowserClient(url, anon).auth.verifyOtp({ type: "email", token_hash: token });
  },
  [env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, link.hashed_token],
);

const RANGE = "start=2026-08-01&end=2026-08-06";
const out = {};

async function probe(label, role) {
  if (role) {
    await page.evaluate((r) => {
      document.cookie = `assumed_role=${r}; path=/`;
    }, role);
  }
  await page.goto(`${BASE}/team/attendance?${RANGE}`, { waitUntil: "domcontentloaded" });
  out[label] = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")];
    const empty = rows.filter((tr) => !/\d\d:\d\d/.test(tr.textContent));
    return {
      rows: rows.length,
      emptyRows: empty.length,
      firstEmptyName:
        empty[0]?.querySelector("th")?.textContent.replace(/\s+/g, " ").trim() ?? null,
      // an absent row must carry 0 วัน and NO finding dot
      firstEmptyHasDot: (empty[0]?.querySelectorAll("td .bg-attn").length ?? 0) > 0,
      headerCount: document.body.textContent.match(/(\d+) คน ·/)?.[1] ?? null,
    };
  });
}

await probe("super_admin", null);
await probe("procurement", "procurement");
await probe("accounting", "accounting");
await page.evaluate(() => {
  document.cookie = "assumed_role=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

out.errors = errors;
console.log(JSON.stringify(out, null, 2));
await browser.close();
