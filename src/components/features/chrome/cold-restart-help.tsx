// Spec 339 U1 — "ปิดแอปสนิท", the cold-restart card on /settings → เกี่ยวกับ.
//
// Why it exists: a deploy does not reach an already-running installed PWA. The
// app's own RefreshButton is router.refresh() ("deliberately NOT a hard reload",
// spec 53) so it re-fetches server data and leaves the client JS bundle in
// memory untouched — the affordance a user reaches for cannot fix the problem it
// looks like it should. On iOS the standalone PWA resuming from background keeps
// that old bundle indefinitely (memory ios-pwa-stale-bundle-2026-07: the service
// worker is NOT the cause — it only caches content-hashed /_next/static/*). Only
// a fresh app instance picks the new code up.
//
// Zero-JS by design: a native <details>, the same idiom as the /sa/help cards, on
// a page that is otherwise a Server Component. The version comes in as a prop —
// the page already imports package.json, so the "did it work?" check can never
// drift from the running build. The illustration is one gesture, not two phones:
// the card flick is identical on both platforms, only the way to open the app
// switcher differs, and drawing it twice would imply a difference that isn't there.

import { RotateCw } from "lucide-react";

export function ColdRestartHelp({ version }: { version: string }) {
  return (
    <details id="cold-restart" className="px-4 py-3">
      <summary className="text-ink text-body flex min-h-11 cursor-pointer items-center font-semibold">
        แอปไม่อัปเดต? ปิดแอปสนิท
      </summary>

      <div className="mt-2 flex flex-col gap-3">
        <p className="bg-attn-soft text-attn-ink rounded-control text-meta px-3 py-2 leading-relaxed">
          กดปุ่ม
          {/* align-middle rather than the text-bottom variant: the design-doctrine
              guard reads that utility as a colour token and flags it as phantom. */}
          <RotateCw aria-hidden className="mx-1 inline h-4 w-4 align-middle" />
          รีเฟรชในแอป <span className="font-semibold">ไม่พอ</span> — ได้แค่ข้อมูลใหม่
          ไม่ได้ตัวแอปใหม่
        </p>

        <div className="text-ink-muted flex flex-col items-center gap-1">
          <svg
            role="img"
            aria-labelledby="cold-restart-illus-title"
            viewBox="0 0 220 150"
            className="h-32 w-auto"
            fill="none"
          >
            <title id="cold-restart-illus-title">หน้าจอสลับแอป การ์ดแอปถูกปัดขึ้นจนหลุดจอ</title>
            <rect
              x="62"
              y="4"
              width="96"
              height="142"
              rx="12"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <rect
              x="74"
              y="14"
              width="72"
              height="46"
              rx="6"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.5"
            />
            <rect
              x="74"
              y="70"
              width="72"
              height="62"
              rx="6"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M110 66 L110 26" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" />
            <path d="M110 16 L104 28 L116 28 Z" fill="currentColor" />
          </svg>
          <p className="text-meta text-center">ปัดการ์ดแอปขึ้นจนหลุดจอ แล้วเปิดใหม่</p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-meta leading-relaxed">
            <span className="text-ink block font-semibold">iPhone</span>
            <span className="text-ink-secondary block">
              ปัดขึ้นจากขอบล่างสุด แล้วค้างไว้ 1 วินาที — รุ่นที่มีปุ่มโฮม ให้กดปุ่มโฮม 2 ครั้งเร็ว
              ๆ
            </span>
          </p>
          <p className="text-meta leading-relaxed">
            <span className="text-ink block font-semibold">Android</span>
            <span className="text-ink-secondary block">
              กดปุ่มสี่เหลี่ยม หรือปัดขึ้นจากขอบล่างค้างไว้ — ถ้ายังไม่ได้ ไปที่ ตั้งค่า → แอป → PRC
              Ops → บังคับหยุด
            </span>
          </p>
        </div>

        <p className="bg-done-soft text-done-ink rounded-control text-meta px-3 py-2 leading-relaxed">
          เช็คว่าได้ตัวใหม่แล้ว: กลับมาที่หน้านี้ ต้องขึ้น เวอร์ชัน{" "}
          <span className="font-mono font-semibold">{version}</span> หรือสูงกว่า
        </p>
      </div>
    </details>
  );
}
