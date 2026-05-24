// Tombstone row construction for the removePhoto action (ADR 0015).
// A tombstone is an append-only photo_logs row with storage_path NULL
// and superseded_by pointing at the photo being removed — the
// well-formedness CHECK requires exactly that combination. Pure so
// the shape can be unit-tested.

import type { TablesInsert } from "@/lib/db/database.types";
import type { PhotoPhase } from "./transitions";

export interface BuildTombstoneRowInput {
  workPackageId: string;
  phase: PhotoPhase;
  targetPhotoId: string;
  uploadedBy: string;
}

export function buildTombstoneRow(input: BuildTombstoneRowInput): TablesInsert<"photo_logs"> {
  return {
    work_package_id: input.workPackageId,
    phase: input.phase,
    storage_path: null,
    superseded_by: input.targetPhotoId,
    uploaded_by: input.uploadedBy,
  };
}
