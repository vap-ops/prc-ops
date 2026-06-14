// Field-First worklist pure helpers (spec 91 follow-up: precise next-action
// verbs). nextAction now factors in whether a contractor is assigned, so a
// not_started WP with no owner reads "มอบหมายผู้รับเหมา" rather than a
// premature "take photos". deriveActionBand / byPriorityRank / groupByActionBand
// are pinned here too (they shipped untested in the reskin).

import { describe, it, expect } from "vitest";
import {
  deriveActionBand,
  nextAction,
  byPriorityRank,
  groupByActionBand,
} from "@/lib/work-packages/action-bands";

describe("action-bands", () => {
  describe("nextAction (status + contractor → the row's next step)", () => {
    it("not_started WITHOUT a contractor → assign the contractor first", () => {
      const a = nextAction("not_started", false);
      expect(a?.kind).toBe("assign");
      expect(a?.label).toContain("ผู้รับเหมา");
    });

    it("not_started WITH a contractor → start prep photos (capture)", () => {
      const a = nextAction("not_started", true);
      expect(a?.kind).toBe("capture");
      expect(a?.label).toContain("เตรียมงาน");
    });

    it("in_progress → capture progress photos, contractor-irrelevant", () => {
      expect(nextAction("in_progress", false)?.kind).toBe("capture");
      expect(nextAction("in_progress", true)?.kind).toBe("capture");
    });

    it("on_hold → wait", () => {
      expect(nextAction("on_hold", true)?.kind).toBe("wait");
    });

    it("pending_approval and complete carry no row action", () => {
      expect(nextAction("pending_approval", true)).toBeNull();
      expect(nextAction("complete", true)).toBeNull();
    });
  });

  describe("deriveActionBand", () => {
    it("maps each status to its band", () => {
      expect(deriveActionBand("not_started")).toBe("todo");
      expect(deriveActionBand("in_progress")).toBe("todo");
      expect(deriveActionBand("on_hold")).toBe("held");
      expect(deriveActionBand("pending_approval")).toBe("review");
      expect(deriveActionBand("complete")).toBe("done");
    });
  });

  describe("byPriorityRank", () => {
    it("sorts by rank desc, stable on ties (incoming order kept)", () => {
      const items = [
        { status: "not_started" as const, priorityRank: 1, id: "a" },
        { status: "not_started" as const, priorityRank: 5, id: "b" },
        { status: "not_started" as const, priorityRank: 1, id: "c" },
      ];
      expect(byPriorityRank(items).map((i) => i.id)).toEqual(["b", "a", "c"]);
    });
  });

  describe("groupByActionBand", () => {
    it("groups, drops empty bands, keeps todo before done", () => {
      const items = [
        { status: "complete" as const, priorityRank: 0 },
        { status: "not_started" as const, priorityRank: 0 },
      ];
      expect(groupByActionBand(items).map((b) => b.band)).toEqual(["todo", "done"]);
    });
  });
});
