// Spec 370 U4 — the shared equipment scan door.
//
// #821 hoisted a plain text link to the top of the project store page after a
// field report ("SA cannot find it"); the operator then judged that link "not
// prominent enough". Telemetry says the placement was right and the PAGE was
// wrong — over 7 days a site_admin generated 1,367 route events on /sa and 20
// on the project store, and `equipment_usage_logs` is still 0 rows. So the door
// is one component with two homes: the SA home (where every session starts) and
// the top of the store page (where the physical handoff happens).
//
// Shaped as a hero action, not a row: a genuinely FILLED primary (bg-action /
// text-on-fill), the QR mark, and a subtitle naming the physical act.
// ⚠️ The first cut used `bg-action-soft` and a fresh-eyes pass killed it: in
// light mode that token is L .97 against a page ground of L .962 and ordinary
// cards at L 1.0, so the "accent ground" was invisible AND dimmer than every
// card beside it — the exact failure this unit exists to fix, in the mode a
// phone in daylight actually uses. action-soft is also the app's SELECTED state
// (19 sites), which a permanent door should not impersonate. bg-action is the
// only accent FILL, and on /sa it collides with nothing: the camera FAB is
// amber and the แจ้งปัญหา FAB is red.
//
// Deliberately carries NO count line — with zero loans it would read
// "0 ยืมออก", and the counts already live on the store section where that data
// is loaded anyway. Adding them here would put an items + movements + open-log
// read onto the app's heaviest page.
//
// Server-component safe: a pure Link, no client state.

import Link from "next/link";
import { ChevronRight, QrCode } from "lucide-react";

export function EquipmentScanDoor({
  /** Where the scan route sends the user back to. */
  from,
}: {
  from: string;
}) {
  return (
    <Link
      href={`/equipment/scan?from=${encodeURIComponent(from)}`}
      className="rounded-card bg-action text-on-fill shadow-card focus-visible:ring-action flex min-h-16 items-center gap-3 px-4 py-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
    >
      <QrCode aria-hidden className="size-7 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body font-semibold">สแกนยืม/คืนอุปกรณ์</span>
        {/* on-fill for both lines: the app has no on-fill-secondary token, and
            CDS bans opacity on text. Hierarchy comes from size + weight. */}
        <span className="text-meta">แตะ QR หรือ NFC บนตัวเครื่องมือ</span>
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0" />
    </Link>
  );
}
