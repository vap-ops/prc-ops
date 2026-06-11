import Link from "next/link";

// Localized 404 — without this, notFound() falls through to Next.js's
// built-in English page and ships mixed-language UI (spec 14 item D).
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="max-w-md space-y-6 text-center">
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">ไม่พบหน้าที่ต้องการ</h1>
        <p className="text-sm text-zinc-400">
          หน้านี้อาจถูกย้ายหรือไม่มีอยู่ กรุณาตรวจสอบลิงก์อีกครั้ง
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-800 px-5 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 motion-reduce:transition-none"
          >
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    </main>
  );
}
