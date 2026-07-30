// Spec 367 U5/U5b — where an equipment item's reference image is allowed to live.
//
// One rule, two write paths: `setEquipmentItemImage` (edit sheet, row exists) and
// `createEquipment` (add sheet, the id is minted client-side and the photo is
// uploaded before the row). It lives here because two copies of an authority rule
// is how they drift apart.
//
// The shape is dictated by the live storage policy, not by taste: the
// `equipment-images` INSERT policy admits the back office only where
// `array_length(storage.foldername(name), 1) = 1`, and its other arm is
// `usage/<log>/…` at depth 2 for spec 370's borrow/return condition photos. So
// "the item's own folder, one level deep" is exactly the set of paths a
// back-office upload can have produced.

/** UUID v4-shaped, matching the app's UUID_REGEX audience for equipment ids. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when `path` is a file sitting directly inside `itemId`'s own folder.
 * `null` (clearing the image) is always allowed.
 *
 * Compared segment-by-segment rather than by an interpolated regex: the id is
 * caller-supplied, and a regex-shaped id must not be able to widen its own match.
 */
export function isOwnItemImagePath(itemId: string, path: string | null): boolean {
  if (path === null) return true;
  if (!UUID_RE.test(itemId)) return false;

  const segments = path.split("/");
  if (segments.length !== 2) return false;

  const [folder, file] = segments;
  if (folder !== itemId) return false;
  // A traversal can only appear in the file segment at depth 1, but reject it
  // explicitly so the intent survives a future change to the depth rule.
  return file !== undefined && file.length > 0 && file !== "." && file !== "..";
}
