import { PageShell } from "@/components/features/page-shell";
import Link from "next/link";

// Localized 404 — without this, notFound() falls through to Next.js's
// built-in English page and ships mixed-language UI (spec 14 item D).
export default function NotFound() {
  return (
    <PageShell variant="card">
      <div className="max-w-md space-y-6 text-center">
        <p className="text-ink-secondary text-sm font-medium tracking-wide uppercase">404</p>
        <h1 className="text-2xl font-semibold tracking-tight">ไม่พบหน้าที่ต้องการ</h1>
        <p className="text-ink-secondary text-sm">
          หน้านี้อาจถูกย้ายหรือไม่มีอยู่ กรุณาตรวจสอบลิงก์อีกครั้ง
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="bg-fill text-on-fill hover:bg-fill-press focus-visible:ring-action inline-flex min-h-11 items-center justify-center rounded-md px-5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
