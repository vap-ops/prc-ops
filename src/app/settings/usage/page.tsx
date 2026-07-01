// Spec 244 U1b-2 / ADR 0068 (amended, Tier B) — the VISIBLE payoff of the SA
// usage tracker: a super_admin read of per-SA DAU + screen time over the last 14
// days, from the usage_daily rollup. super_admin-only (spec 244 §9): the
// usage_daily RLS "super_admin or own" policy already permits the all-rows read,
// so this uses the RLS-scoped session client (no admin client). Framing is
// PROTECTIVE (ADR 0068 §5) — a "who's using it / who might need help" support
// view, not a productivity ranking; the per-SA list sorts by name, not by usage.
// Numbers start empty and accrue as field SAs use the app over days (the cron
// rolls up yesterday each morning).

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { formatScreenTime, summarizeUsage, type UsageDailyRow } from "@/lib/usage/usage-view";

export const metadata = { title: "การใช้งานแอป (หน้างาน)" };

const WINDOW_DAYS = 14;

// The last N calendar days (UTC, matching usage_daily.day), oldest -> newest.
function buildWindow(now: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// 'YYYY-MM-DD' -> 'DD/MM' for compact Thai display.
function ddmm(day: string | null): string {
  if (!day) return "—";
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

export default async function UsagePage() {
  await requireRole(["super_admin"]);

  const windowDays = buildWindow(new Date(), WINDOW_DAYS);
  const windowStart = windowDays[0]!;

  const supabase = await createClient();
  const [usageRes, usersRes] = await Promise.all([
    supabase
      .from("usage_daily")
      .select("actor_id, day, sessions, active, screen_time_ms")
      .gte("day", windowStart)
      .order("day", { ascending: true }),
    supabase.from("users").select("id, full_name, role"),
  ]);

  const users = new Map((usersRes.data ?? []).map((u) => [u.id, u]));

  // Keep only site_admin actors — this is the on-site SA usage view (spec 244 D2).
  const rows: UsageDailyRow[] = (usageRes.data ?? []).flatMap((r) => {
    const u = users.get(r.actor_id);
    if (!u || u.role !== "site_admin") return [];
    return [
      {
        actorId: r.actor_id,
        name: u.full_name?.trim() || "(ไม่มีชื่อ)",
        day: r.day,
        sessions: r.sessions,
        active: r.active,
        screenTimeMs: r.screen_time_ms,
      },
    ];
  });

  const { dau, perSa, peakDau, totalActiveSas } = summarizeUsage(rows, windowDays);

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-xl font-semibold tracking-tight">การใช้งานแอป (หน้างาน)</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <p className="text-ink-secondary text-meta">
          ดูว่าทีมงานหน้างาน (SA) เปิดใช้แอปมากน้อยแค่ไหนในช่วง {WINDOW_DAYS} วันที่ผ่านมา
          เพื่อช่วยเหลือคนที่อาจ ติดขัด — ไม่ใช่การจัดอันดับหรือวัดผลงาน
          เวลาใช้งานคือช่วงที่เปิดแอปค้างไว้เท่าที่วัดได้
        </p>

        {perSa.length === 0 ? (
          <EmptyNotice>
            ยังไม่มีข้อมูลการใช้งาน — จะเริ่มสะสมเมื่อทีมงานหน้างานเปิดใช้แอปในแต่ละวัน
          </EmptyNotice>
        ) : (
          <>
            {/* Headline tiles */}
            <div className="grid grid-cols-2 gap-3">
              <Tile
                label="ผู้ใช้งานที่ active"
                value={`${totalActiveSas} คน`}
                hint={`ใน ${WINDOW_DAYS} วัน`}
              />
              <Tile label="สูงสุดต่อวัน (DAU)" value={`${peakDau} คน`} hint="วันที่ใช้มากที่สุด" />
            </div>

            {/* DAU per day — a plain proportional bar, newest at the bottom */}
            <div className="flex flex-col gap-2">
              <h2 className="text-meta text-ink-secondary font-semibold">ผู้ใช้งานต่อวัน</h2>
              <div className="border-edge bg-card rounded-control flex flex-col gap-1.5 border px-4 py-3">
                {dau.map((p) => (
                  <div key={p.day} className="flex items-center gap-3">
                    <span className="text-ink-secondary text-meta w-12 shrink-0 font-mono">
                      {ddmm(p.day)}
                    </span>
                    <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                      <div
                        className="bg-done h-full rounded-full"
                        style={{ width: peakDau > 0 ? `${(p.count / peakDau) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="text-ink text-meta w-6 shrink-0 text-right tabular-nums">
                      {p.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Per-SA rollup */}
            <div className="flex flex-col gap-2">
              <h2 className="text-meta text-ink-secondary font-semibold">รายคน (เรียงตามชื่อ)</h2>
              <div className="border-edge bg-card rounded-control divide-edge divide-y border">
                {perSa.map((p) => (
                  <div
                    key={p.actorId}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-ink text-body truncate font-semibold">{p.name}</span>
                      <span className="text-ink-secondary text-meta">
                        ใช้งาน {p.activeDays}/{WINDOW_DAYS} วัน · {p.totalSessions} ครั้ง · ล่าสุด{" "}
                        {ddmm(p.lastActiveDay)}
                      </span>
                    </div>
                    <span className="text-ink text-meta shrink-0 tabular-nums">
                      {formatScreenTime(p.totalScreenTimeMs)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>
    </PageShell>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border-edge bg-card rounded-control flex flex-col gap-0.5 border px-4 py-3">
      <span className="text-ink-secondary text-meta">{label}</span>
      <span className="text-ink text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-ink-secondary text-meta">{hint}</span>
    </div>
  );
}
