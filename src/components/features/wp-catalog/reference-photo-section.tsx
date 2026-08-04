// Spec 389 U5 — the ตัวอย่างงาน server section for the WP detail page.
//
// Reads through get_wp_reference_photos (SECURITY DEFINER — the ONLY way
// across the photo_logs RLS wall: a นายาว SA cannot read a โพธิ์ทอง photo row
// directly, and that is the whole point of the section). Photo BYTES are then
// minted server-side as signed URLs for EXACTLY the storage paths the RPC
// returned (spec D3: the mint stays bound to the RPC's output — this section
// never widens the readable set).
//
// Renders NOTHING when the WP is unmapped or there is nothing to show — an
// empty reference section is noise, not information.
//
// Spec 391: the set is no longer "what a PD starred". The RPC now falls back to
// DERIVED examples — `after`/`after_fix` photos of COMPLETE WPs mapped to the
// same catalogue item — so the section fills itself and the PD's star becomes a
// promotion rather than the only way in.
//
// ⚠️ `workPackageId` is REQUIRED, not a nicety. Without it the RPC cannot
// exclude the WP being viewed, and a completed WP is its own newest candidate:
// measured on live data before U1b, all 144 complete mapped WPs were served
// their OWN photos (403 of 403), duplicated directly above the same photos in
// the gallery below. Passing it is what makes this section cross-project.

import { createClient } from "@/lib/db/server";
import { mintPhotoThumbnails } from "@/lib/photos/mint-thumbnails";
import {
  ReferenceExamples,
  type ReferenceExampleRow,
} from "@/components/features/wp-catalog/reference-examples";

export async function ReferencePhotoSection({
  wpCatalogItemId,
  workPackageId,
}: {
  wpCatalogItemId: string | null;
  /** The WP being viewed — excluded from the derived arm so it is never its own
   *  example. See the header note; this is a correctness argument, not a filter. */
  workPackageId: string;
}) {
  if (!wpCatalogItemId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_wp_reference_photos", {
    p_wp_catalog_item_id: wpCatalogItemId,
    p_exclude_work_package_id: workPackageId,
  });
  // a read failure renders nothing rather than a broken section — the WP page
  // must not fail on its reference garnish. Logged, because a silent null here
  // is indistinguishable from "nothing starred" — the exact state §6's
  // acceptance metric reads.
  if (error) {
    console.error("[reference-photos] rpc failed", { code: error.code });
    return null;
  }
  if (!data || data.length === 0) return null;

  // No slice: the RPC hard-caps at 4 (spec 391 D3). The old `slice(0, 12)` and
  // its "newest 12 stars" comment were both dead the moment the cap moved into
  // the reader — a client-side cap that can never bind reads as a second policy
  // and invites someone to "fix" the mismatch in the wrong place.
  const urls = await mintPhotoThumbnails(
    data.map((r) => ({ id: r.photo_log_id, storage_path: r.storage_path })),
  );

  const rows: ReferenceExampleRow[] = data.flatMap((r) => {
    const u = urls.get(r.photo_log_id);
    return u
      ? [
          {
            photoLogId: r.photo_log_id,
            thumbUrl: u.thumbUrl,
            fullUrl: u.fullUrl,
            projectName: r.project_name,
            note: r.note,
            // D7 — the derived arm reports these NULL, so a non-null starred_by
            // IS the marker. No second query.
            starred: r.starred_by !== null,
          },
        ]
      : [];
  });
  if (rows.length === 0) return null;

  return <ReferenceExamples rows={rows} />;
}
