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
// Shaped as a hero action, not a row: filled accent ground, the QR mark, and a
// subtitle naming the physical act. Deliberately carries NO count line — with
// zero loans it would read "0 ยืมออก", and the counts already live on the store
// section where that data is loaded anyway. Adding them here would put an
// items + movements + open-log read onto the app's heaviest page.
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
      className="rounded-card border-action bg-action-soft shadow-card focus-visible:ring-action flex min-h-16 items-center gap-3 border px-4 py-3.5 focus:outline-none focus-visible:ring-2"
    >
      <QrCode aria-hidden className="text-action size-7 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body text-ink font-semibold">สแกนยืม/คืนอุปกรณ์</span>
        <span className="text-meta text-ink-secondary">แตะ QR หรือ NFC บนตัวเครื่องมือ</span>
      </span>
      <ChevronRight aria-hidden className="text-action size-5 shrink-0" />
    </Link>
  );
}
