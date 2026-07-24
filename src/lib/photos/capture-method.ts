export const CAPTURE_METHODS = ["camera", "library", "picker"] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

/** Storage upload `metadata` option that stamps the capture affordance into
 *  storage.objects.user_metadata (spec 354). Spread into the FileOptions:
 *    .upload(path, blob, { contentType, upsert: false, metadata: captureMethodMetadata("camera") })
 */
export function captureMethodMetadata(method: CaptureMethod): { captureMethod: CaptureMethod } {
  return { captureMethod: method };
}
