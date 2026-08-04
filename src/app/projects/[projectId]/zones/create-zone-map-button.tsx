"use client";

// Spec 392 U2a — the project's first zone map. One map per project today; the
// table is plural because floors/buildings are the near-future case, so this
// button names the thing it makes rather than saying "เริ่มต้น".

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BUTTON_PRIMARY, INLINE_ERROR } from "@/lib/ui/classes";
import { ZONE_MAP_LABEL } from "@/lib/i18n/labels";
import { createZoneMap } from "./actions";

export function CreateZoneMapButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await createZoneMap({ projectId, name: ZONE_MAP_LABEL });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={handleClick} disabled={pending} className={BUTTON_PRIMARY}>
        {pending ? "กำลังสร้าง…" : `สร้าง${ZONE_MAP_LABEL}`}
      </button>
      {error ? <p className={INLINE_ERROR}>{error}</p> : null}
    </div>
  );
}
