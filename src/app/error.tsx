"use client";

// Localized error boundary — Next.js requires error boundaries to be
// Client Components; that requirement is the 'use client' justification
// (spec 14 item D). Without this file, unhandled render errors fall
// through to Next.js's built-in English page.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">เกิดข้อผิดพลาด</h1>
        <p className="text-sm text-zinc-400">มีบางอย่างผิดพลาด กรุณาลองใหม่อีกครั้ง</p>
        <div className="pt-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-zinc-800 px-5 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 motion-reduce:transition-none"
          >
            ลองใหม่
          </button>
        </div>
      </div>
    </main>
  );
}
