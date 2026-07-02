// Spec 244 U5 / ADR 0068 (Tier B) — the per-person activity timeline: drill-down
// from the /settings/usage needs-help list (operator 2026-07-02: "detailed info
// down to individual's logged activities"). Shows one person's last 14 days as
// day-grouped sessions — when they opened the app, how long, which screens in
// order, and any friction inline — read LIVE from interaction_events via the
// get_actor_timeline RPC (mig 20260813057000), which groups the heartbeat-heavy
// raw slice server-side (a raw read would truncate at the PostgREST page cap).
// super_admin-only (spec 244 §9) behind requireRole + the RLS session client
// (SECURITY INVOKER RPC — RLS scopes the read; no admin client). Framing is
// PROTECTIVE (ADR 0068 §5): a "see what happened so you can help" read, never a
// scoreboard. PDPA: routes + event types + timestamps only — the context jsonb
// is never rendered.

import { notFound } from "next/navigation";
import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import {
  FRICTION_EVENT_LABEL,
  USER_ROLE_LABEL,
  formatThaiDate,
  formatThaiTime,
} from "@/lib/i18n/labels";
import { formatScreenTime } from "@/lib/usage/usage-view";
import { dedupeScreens, groupTimelineByDay, parseTimelineRows } from "@/lib/usage/actor-timeline";

export const metadata = { title: "กิจกรรมการใช้งาน" };

const WINDOW_DAYS = 14;

// External portal tiers are out of scope (spec 244 U1c) — internal staff only.
const EXTERNAL_ROLES = new Set(["client", "contractor"]);

const roleLabel = (r: string): string => (USER_ROLE_LABEL as Record<string, string>)[r] ?? r;
const frictionLabel = (t: string): string =>
  (FRICTION_EVENT_LABEL as Record<string, string>)[t] ?? t;

interface PageProps {
  params: Promise<{ actorId: string }>;
}

export default async function ActorTimelinePage({ params }: PageProps) {
  await requireRole(["super_admin"]);
  const { actorId } = await params;

  const supabase = await createClient();
  const [userRes, timelineRes] = await Promise.all([
    supabase.from("users").select("id, full_name, role").eq("id", actorId).maybeSingle(),
    supabase.rpc("get_actor_timeline", { p_actor_id: actorId, p_days: WINDOW_DAYS }),
  ]);

  // A malformed id errors BOTH reads (22P02, data null, never throws) → 404 via the
  // user guard. A transient failure on a real read must NOT render the "no activity"
  // empty state (a false claim about a person, on a needs-help view) — throw to the
  // error boundary instead, where a refresh recovers.
  if (timelineRes.error && !userRes.error) {
    throw new Error(`get_actor_timeline failed: ${timelineRes.error.message}`);
  }

  const user = userRes.data;
  if (!user || EXTERNAL_ROLES.has(user.role)) notFound();

  const days = groupTimelineByDay(parseTimelineRows(timelineRes.data ?? []));
  const name = user.full_name?.trim() || "(ไม่มีชื่อ)";

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings/usage" backLabel="กลับไปการใช้งานแอป">
        <h1 className="text-ink text-xl font-semibold tracking-tight">{name}</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <p className="text-ink-secondary text-meta">
          {roleLabel(user.role)} · กิจกรรมการใช้งานแอปย้อนหลัง {WINDOW_DAYS} วัน — เข้าแอปเมื่อไหร่
          นานแค่ไหน เปิดหน้าไหนบ้าง และเจอ “จุดสะดุด” ตรงไหน เพื่อเข้าใจและช่วยเหลือ
          ไม่ใช่การจับผิดหรือวัดผลงาน
        </p>

        {days.length === 0 ? (
          <EmptyNotice>
            ยังไม่มีกิจกรรมในช่วง {WINDOW_DAYS} วันที่ผ่านมา — จะแสดงเมื่อมีการเปิดใช้แอป
          </EmptyNotice>
        ) : (
          days.map((d) => (
            <div key={d.day} className="flex flex-col gap-2">
              <h2 className="text-meta text-ink-secondary font-semibold">
                {formatThaiDate(d.day)} · รวม {formatScreenTime(d.totalDurationMs)}
              </h2>
              <div className="border-edge bg-card rounded-control divide-edge divide-y border">
                {d.sessions.map((s) => {
                  const visits = dedupeScreens(s.screens);
                  return (
                    <div key={s.sessionId} className="flex flex-col gap-1.5 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-ink text-body font-semibold tabular-nums">
                          {formatThaiTime(s.startedAt)} น.
                        </span>
                        <span className="text-ink-secondary text-meta shrink-0 tabular-nums">
                          {formatScreenTime(s.durationMs)}
                        </span>
                      </div>
                      {visits.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {visits.map((v, i) => (
                            <span
                              key={`${v.route}-${i}`}
                              className="border-edge bg-sunk text-ink-secondary text-meta rounded-full border px-2 py-0.5 font-mono"
                            >
                              {v.route}
                              {v.count > 1 ? ` ×${v.count}` : ""}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {s.friction.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {s.friction.map((f, i) => (
                            <span
                              key={`${f.type}-${i}`}
                              className="border-edge text-attn-press text-meta rounded-full border px-2 py-0.5"
                            >
                              {frictionLabel(f.type)} · {formatThaiTime(f.at)} น.
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </section>
    </PageShell>
  );
}
