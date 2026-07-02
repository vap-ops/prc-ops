// Spec 244 U4 / ADR 0068 (amended, Tier B) — the UX friction map: a super_admin read
// that ranks SCREENS by how much friction they generate (aggregate across all users),
// so the team gets a fix-list of where UX hurts most. The second read output (D3b) of
// the friction-capture set; the per-person needs-help list (D3a) is /settings/usage.
// super_admin-only (spec 244 §9): the interaction_events RLS "super_admin or own"
// permits the all-rows read, so this uses the RLS-scoped session client.
//
// v1 ranks by absolute friction count per screen. Friction is low-volume (rare, not
// per-heartbeat), so a raw RLS read + a JS group-by is fine for this rarely-loaded
// view at current scale; a per-view RATE + heavier route_view aggregation is a
// documented scale-up (a partial index + an aggregation RPC). PDPA: counts by route +
// type only — no content, no per-person data.

import { PageShell } from "@/components/features/chrome/page-shell";
import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { DetailHeader } from "@/components/features/chrome/detail-header";
import { EmptyNotice } from "@/components/features/common/notices";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/db/server";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import { buildFrictionMap } from "@/lib/usage/friction-map";
import { FRICTION_EVENT_LABEL } from "@/lib/i18n/labels";
import type { FrictionEventType } from "@/lib/telemetry/session";

export const metadata = { title: "จุดสะดุดรายจอ" };

const WINDOW_DAYS = 14;

// The friction subset of interaction_event_type (mirrors the enum). Labels live in
// labels.ts (FRICTION_EVENT_LABEL — shared with the per-person timeline, spec 244 U5).
const FRICTION_TYPES = [
  "js_error",
  "upload_fail",
  "validation_error",
  "form_abandon",
  "rage_tap",
] as const;

export default async function FrictionMapPage() {
  await requireRole(["super_admin"]);

  // Start of the N-day window (UTC, matching how usage_daily / the usage read bucket
  // days). `new Date()` (not Date.now()) — the React Compiler purity lint allows it.
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (WINDOW_DAYS - 1)),
  )
    .toISOString()
    .slice(0, 10);

  const supabase = await createClient();
  const { data } = await supabase
    .from("interaction_events")
    .select("route, event_type")
    .in("event_type", FRICTION_TYPES)
    .gte("created_at", `${windowStart}T00:00:00.000Z`);

  const map = buildFrictionMap(
    (data ?? []).map((r) => ({
      route: r.route,
      event_type: r.event_type as FrictionEventType,
    })),
  );

  return (
    <PageShell>
      <BottomTabBar role="super_admin" />
      <DetailHeader backHref="/settings" backLabel="กลับไปตั้งค่า">
        <h1 className="text-ink text-xl font-semibold tracking-tight">จุดสะดุดรายจอ</h1>
      </DetailHeader>

      <section className={`mx-auto ${PAGE_MAX_W} flex flex-col gap-5 px-5 py-6`}>
        <p className="text-ink-secondary text-meta">
          จอไหนที่ผู้ใช้เจอ “จุดสะดุด” มากที่สุดในช่วง {WINDOW_DAYS} วันที่ผ่านมา (รวมทุกคน) — error
          / อัปโหลดไม่ได้ / กรอกไม่ผ่าน / ทิ้งฟอร์ม / กดรัว ๆ เพื่อจัดลำดับว่าควรปรับ UX จอไหนก่อน
        </p>

        {map.length === 0 ? (
          <EmptyNotice>ยังไม่มีจุดสะดุด — จะเริ่มสะสมเมื่อผู้ใช้เจอปัญหาระหว่างใช้งาน</EmptyNotice>
        ) : (
          <div className="border-edge bg-card rounded-control divide-edge divide-y border">
            {map.map((r) => (
              <div key={r.route} className="flex flex-col gap-1.5 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink text-body min-w-0 truncate font-mono">{r.route}</span>
                  <span className="text-attn-press text-body shrink-0 font-semibold tabular-nums">
                    {r.total}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FRICTION_TYPES.filter((t) => (r.byType[t] ?? 0) > 0).map((t) => (
                    <span
                      key={t}
                      className="border-edge bg-sunk text-ink-secondary text-meta rounded-full border px-2 py-0.5"
                    >
                      {FRICTION_EVENT_LABEL[t]} {r.byType[t]}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </PageShell>
  );
}
