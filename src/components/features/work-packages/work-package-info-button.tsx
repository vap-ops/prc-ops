"use client";

// Spec 94 — WorkPackageInfoButton: the WP detail header is slimmed to code +
// name + status pill (WP identity is the nameplate — never hidden, WP-centric
// principle). The contractor block (display + reassign) and the read-only
// description move here, behind an ⓘ chip that opens a bottom sheet (spec 78).
//
// 'use client' justification: the BottomSheet caller owns the open state. The
// reassign control reuses WpAssignmentPanel (its own มอบหมายงาน trigger opens a
// nested sheet — accepted; both close on router.refresh).

import { useState } from "react";
import { Info } from "lucide-react";
import { BottomSheet } from "@/components/features/common/bottom-sheet";
import {
  WpAssignmentPanel,
  type ContractorOption,
} from "@/components/features/work-packages/wp-assignment-panel";
import { ICON_CHIP_MUTED } from "@/lib/ui/classes";

interface WorkPackageInfoButtonProps {
  projectId: string;
  workPackageId: string;
  /** Assigned contractor display (null when unassigned). */
  contractor: { name: string; phone: string | null } | null;
  description: string | null;
  /** Whether this viewer may reassign (SA/PM/super on the capture page). */
  isAssigner: boolean;
  /** Picker list for WpAssignmentPanel (blacklist already filtered upstream). */
  contractors: ContractorOption[];
  contractorId: string | null;
}

export function WorkPackageInfoButton({
  projectId,
  workPackageId,
  contractor,
  description,
  isAssigner,
  contractors,
  contractorId,
}: WorkPackageInfoButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="ข้อมูลงาน"
        className={ICON_CHIP_MUTED}
      >
        <Info aria-hidden className="h-5 w-5" />
      </button>
      <BottomSheet open={open} title="ข้อมูลงาน" onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-4">
          {contractor ? (
            <div className="flex flex-col gap-1">
              <p className="text-meta text-ink-secondary">ผู้รับเหมา</p>
              <p className="text-body text-ink font-semibold">
                {contractor.name}
                {contractor.phone ? (
                  <>
                    <span className="text-ink-muted mx-1">·</span>
                    <a href={`tel:${contractor.phone}`} className="text-action font-semibold">
                      {contractor.phone}
                    </a>
                  </>
                ) : null}
              </p>
              {isAssigner ? (
                <WpAssignmentPanel
                  projectId={projectId}
                  workPackageId={workPackageId}
                  contractors={contractors}
                  contractorId={contractorId}
                />
              ) : null}
            </div>
          ) : null}

          {description ? (
            <div className="flex flex-col gap-1">
              <p className="text-meta text-ink-secondary">รายละเอียดงาน</p>
              <p className="text-body text-ink-secondary whitespace-pre-wrap">{description}</p>
            </div>
          ) : null}
        </div>
      </BottomSheet>
    </>
  );
}
