# ADR 0036 — Client-side photo downscale: the downscaled file IS the original

**Status:** Accepted — 2026-06-11 (decision recorded; implementation
deferred to its own spec). Source:
`docs/architecture-revision-2026-06.md` §3.6 + §6; operator granted
decision authority in chat.

## Context

ADR 0003 mandates photos are stored unmodified — the evidence-chain
invariant. Phone cameras now produce 4–12 MB images; unbounded uploads
dominate Storage cost and choke weak site uplinks (the same uplinks the
future offline-queue spec exists for). The question: does
downscale-before-upload break the "unmodified" invariant?

## Decision

- **The file the client uploads is THE original.** Client-side
  downscale (canvas re-encode) to **max 2000 px long edge, JPEG ~0.8
  quality** happens _before_ upload; what reaches Storage is never
  modified afterward. ADR 0003's invariant binds from the moment of
  upload, not the moment of capture.
- EXIF orientation must be applied during re-encode (canvas strips
  EXIF); capture timestamp relevance is carried by `photo_logs`
  columns, not EXIF, so EXIF loss is acceptable and recorded here.
- Files already smaller than the cap upload as-is (no upscale, no
  pointless re-encode beyond orientation normalization).
- Applies to ALL photo upload paths (WP phase photos, PR reference
  attachments, delivery-confirmation photos) for consistency of the
  evidence story.
- **Implementation is its own spec** (test-first, pure resize module +
  uploader integration); this ADR only locks the policy so storage
  cost/uplink decisions stop being re-litigated.

## Consequences

- Evidence posture is honest and documented: "original" = what the
  device submitted, at evidence resolution — same standard as before
  (nothing ever verified camera-sensor originality; uploads were
  already client-controlled).
- Storage growth and upload time on weak signal drop by roughly an
  order of magnitude for typical phone photos.
- Existing stored photos are untouched (no retroactive processing —
  append-only stays sacred).
