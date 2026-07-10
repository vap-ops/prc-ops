"use client";

// Spec 292 U4 (U5 absorbed) — the PM/PD/super control to set an SA's primary site,
// on the project-settings members surface the PM already uses. Smallest control:
// one pin per site_admin member; the current primary is marked, not re-offered.
// set_primary_project_for is the load-bearing DB gate (caller role + can_see_project
// + target-is-site_admin-member) — this UI only relays + reflects the result.

import { useState } from "react";
import { PRIMARY_SITE_LABEL, SET_PRIMARY_SITE_LABEL } from "@/lib/i18n/labels";
import { INLINE_ERROR } from "@/lib/ui/classes";
import { useToast } from "@/lib/ui/use-toast";
import { setPrimaryProjectFor } from "./actions";

export type PrimarySiteAdmin = { id: string; name: string | null; isPrimary: boolean };

export function ProjectPrimarySiteAdmins({
  projectId,
  siteAdmins,
}: {
  projectId: string;
  siteAdmins: PrimarySiteAdmin[];
}) {
  const toast = useToast();
  const [admins, setAdmins] = useState<PrimarySiteAdmin[]>(siteAdmins);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to set when the project has no site_admin members.
  if (siteAdmins.length === 0) return null;

  function onPin(userId: string) {
    setError(null);
    setBusy(true);
    void (async () => {
      const r = await setPrimaryProjectFor(userId, projectId);
      setBusy(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Exactly one primary per SA — reflect the flip locally (the RPC cleared the old).
      setAdmins((prev) => prev.map((a) => ({ ...a, isPrimary: a.id === userId })));
      toast.success("ตั้งไซต์หลักแล้ว");
    })();
  }

  return (
    <section className="rounded-card border-edge bg-card shadow-card flex flex-col gap-3 border p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-ink text-base font-semibold">{`${PRIMARY_SITE_LABEL}ของช่างผู้ดูแล`}</h2>
        <p className="text-ink-muted text-xs">
          ตั้งโครงการนี้เป็นไซต์หลักให้ช่างผู้ดูแล — หน้าเครื่องมือและแผนของเขาจะเปิดมาที่ไซต์นี้
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {admins.map((a) => (
          <li
            key={a.id}
            className="rounded-control border-edge bg-page flex items-center justify-between gap-2 border px-3 py-2"
          >
            <span className="text-ink truncate text-sm">{a.name ?? a.id.slice(0, 8)}</span>
            {a.isPrimary ? (
              <span className="text-action inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
                {PRIMARY_SITE_LABEL}
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                aria-label={`${SET_PRIMARY_SITE_LABEL} ${a.name ?? "ช่าง"}`}
                onClick={() => onPin(a.id)}
                className="text-action shrink-0 px-2 text-sm font-medium hover:underline disabled:opacity-50"
              >
                {SET_PRIMARY_SITE_LABEL}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error ? (
        <div role="alert" className={INLINE_ERROR}>
          {error}
        </div>
      ) : null}
    </section>
  );
}
