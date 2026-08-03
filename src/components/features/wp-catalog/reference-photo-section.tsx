// Spec 389 U5 — the ตัวอย่างงาน server section for the WP detail page.
//
// Reads through get_wp_reference_photos (SECURITY DEFINER — the ONLY way
// across the photo_logs RLS wall: a นายาว SA cannot read a โพธิ์ทอง photo row
// directly, and that is the whole point of the section). Photo BYTES are then
// minted server-side as signed URLs for EXACTLY the storage paths the RPC
// returned (spec D3: the mint stays bound to the RPC's output — this section
// never widens the readable set).
//
// Renders NOTHING when the WP is unmapped or nothing is starred — an empty
// reference section is noise, not information.

import { createClient } from "@/lib/db/server";
import { mintPhotoThumbnails } from "@/lib/photos/mint-thumbnails";
import {
  ReferenceExamples,
  type ReferenceExampleRow,
} from "@/components/features/wp-catalog/reference-examples";

export async function ReferencePhotoSection({
  wpCatalogItemId,
}: {
  wpCatalogItemId: string | null;
}) {
  if (!wpCatalogItemId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_wp_reference_photos", {
    p_wp_catalog_item_id: wpCatalogItemId,
  });
  // a read failure renders nothing rather than a broken section — the WP page
  // must not fail on its reference garnish
  if (error || !data || data.length === 0) return null;

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
          },
        ]
      : [];
  });
  if (rows.length === 0) return null;

  return <ReferenceExamples rows={rows} />;
}
