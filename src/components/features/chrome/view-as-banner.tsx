// Spec 274 U2 — the persistent "you are viewing-as" banner. Rendered globally in
// the root layout so a super_admin can EXIT from any page, including the empty /
// stub views an assumed role lands on. Shows only for a real super_admin with an
// active assumed_role cookie (getActiveViewAs handles the forge-guard); null for
// everyone else, so it is inert on every normal request.
//
// Fixed to the top with a high z-index (above PageShell's sticky headers, z-20).
// The exit posts clearAssumedRole, which resolves the REAL role — so exit works
// even though the assumed role can't reach super_admin-only surfaces.

import { getActiveViewAs } from "@/lib/auth/view-as-state.server";
import { clearAssumedRole } from "@/app/settings/roles-view-as/actions";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

export async function ViewAsBanner() {
  const assumed = await getActiveViewAs();
  if (!assumed) return null;

  return (
    <div className="border-attn bg-attn-soft text-attn-ink fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 border-b px-4 py-1.5">
      <span className="text-meta min-w-0 truncate font-medium">
        กำลังดูในมุมมอง: <span className="font-bold">{USER_ROLE_LABEL[assumed]}</span>
      </span>
      <form action={clearAssumedRole}>
        <button
          type="submit"
          className="border-attn text-attn-ink rounded-control shrink-0 border px-2.5 py-0.5 text-xs font-semibold transition-opacity hover:opacity-80"
        >
          ออกจากมุมมอง
        </button>
      </form>
    </div>
  );
}
