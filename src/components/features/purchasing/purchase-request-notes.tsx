"use client";

// Spec 73 — editable purchase-request note. Thin wrapper binding the PR write
// path onto the shared NotesField (spec 72). Rendered on the request detail
// page for the requester + back-office; the RPC re-gates server-side.

import { NotesField } from "@/components/features/common/notes-field";
import { setPurchaseRequestNotes } from "@/app/requests/[requestId]/notes-actions";

interface PurchaseRequestNotesProps {
  requestId: string;
  notes: string | null;
}

export function PurchaseRequestNotes({ requestId, notes }: PurchaseRequestNotesProps) {
  return (
    <NotesField
      notes={notes}
      fieldId="pr-notes"
      placeholder="เช่น ยี่ห้อ รุ่น หรือข้อความถึงฝ่ายจัดซื้อ"
      onSave={(value) => setPurchaseRequestNotes({ requestId, notes: value })}
    />
  );
}
