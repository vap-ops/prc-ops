// Spec 294 — persistent environment banner for the sandbox tenant. Rendered
// globally in the root layout; shows ONLY when NEXT_PUBLIC_APP_ENV=sandbox
// (unset on production, so this is inert there). Bottom-fixed so it never
// collides with the top-fixed ViewAsBanner (spec 274). The short commit sha
// lets a designer/tester confirm they are on the latest deploy at a glance.

import { clientEnv } from "@/lib/env";

export function SandboxBanner() {
  if (clientEnv.NEXT_PUBLIC_APP_ENV !== "sandbox") return null;
  const sha = clientEnv.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7);

  return (
    <div className="border-attn bg-attn-soft text-attn-ink fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center gap-2 border-t px-4 py-1">
      <span className="text-meta font-semibold">SANDBOX</span>
      <span className="text-meta min-w-0 truncate">
        ข้อมูลทดสอบ — ไม่ใช่ข้อมูลจริง{sha ? ` · ${sha}` : ""}
      </span>
    </div>
  );
}
