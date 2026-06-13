// Spec 68 P2 — close-out variance. Compares photo-activity days against
// logged labor days (both Asia/Bangkok calendar dates). Surfaces a PM
// reconciliation prompt when the two diverge enough to mean "someone
// forgot to log" or "logged on a day with no site evidence". Pure set
// arithmetic; the page buckets the photo timestamps (bangkokDateOf).

// The symmetric-difference threshold at which the strip shows. Two days
// of drift is the operator-chosen floor (spec 46 P2) — one day is noise
// (a delivery photo, a half-day nobody logged).
export const LABOR_VARIANCE_MIN_DIFF = 2;

export interface LaborVariance {
  /** Days with photos but no labor logged. */
  photoOnlyDays: string[];
  /** Days with labor logged but no photos. */
  laborOnlyDays: string[];
  /** |photoOnly| + |laborOnly|. */
  symmetricDiff: number;
  /** Photos exist for the WP yet zero labor was ever logged. */
  photosWithoutLabor: boolean;
  /** Whether the strip should render. */
  surfaces: boolean;
}

export function computeLaborVariance(
  photoDays: ReadonlyArray<string>,
  laborDays: ReadonlyArray<string>,
): LaborVariance {
  const photos = new Set(photoDays);
  const labor = new Set(laborDays);

  const photoOnlyDays = [...photos].filter((d) => !labor.has(d)).sort();
  const laborOnlyDays = [...labor].filter((d) => !photos.has(d)).sort();
  const symmetricDiff = photoOnlyDays.length + laborOnlyDays.length;
  const photosWithoutLabor = photos.size > 0 && labor.size === 0;

  return {
    photoOnlyDays,
    laborOnlyDays,
    symmetricDiff,
    photosWithoutLabor,
    surfaces: symmetricDiff >= LABOR_VARIANCE_MIN_DIFF || photosWithoutLabor,
  };
}
