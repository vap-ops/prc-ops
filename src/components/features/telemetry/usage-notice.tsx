"use client";

// Spec 244 U1b — the one-time usage-measurement notice (operator decision
// 2026-07-01). Legitimate-interest basis: we INFORM, then remember the
// acknowledgement per device (localStorage). A calm bottom banner, not a
// destructive confirm dialog. Design-system tokens only (field-first).

export function UsageNotice({ onAck }: { onAck: () => void }) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 p-3"
      role="region"
      aria-label="ประกาศการวัดการใช้งาน"
    >
      <div className="rounded-control border-edge-strong bg-card mx-auto flex w-full max-w-md flex-col gap-3 border p-4 shadow-lg">
        <p className="text-ink text-sm">
          เราเก็บข้อมูลการใช้งานแอป (เวลาที่ใช้ · หน้าจอที่เปิด) เพื่อปรับปรุงแอปและช่วยเหลือคุณ —
          ไม่เก็บข้อมูลส่วนตัวเกินจำเป็น
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onAck}
            className="border-edge-strong bg-card text-ink hover:bg-page focus-visible:ring-action inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2"
          >
            รับทราบ
          </button>
        </div>
      </div>
    </div>
  );
}
