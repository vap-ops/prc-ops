// Spec 277 P0 — the SA-home tools grid. A 2-col grid of shipped destinations that
// were buried a project-hub tap (or a settings gear) away: the ของเข้า receiving
// queue + the on-site store คลัง (spec 300 U4 split them; the store was the biggest
// reachability fix — everything routes through the SA's คลัง), the
// project schedule, the purchase-request worklist, and ปิดวัน (end-of-day:
// tomorrow's plan — the day report is spec 212, not yet built). Store + schedule
// are per-project, so they deep-link
// to the SA's resolved current project (spec 292 U3) and fall back to the project
// picker only when the SA has no visible project. Server component — pure Links,
// no client state.

import Link from "next/link";
import {
  Box,
  CalendarDays,
  ClipboardCheck,
  ShoppingCart,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { scheduleHref, storeHref, incomingHref } from "@/lib/nav/project-paths";
import { STORE_LABEL, STORE_INCOMING_HEADING } from "@/lib/i18n/labels";

export function SaTools({
  primaryProjectId,
  showCloseNudge = false,
}: {
  /** The SA's resolved current project (deep-link target), or null → the picker. */
  primaryProjectId: string | null;
  /** ปิดวัน gentle pulse — passed true only after ~16:00 (bangkokHour). */
  showCloseNudge?: boolean;
}) {
  const projectScoped = (href: (id: string) => string) =>
    primaryProjectId ? href(primaryProjectId) : "/projects";

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-meta text-ink-secondary font-semibold">เครื่องมือ</h2>
      <div className="grid grid-cols-2 gap-3">
        {/* Spec 300 U4: ของเข้า (incoming deliveries) is its own surface, split from คลัง
            (inventory) — a time-sensitive receiving queue ≠ static stock. Receiving first. */}
        <Tile
          href={projectScoped(incomingHref)}
          icon={Truck}
          accent="text-cat-w03"
          title={STORE_INCOMING_HEADING}
          subtitle="กำลังมา · รับของ"
        />
        <Tile
          href={projectScoped(storeHref)}
          icon={Box}
          accent="text-cat-w05"
          title={STORE_LABEL}
          subtitle="สต๊อก · ตรวจนับ"
        />
        <Tile
          href={projectScoped(scheduleHref)}
          icon={CalendarDays}
          accent="text-action"
          title="ตารางงาน"
          subtitle="ความคืบหน้าโครงการ"
        />
        <Tile
          href="/requests"
          icon={ShoppingCart}
          accent="text-cat-w02"
          title="คำขอซื้อ"
          subtitle="ติดตามคำขอ"
        />
        <Tile
          href="/sa/plan"
          icon={ClipboardCheck}
          accent="text-done"
          title="ปิดวัน"
          subtitle="แผนพรุ่งนี้"
          pulse={showCloseNudge}
        />
        {/* Temporary — SA-assisted onboarding: the crew roster + the technician
            self-onboard QR. Full-width row below the tools grid. */}
        <Tile
          href="/sa/crew"
          icon={Users}
          accent="text-cat-w06"
          title="ทีมงาน"
          subtitle="ช่างในโครงการ · เพิ่มช่างใหม่"
          fullWidth
        />
      </div>
    </section>
  );
}

function Tile({
  href,
  icon: Icon,
  accent,
  title,
  subtitle,
  pulse = false,
  fullWidth = false,
}: {
  href: string;
  icon: LucideIcon;
  accent: string;
  title: string;
  subtitle: string;
  pulse?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-card border-edge bg-card shadow-card focus-visible:ring-action hover:bg-sunk relative flex min-h-20 flex-col gap-2 border p-4 transition-colors focus:outline-none focus-visible:ring-2 ${
        fullWidth ? "col-span-2" : ""
      }`}
    >
      {pulse ? (
        <span
          data-testid="close-pulse"
          aria-hidden
          className="absolute top-2.5 right-2.5 flex size-2.5"
        >
          <span className="bg-attn absolute inline-flex size-full animate-ping rounded-full opacity-60" />
          <span className="bg-attn relative inline-flex size-2.5 rounded-full" />
        </span>
      ) : null}
      <Icon aria-hidden className={`size-6 shrink-0 ${accent}`} />
      <div className="flex flex-col gap-0.5">
        <span className="text-body text-ink font-semibold">{title}</span>
        <span className="text-meta text-ink-muted">{subtitle}</span>
      </div>
    </Link>
  );
}
