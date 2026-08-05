// Spec 398 U2 — schedule the stored thumbnail for a photo that was just inserted.
//
// Deferred with `after()` (stable since Next 15.1; Vercel backs it with waitUntil) so
// the resize never blocks the SA's upload response. Deliberately hooked at the METADATA
// INSERT rather than in the upload pipeline: the offline queue (ADR 0039) is
// evidence-critical and its invariant is that an item is removed only after both of ITS
// steps succeed — a thumbnail is a derived convenience, not evidence, and must not be
// able to hold an upload open or fail one.
//
// A queued/replayed upload is covered for free: the queue's insertMeta step calls the
// same server action as a live capture.

import "server-only";

import { after } from "next/server";

import { createClient as createAdminClient } from "@/lib/db/admin";
import { defaultThumbDeps, generatePhotoThumb } from "@/lib/photos/generate-thumb";

export function schedulePhotoThumb(storagePath: string): void {
  if (!storagePath) return;

  // The SCHEDULING call is guarded too, not just the work inside it: `after` throws
  // "called outside a request scope" when the caller is not a request. If that escaped,
  // addPhoto would report failure for a photo row that ALREADY LANDED, and the offline
  // queue (ADR 0039) would retry that insert forever. A thumbnail is a derived
  // convenience and must never be able to fail an upload.
  try {
    scheduleGeneration(storagePath);
  } catch (e) {
    console.error("[thumb] could not schedule generation", {
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}

function scheduleGeneration(storagePath: string): void {
  after(async () => {
    try {
      const outcome = await generatePhotoThumb(storagePath, defaultThumbDeps(createAdminClient()));
      if (outcome.status === "failed") {
        // Non-fatal by design (spec 398 D4): the photo still renders at full size.
        // Logged so a systematic failure (a format libvips cannot read) is findable
        // rather than silent.
        console.error("[thumb] generation failed", { reason: outcome.reason });
      }
    } catch (e) {
      console.error("[thumb] generation threw", {
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
