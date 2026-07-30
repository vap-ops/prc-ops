// Pre-resolves the photo lightbox's next/dynamic overlay chunk so the first
// open in a test file doesn't pay a cold module transform inside an assertion
// window. Spec 65-style shared helper — one home for a hazard that six test
// files share.
//
// The bug this fixes (diagnosed 2026-07-30). `photo markup (spec 51) > renders
// no markup chrome without a photoId` failed on the Windows box with
// `TestingLibraryElementError: Unable to find role="dialog"`, which reads like
// the lightbox never opened. It did: the DOM at timeout still held the
// next/dynamic loading fallback from photo-lightbox.tsx (`aria-hidden`,
// `fixed inset-0 z-50 bg-black/85`), so the click reached React and the Suspense
// boundary was working — the overlay MODULE simply had not finished resolving.
//
// `findBy*` polls under RTL's asyncUtilTimeout, which is 1000ms and which
// `--testTimeout` does not change (that was why raising the test timeout looked
// like it ruled timing out). Measured cold import of the overlay's graph across
// six concurrent vitest processes: 463, 544, 646, 737, 1080, 1375 ms — warm
// re-import 0 ms, so the cost is one-time and lands on whichever test opens the
// overlay FIRST in that process. Two of six exceeded the budget on the import
// alone, and the file failed 3 runs in 6. CI (Linux) is green on 15/15 runs of
// main, so this never showed there.
//
// Awaiting the import in a `beforeAll` moves that one-time cost into a hook
// (10s hookTimeout, ~7x the worst measured import) and leaves the 1000ms
// assertion budget covering only the render. Nothing under test changes: the
// overlay is still reached through next/dynamic — pinned by the code-split test
// in photo-lightbox.test.tsx — and still mounts only when a photo is tapped.
//
// Usage in a test file that opens the lightbox:
//   import { warmLightboxOverlay } from "../helpers/lightbox-overlay-warmup";
//   beforeAll(warmLightboxOverlay);
//
// Enforced by tests/unit/lightbox-overlay-warmup.test.ts.

/**
 * Resolves the lazily-imported lightbox overlay module. Vitest isolates module
 * registries per test file, so each file warms its own — the import is
 * idempotent and costs ~0ms once resolved.
 */
export async function warmLightboxOverlay(): Promise<void> {
  await import("@/components/features/photos/photo-lightbox-overlay");
}
