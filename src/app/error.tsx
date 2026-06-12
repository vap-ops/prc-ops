"use client";

import { PageShell } from "@/components/features/page-shell";

// Localized error boundary — Next.js requires error boundaries to be
// Client Components; that requirement is the 'use client' justification
// (spec 14 item D). Without this file, unhandled render errors fall
// through to Next.js's built-in English page.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <PageShell variant="card">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">เกิดข้อผิดพลาด</h1>
        <p className="text-sm text-zinc-600">มีบางอย่างผิดพลาด กรุณาลองใหม่อีกครั้ง</p>
        <div className="pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            ลองใหม่
          </button>
        </div>
      </div>
    </PageShell>
  );
}
