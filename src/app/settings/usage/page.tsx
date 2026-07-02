// Spec 244 U1b-2 + U1c / ADR 0068 (amended, Tier B) — the VISIBLE payoff of the
// usage tracker: a super_admin read of per-user DAU + screen time over the last 14
// days, from the usage_daily rollup. U1c widened it from SA-only to ALL internal
// roles (external client/contractor portals excluded). super_admin-only (spec 244
// §9): the usage_daily RLS "super_admin or own" policy already permits the all-rows
// read, so this uses the RLS-scoped session client (no admin client). Framing is
// PROTECTIVE (ADR 0068 §5) — a "who's using it / who might need help" support view,
// not a productivity ranking; the list sorts by name, not by usage. Numbers start
// empty and accrue as staff use the app over days (the cron rolls up yesterday).

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { formatScreenTime, summarizeUsage, type UsageDailyRow } from "@/lib/usage/usage-view";

export const metadata = { title: "การใช้งานแอป" };

const WINDOW_DAYS = 14;

// External portal tiers are out of scope (spec 244 U1c) — the read is internal staff.
const EXTERNAL_ROLES = new Set(["client", "contractor"]);

// Spec 244 U3 — the friction subset of interaction_event_type (mirrors the enum).
// Counted per person as a needs-help signal. Friction events are low-volume (rare,
// unlike heartbeats), so a raw RLS read + a JS count is fine for this rarely-loaded
// super_admin view at current scale; if the volume ever approaches the PostgREST page
// cap, move to a partial index + an aggregation RPC (a documented scale-up path).
const FRICTION_TYPES = [
  "js_error",
  "upload_fail",
  "validation_error",
  "form_abandon",
  "rage_tap",
] as const;

const roleLabel = (r: string): string => (USER_ROLE_LABEL as Record<string, string>)[r] ?? r;

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
  const [usageRes, usersRes, frictionRes] = await Promise.all([
    supabase
      .from("usage_daily")
      .select("actor_id, day, sessions, active, screen_time_ms")
      .gte("day", windowStart)
      .order("day", { ascending: true }),
    supabase.from("users").select("id, full_name, role"),
    supabase
      .from("interaction_events")
      .select("actor_id")
      .in("event_type", FRICTION_TYPES)
      .gte("created_at", `${windowStart}T00:00:00.000Z`),
  ]);

  const users = new Map((usersRes.data ?? []).map((u) => [u.id, u]));

  // Per-actor friction counts over the window (a needs-help signal, spec 244 U3).
  const frictionByActor = new Map<string, number>();
  for (const e of frictionRes.data ?? []) {
    if (!e.actor_id) continue;
    frictionByActor.set(e.actor_id, (frictionByActor.get(e.actor_id) ?? 0) + 1);
  }

  // All INTERNAL staff roles (spec 244 U1c) — exclude the external client/contractor
  // portal tiers (they aren't captured either, but guard the read defensively).
  const rows: UsageDailyRow[] = (usageRes.data ?? []).flatMap((r) => {
    const u = users.get(r.actor_id);
    if (!u || EXTERNAL_ROLES.has(u.role)) return [];
    return [
      {
        actorId: r.actor_id,
        name: u.full_name?.trim() || "(ไม่มีชื่อ)",
        role: u.role,
        day: r.day,
        sessions: r.sessions,
        active: r.active,
        screenTimeMs: r.screen_time_ms,
      },
    ];
  });

  // Spec 244 U3: friction is read live (through today), but usage_daily lags a day
  // (the rollup cron runs 03:30 UTC). A person whose only window activity is today —
  // before the rollup — has friction but no usage_daily row yet. That is a STRONG
  // needs-help signal (friction + near-zero engagement, e.g. a new SA's first day),
  // so surface them with zero engagement rather than dropping them from the list.
  const seen = new Set(rows.map((r) => r.actorId));
  for (const actorId of frictionByActor.keys()) {
    if (seen.has(actorId)) continue;
    const u = users.get(actorId);
    if (!u || EXTERNAL_ROLES.has(u.role)) continue;
    rows.push({
      actorId,
      name: u.full_name?.trim() || "(ไม่มีชื่อ)",
      role: u.role,
      day: windowStart,
      sessions: 0,
      active: false,
      screenTimeMs: 0,
    });
  }

  const { dau, perSa, peakDau, totalActiveSas, totalFriction } = summarizeUsage(
    rows,
    windowDays,
    frictionByActor,
  );

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-xl font-semibold tracking-tight">การใช้งานแอป</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <p className="text-ink-secondary text-meta">
          ดูว่าผู้ใช้แต่ละ role เปิดใช้แอปมากน้อยแค่ไหนในช่วง {WINDOW_DAYS} วันที่ผ่านมา และเจอ
          “จุดสะดุด” (error / อัปโหลดไม่ได้ / กดรัว ๆ) กี่ครั้ง เพื่อช่วยเหลือคนที่อาจติดขัด —
          ไม่ใช่การจัดอันดับหรือวัดผลงาน เวลาใช้งานคือช่วงที่เปิดแอปค้างไว้เท่าที่วัดได้
        </p>

        {perSa.length === 0 ? (
          <EmptyNotice>
            ยังไม่มีข้อมูลการใช้งาน — จะเริ่มสะสมเมื่อผู้ใช้เปิดใช้แอปในแต่ละวัน
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
              <h2 className="text-meta text-ink-secondary font-semibold">
                รายคน (เรียงตามชื่อ)
                {totalFriction > 0 ? ` · จุดสะดุดรวม ${totalFriction} ครั้ง` : ""}
              </h2>
              <div className="border-edge bg-card rounded-control divide-edge divide-y border">
                {/* Spec 244 U5: each person links to their activity timeline. */}
                {perSa.map((p) => (
                  <Link
                    key={p.actorId}
                    href={`/settings/usage/${p.actorId}`}
                    className="active:bg-sunk flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-ink text-body truncate font-semibold">{p.name}</span>
                      <span className="text-ink-secondary text-meta">
                        {roleLabel(p.role)} · ใช้งาน {p.activeDays}/{WINDOW_DAYS} วัน ·{" "}
                        {p.totalSessions} ครั้ง · ล่าสุด {ddmm(p.lastActiveDay)}
                        {p.frictionCount > 0 ? (
                          <span className="text-attn-press"> · จุดสะดุด {p.frictionCount}</span>
                        ) : null}
                      </span>
                    </div>
                    <span className="text-ink text-meta shrink-0 tabular-nums">
                      {formatScreenTime(p.totalScreenTimeMs)}
                    </span>
                    <ChevronRight aria-hidden className="text-ink-muted h-4 w-4 shrink-0" />
                  </Link>
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
