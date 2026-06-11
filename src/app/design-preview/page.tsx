// TEMPORARY public preview (design-directions-2026-06.md): the same
// sample content rendered in the three candidate visual directions so
// the operator can judge them on a real phone in real daylight.
// Static, zero data, no auth (listed in proxy PUBLIC_PATHS) — DELETED
// by the spec-38 commit that implements the chosen direction.

export const metadata = { title: "ตัวอย่างดีไซน์" };

function SampleCardA() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-zinc-500">WP-014 · งานเทพื้นอาคาร B</p>
          <p className="mt-0.5 text-base text-zinc-900">
            <span className="mr-1.5 font-mono text-xs text-zinc-400">PR-0042</span>
            ปูนซีเมนต์ <span className="text-zinc-400">·</span>{" "}
            <span className="text-zinc-700">20 ถุง</span>
          </p>
          <p className="mt-1 text-[13px] text-zinc-500">ขอซื้อโดย สมชาย · ขอเมื่อ 12 มิ.ย. 2569</p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full border border-amber-600 bg-amber-400 px-3 py-1 text-sm font-semibold text-zinc-950">
          รออนุมัติ
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <input
          readOnly
          value="PO-2026-042"
          aria-label="ตัวอย่างช่องกรอก"
          className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-xs"
        />
        <div className="flex gap-2">
          <span className="inline-flex h-11 flex-1 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white shadow-sm">
            อนุมัติ
          </span>
          <span className="inline-flex h-11 flex-1 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 shadow-xs">
            ดูรายละเอียด
          </span>
        </div>
      </div>
    </div>
  );
}

function SampleCardB() {
  return (
    <div className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
      <h3 className="mb-3 border-l-4 border-amber-400 pl-3 text-base font-bold tracking-tight text-zinc-900">
        คำขอซื้อ
      </h3>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-slate-700">
            WP-014 · งานเทพื้นอาคาร B
          </p>
          <p className="mt-0.5 text-base text-zinc-900">
            <span className="mr-1.5 font-mono text-xs font-bold text-amber-700">PR-0042</span>
            ปูนซีเมนต์ <span className="text-zinc-400">·</span>{" "}
            <span className="text-zinc-700">20 ถุง</span>
          </p>
          <p className="mt-1 text-[13px] text-zinc-600">ขอซื้อโดย สมชาย · ขอเมื่อ 12 มิ.ย. 2569</p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full border border-amber-600 bg-amber-400 px-3 py-1 text-sm font-semibold text-zinc-950">
          รออนุมัติ
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <input
          readOnly
          value="PO-2026-042"
          aria-label="ตัวอย่างช่องกรอก"
          className="h-11 w-full rounded-md border border-zinc-400 bg-white px-3 text-sm text-zinc-900"
        />
        <div className="flex gap-2">
          <span className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-bold text-white">
            อนุมัติ
          </span>
          <span className="inline-flex h-11 flex-1 items-center justify-center rounded-md border-2 border-slate-900 bg-white px-4 text-sm font-bold text-slate-900">
            ดูรายละเอียด
          </span>
        </div>
      </div>
    </div>
  );
}

function SampleCardC() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-zinc-400">WP-014 · งานเทพื้นอาคาร B</p>
          <p className="mt-1 text-base text-zinc-900">
            <span className="mr-1.5 font-mono text-xs text-zinc-400">PR-0042</span>
            ปูนซีเมนต์ <span className="text-zinc-300">·</span>{" "}
            <span className="text-zinc-600">20 ถุง</span>
          </p>
          <p className="mt-1.5 text-[13px] text-zinc-500">
            ขอซื้อโดย สมชาย · ขอเมื่อ 12 มิ.ย. 2569
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full border border-amber-600 bg-amber-400 px-3 py-1 text-sm font-semibold text-zinc-950">
          รออนุมัติ
        </span>
      </div>
      <div className="mt-5 flex flex-col gap-2.5">
        <input
          readOnly
          value="PO-2026-042"
          aria-label="ตัวอย่างช่องกรอก"
          className="h-11 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 text-sm text-zinc-900"
        />
        <div className="flex gap-2.5">
          <span className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-blue-700 px-4 text-sm font-semibold text-white shadow-sm">
            อนุมัติ
          </span>
          <span className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-700">
            ดูรายละเอียด
          </span>
        </div>
      </div>
    </div>
  );
}

export default function DesignPreviewPage() {
  return (
    <main className="min-h-screen bg-white pb-16 text-zinc-900">
      <header className="border-b border-zinc-300 px-5 py-4">
        <div className="mx-auto max-w-md">
          <p className="text-xs font-semibold text-blue-700">ตัวอย่างดีไซน์ (ชั่วคราว)</p>
          <h1 className="text-xl font-semibold tracking-tight">เลือกแบบที่ชอบ — ก / ข / ค</h1>
          <p className="mt-1 text-xs text-zinc-600">
            การ์ดเดียวกัน เนื้อหาเดียวกัน ต่างกันที่สไตล์ — ดูกลางแจ้งด้วยถ้าทำได้
          </p>
        </div>
      </header>

      <section className="bg-zinc-50 px-5 py-6">
        <div className="mx-auto max-w-md">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            ก — เรียบ ใช้งานจริง <span className="text-xs font-normal text-zinc-500">(แนะนำ)</span>
          </h2>
          <SampleCardA />
          <p className="mt-2 text-xs text-zinc-500">
            พื้นหลังเทาอ่อน การ์ดขาวยกตัวด้วยเงา มุมโค้งขึ้น ปุ่ม/ช่องกรอกมีมิติ
          </p>
        </div>
      </section>

      <section className="border-t border-zinc-200 bg-white px-5 py-6">
        <div className="mx-auto max-w-md">
          <div className="-mx-5 -mt-6 mb-4 bg-slate-900 px-5 py-3">
            <p className="text-sm font-bold tracking-wide text-white">
              PRC <span className="text-amber-400">Ops</span>
            </p>
          </div>
          <h2 className="mb-3 text-lg font-bold tracking-tight">ข — แบรนด์งานก่อสร้าง</h2>
          <SampleCardB />
          <p className="mt-2 text-xs text-zinc-500">
            แถบหัวเข้ม + เส้นเหลืองนิรภัย ตัวหนาขึ้น ดูเป็นแบรนด์ของเราที่สุด
          </p>
        </div>
      </section>

      <section className="border-t border-zinc-200 bg-zinc-100 px-5 py-6">
        <div className="mx-auto max-w-md">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">ค — การ์ดลอย โมเดิร์น</h2>
          <SampleCardC />
          <p className="mt-2 text-xs text-zinc-500">
            การ์ดลอยเงาชัด มุมโค้งมาก ปุ่มแคปซูล — สวยในร่ม แต่ขอบจางลงกลางแดด
          </p>
        </div>
      </section>
    </main>
  );
}
