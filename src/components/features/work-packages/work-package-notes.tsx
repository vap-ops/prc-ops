"use client";

// Spec 71 — work-package notes (backup capture). Spec 72: now a thin
// wrapper that binds the WP write path onto the shared NotesField. The
// 'use client' wrapper imports the "use server" action directly, so no
// server function crosses the RSC boundary.

import { NotesField } from "@/components/features/common/notes-field";
import { setWorkPackageNotes } from "@/app/projects/[projectId]/work-packages/[workPackageId]/notes-actions";

interface WorkPackageNotesProps {
  projectId: string;
  workPackageId: string;
  notes: string | null;
}

export function WorkPackageNotes({ projectId, workPackageId, notes }: WorkPackageNotesProps) {
  return (
    <NotesField
      notes={notes}
      fieldId="wp-notes"
      placeholder="ข้อมูลเพิ่มเติมเกี่ยวกับงานนี้ที่ไม่มีช่องให้กรอกโดยตรง"
      onSave={(value) => setWorkPackageNotes({ projectId, workPackageId, notes: value })}
    />
  );
}
