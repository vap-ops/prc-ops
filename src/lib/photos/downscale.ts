// Spec 34 / ADR 0036 — client-side photo downscale. The file the client
// uploads IS the original (ADR 0003's invariant binds from upload);
// what we shrink here is what gets stored, forever.
//
// computeDownscaleTarget is pure (unit-tested). preparePhotoForUpload
// is the browser seam: jsdom has no canvas/createImageBitmap, so it is
// review + operator-phone verified (stager precedent). Downscale is an
// OPTIMIZATION, never a gate — every failure path returns the original
// file unchanged.

import { mimeToPhotoExt, type PhotoExt } from "@/lib/photos/path";

export const DOWNSCALE_MAX_EDGE = 2000;
const DOWNSCALE_QUALITY = 0.8;

export interface DownscaleTarget {
  width: number;
  height: number;
  needed: boolean;
}

export function computeDownscaleTarget(
  width: number,
  height: number,
  maxEdge: number = DOWNSCALE_MAX_EDGE,
): DownscaleTarget {
  const longEdge = Math.max(width, height);
  if (width <= 0 || height <= 0 || longEdge <= maxEdge) {
    return { width, height, needed: false };
  }
  const scale = maxEdge / longEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    needed: true,
  };
}

export interface PreparedPhoto {
  blob: Blob;
  ext: PhotoExt;
  downscaled: boolean;
}

// Decode → downscale → JPEG 0.8, with the spec-34 behavior table:
// small photos and anything the browser cannot decode/encode pass
// through unchanged (EXIF intact, so orientation still renders);
// re-encoded photos have orientation BAKED (createImageBitmap applies
// EXIF orientation at decode by default). Returns null only for a
// non-photo MIME — the callers' existing rejection path.
export async function preparePhotoForUpload(file: File): Promise<PreparedPhoto | null> {
  const originalExt = mimeToPhotoExt(file.type);
  if (originalExt === null) return null;
  const passthrough: PreparedPhoto = { blob: file, ext: originalExt, downscaled: false };

  let bitmap: ImageBitmap;
  try {
    // Explicit (not default-reliant): bake EXIF orientation at decode —
    // engines without the option ignore the dictionary member.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return passthrough; // e.g. HEIC on a browser without HEIC decode
  }

  try {
    const target = computeDownscaleTarget(bitmap.width, bitmap.height);
    if (!target.needed) return passthrough;

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return passthrough;
    // JPEG has no alpha — composite transparent PNG/WebP onto white
    // (the default canvas substrate is black after toBlob('image/jpeg')).
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, target.width, target.height);
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", DOWNSCALE_QUALITY);
    });
    if (!blob) return passthrough;

    return { blob, ext: "jpeg", downscaled: true };
  } catch {
    return passthrough;
  } finally {
    bitmap.close();
  }
}
