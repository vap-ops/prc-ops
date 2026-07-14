// Spec 283 U1 — System Integrity Console (ตรวจระบบ), super_admin only.
// A keyed check registry, run live via run_integrity_checks(); the board lists EVERY
// check across all domains (the board doubles as the roadmap), greying the ones whose
// unit hasn't shipped. U1 wires the GL money checks; a scheduled hourly scan records
// history to integrity_check_runs (surfaced here as "last scan"). Read-only.

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { PageShell } from "@/components/features/chrome/page-shell";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";

import { runIntegrityNow } from "./actions";

export const metadata = { title: "ตรวจระบบ" };

type Check = {
  key: string;
  domain: string;
  title: string;
  severity: string;
  status: "green" | "amber" | "red" | "na";
  drift: number | null;
  offending_count: number | null;
  implemented: boolean;
  unit: string;
};

const DOMAIN_LABEL: Record<string, string> = {
  money: "บัญชี / การเงิน",
  access: "สิทธิ์ / ความปลอดภัย",
  identity: "ตัวตน / ทีมงาน",
  schema: "โครงสร้างระบบ",
};
const DOMAIN_ORDER = ["money", "access", "identity", "schema"];

// Field-first tokens only (raw Tailwind palette is banned + test-enforced).
const TILE: Record<Check["status"], string> = {
  green: "border-done-edge bg-done-soft text-done-ink",
  red: "border-danger-edge bg-danger-soft text-danger-ink",
  amber: "border-wait-edge bg-wait-soft text-ink",
  na: "border-edge bg-muted text-ink-muted",
};
const DOT: Record<Check["status"], string> = {
  green: "bg-done",
  red: "bg-danger",
  amber: "bg-attn",
  na: "bg-ink-muted",
};

function fmtScan(iso: string | null | undefined): string {
  if (!iso) return "ยังไม่เคยตรวจ";
  return iso.replace("T", " ").slice(0, 16);
}

export default async function IntegrityPage() {
  await requireRole(["super_admin"]);
  const supabase = await createClient();

  const [checksRes, lastRunRes] = await Promise.all([
    supabase.rpc("run_integrity_checks"),
    supabase
      .from("integrity_check_runs")
      .select("ran_at")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const rows = (checksRes.data ?? []) as Check[];
  const lastScan = fmtScan(lastRunRes.data?.ran_at);

  const red = rows.filter((r) => r.status === "red").length;
  const amber = rows.filter((r) => r.status === "amber").length;
  const green = rows.filter((r) => r.status === "green").length;
  const pending = rows.filter((r) => r.status === "na").length;

  const byDomain = DOMAIN_ORDER.map((domain) => ({
    domain,
    checks: rows.filter((r) => r.domain === domain),
  })).filter((g) => g.checks.length > 0);

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-lg font-semibold">ตรวจระบบ</h1>
      </DetailHeader>

      <section className={`mx-auto flex w-full ${PAGE_MAX_W} flex-col gap-5 px-5 py-6`}>
        {/* summary + run-now */}
        <div className="border-edge bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 text-sm font-medium">
              <span className={red > 0 ? "text-danger" : "text-done"}>
                {red > 0 ? `⛔ ${red} รายการผิดปกติ` : "✅ ปกติทั้งหมด"}
              </span>
              {amber > 0 && <span className="text-ink-secondary">🟡 {amber} เฝ้าระวัง</span>}
            </div>
            <p className="text-ink-secondary text-xs">
              ตรวจแล้ว {green + red + amber} รายการ · รอเปิดใช้อีก {pending} · อัปเดตล่าสุด{" "}
              {lastScan}
            </p>
          </div>
          <form action={runIntegrityNow}>
            <button
              type="submit"
              className="border-edge bg-card text-ink rounded-xl border px-4 py-2 text-sm font-medium"
            >
              ตรวจเดี๋ยวนี้
            </button>
          </form>
        </div>

        {/* board — one card per domain */}
        {byDomain.map(({ domain, checks }) => (
          <section key={domain} className="flex flex-col gap-2">
            <h2 className="text-ink-secondary px-1 text-xs font-semibold tracking-wide uppercase">
              {DOMAIN_LABEL[domain] ?? domain}
            </h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {checks.map((c) => (
                <li
                  key={c.key}
                  className={`flex items-start gap-3 rounded-xl border p-3 ${TILE[c.status]}`}
                >
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[c.status]}`}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{c.title}</span>
                    {c.status === "red" && (
                      <span className="text-xs">
                        พบปัญหา
                        {c.offending_count != null ? ` ${c.offending_count} รายการ` : ""}
                        {c.drift != null && c.offending_count == null
                          ? ` (ส่วนต่าง ${c.drift})`
                          : ""}
                      </span>
                    )}
                    {c.status === "na" && <span className="text-xs">ยังไม่เปิดใช้ · {c.unit}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </PageShell>
  );
}
