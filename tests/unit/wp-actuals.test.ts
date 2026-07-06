// Writing failing test first.
//
// Spec 271 U2a — derived per-leaf actual anchors (§3): actual_start from the
// earliest trustworthy evidence (during photo · labor with entry-lag ≤ 3 days ·
// after/after_fix photo), actual_end from the approval record (pre-U3 fallback
// = decided_at; the submit-time anchor arrives with U3's transition audit
// rows). Supersede-aware via the shared photo-evidence primitives.

import { describe, expect, it } from "vitest";
import { deriveActuals } from "@/lib/work-packages/actuals";

const WP = "wp-1";

const photo = (over: Partial<Parameters<typeof deriveActuals>[0]["photos"][number]> = {}) => ({
  id: "p1",
  work_package_id: WP,
  storage_path: "a/b.jpg",
  superseded_by: null,
  captured_at_client: "2026-07-05T09:00:00+07:00",
  created_at: "2026-07-05T02:10:00Z",
  phase: "during" as const,
  ...over,
});

describe("deriveActuals", () => {
  it("actual_start = earliest during-photo Bangkok date", () => {
    const m = deriveActuals({
      photos: [photo(), photo({ id: "p2", captured_at_client: "2026-07-03T18:00:00+07:00" })],
      labor: [],
      approvals: [],
    });
    expect(m.get(WP)?.actualStart).toBe("2026-07-03");
  });

  it("labor moves the anchor only when entered within 3 days of the work date", () => {
    const m = deriveActuals({
      photos: [],
      labor: [
        // backdated late entry: work 07-01 entered 07-09 → ignored for the metric
        { work_package_id: WP, work_date: "2026-07-01", created_at: "2026-07-09T03:00:00Z" },
        // timely: work 07-04 entered 07-05 → counts
        { work_package_id: WP, work_date: "2026-07-04", created_at: "2026-07-05T03:00:00Z" },
      ],
      approvals: [],
    });
    expect(m.get(WP)?.actualStart).toBe("2026-07-04");
  });

  it("a superseded photo does not anchor anything", () => {
    const old = photo({ id: "old", captured_at_client: "2026-07-01T09:00:00+07:00" });
    const newer = photo({
      id: "new",
      superseded_by: "old",
      captured_at_client: "2026-07-06T09:00:00+07:00",
    });
    // supersede semantics: `superseded_by` on the NEWER row points at the OLD one
    // (currentPhotoRows drops rows that appear as someone's superseded_by target).
    const m = deriveActuals({ photos: [old, newer], labor: [], approvals: [] });
    expect(m.get(WP)?.actualStart).toBe("2026-07-06");
  });

  it("actual_end = latest approved decision date; start coalesces to it", () => {
    const m = deriveActuals({
      photos: [],
      labor: [],
      approvals: [
        { work_package_id: WP, decision: "approved", decided_at: "2026-07-07T10:00:00+07:00" },
        {
          work_package_id: WP,
          decision: "needs_revision",
          decided_at: "2026-07-06T10:00:00+07:00",
        },
        { work_package_id: WP, decision: "approved", decided_at: "2026-07-09T10:00:00+07:00" },
      ],
    });
    const a = m.get(WP);
    expect(a?.actualEnd).toBe("2026-07-09");
    // §3: actual_start coalesces to actual_end so it is non-null whenever completed.
    expect(a?.actualStart).toBe("2026-07-09");
  });

  it("hasEvidence = any current photo, labor row, or approval", () => {
    const none = deriveActuals({ photos: [], labor: [], approvals: [] });
    expect(none.get(WP)).toBeUndefined();
    const lateLabor = deriveActuals({
      photos: [],
      labor: [{ work_package_id: WP, work_date: "2026-07-01", created_at: "2026-07-30T00:00:00Z" }],
      approvals: [],
    });
    // late-entered labor is still EVIDENCE (legal for payroll) — it just can't move the anchor.
    expect(lateLabor.get(WP)?.hasEvidence).toBe(true);
    expect(lateLabor.get(WP)?.actualStart).toBeNull();
  });

  it("after_fix photos anchor a start too (§3 third source)", () => {
    const m = deriveActuals({
      photos: [photo({ phase: "after_fix", captured_at_client: "2026-07-02T09:00:00+07:00" })],
      labor: [],
      approvals: [],
    });
    expect(m.get(WP)?.actualStart).toBe("2026-07-02");
  });

  it("before/defect photos are evidence but never a start anchor", () => {
    const m = deriveActuals({
      photos: [photo({ phase: "before" })],
      labor: [],
      approvals: [],
    });
    expect(m.get(WP)?.hasEvidence).toBe(true);
    expect(m.get(WP)?.actualStart).toBeNull();
  });
});
