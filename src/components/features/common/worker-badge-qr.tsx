// Spec 306 U3a + operator 2026-07-13 ("include QR for every user, to make it
// consistent") — a per-user identity QR on their own digital card, shown on their
// phone so staff can scan the screen. Presentational render of a pre-generated QR
// svg string (src/lib/muster/badge-qr.ts). The payload is the caller's workers.id
// for on-site crew (matches their printed badge + the muster scanner) or their own
// account id otherwise (identity only) — the caption is neutral so it reads right
// for both. Rendered on every user's /profile card + the /technician home. No
// 'use client' — a plain Server Component (the svg is inert markup).

export function WorkerBadgeQr({ svg }: { svg: string }) {
  return (
    <section className="rounded-card border-edge bg-card flex flex-col items-center gap-2 border px-4 py-4">
      <p className="text-body text-ink font-bold">QR ประจำตัว</p>
      <div
        aria-label="QR ประจำตัวของฉัน"
        className="rounded bg-white p-2"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="text-meta text-ink-muted text-center">
        ให้เจ้าหน้าที่สแกนเพื่อเช็คชื่อเข้างานหรือยืนยันตัวตน
      </p>
    </section>
  );
}
