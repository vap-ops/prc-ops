"use client";

// Spec 94 — ProjectInfoButton: the project detail header is slimmed to code +
// name; its context metadata (client / lead / team / type / site) moves here,
// behind an ⓘ chip that opens a bottom sheet (spec 78). The header context block
// was tall and sticky (spec 62/64), so it ate vertical space on every scroll.
//
// 'use client' justification: the BottomSheet caller owns the open state. The
// rows are plain serializable data passed from the server page.

import { useState } from "react";
import { Info, MapPin } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import { ICON_CHIP_MUTED } from "@/lib/ui/classes";
import { formatThaiDate } from "@/lib/i18n/labels";

interface ProjectInfoButtonProps {
  clientName: string | null;
  leadName: string | null;
  memberNames: string[];
  typeLabel: string | null;
  siteAddress: string | null;
  // Spec 173 U4: status + schedule dates + an address-derived Google-Maps link.
  statusLabel: string;
  startDate: string | null;
  plannedCompletionDate: string | null;
  mapsUrl: string | null;
}

export function ProjectInfoButton({
  clientName,
  leadName,
  memberNames,
  typeLabel,
  siteAddress,
  statusLabel,
  startDate,
  plannedCompletionDate,
  mapsUrl,
}: ProjectInfoButtonProps) {
  const [open, setOpen] = useState(false);

  // Spec 173 U4: a "เริ่ม … · กำหนดเสร็จ …" line, omitting either end if unset.
  const dateParts: string[] = [];
  if (startDate) dateParts.push(`เริ่ม ${formatThaiDate(startDate)}`);
  if (plannedCompletionDate) dateParts.push(`กำหนดเสร็จ ${formatThaiDate(plannedCompletionDate)}`);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="ข้อมูลโครงการ"
        className={ICON_CHIP_MUTED}
      >
        <Info aria-hidden className="h-5 w-5" />
      </button>
      <BottomSheet open={open} title="ข้อมูลโครงการ" onClose={() => setOpen(false)}>
        <dl className="flex flex-col gap-3">
          <InfoRow label="สถานะ" value={statusLabel} />
          {clientName && <InfoRow label="ลูกค้า" value={clientName} />}
          {leadName && <InfoRow label="ผู้รับผิดชอบ" value={leadName} />}
          {memberNames.length > 0 && <InfoRow label="ทีมงาน" value={memberNames.join(", ")} />}
          {typeLabel && <InfoRow label="ประเภท" value={typeLabel} />}
          {dateParts.length > 0 && <InfoRow label="กำหนดการ" value={dateParts.join(" · ")} />}
          {siteAddress && <InfoRow label="ที่ตั้ง" value={siteAddress} />}
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-action text-body inline-flex items-center gap-1.5 font-medium underline-offset-2 hover:underline"
            >
              <MapPin aria-hidden className="h-4 w-4" />
              เปิดใน Google Maps
            </a>
          )}
        </dl>
      </BottomSheet>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-meta text-ink-secondary">{label}</dt>
      <dd className="text-body text-ink font-medium break-words">{value}</dd>
    </div>
  );
}
