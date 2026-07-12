// Spec 306 U3a — the worker's own morning-muster QR, shown on their phone so the
// SA scans the screen instead of a printed badge (operator 2026-07-13: "most
// technicians have phones, show QR on their digital card, no need to print").
// Presentational render of a pre-generated QR svg string (payload = the caller's
// workers.id, produced server-side by src/lib/muster/badge-qr.ts). Rendered on the
// worker's own self-scoped surfaces (/technician home + /profile digital card).
// No 'use client' — a plain Server Component (the svg is inert markup).

export function WorkerBadgeQr({ svg }: { svg: string }) {
  return (
    <section className="rounded-card border-edge bg-card flex flex-col items-center gap-2 border px-4 py-4">
      <p className="text-body text-ink font-bold">QR เช็คชื่อเข้างาน</p>
      <div
        aria-label="QR เช็คชื่อของฉัน"
        className="rounded bg-white p-2"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="text-meta text-ink-muted text-center">
        ให้ผู้ดูแลสแกนตอนเช้าเพื่อเช็คชื่อเข้า–ออกงาน
      </p>
    </section>
  );
}
