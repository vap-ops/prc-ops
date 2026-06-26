import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STORE_FIX_WRONG_ENTRY_LABEL, STORE_RETURN_TO_STORE_LABEL } from "@/lib/i18n/labels";

// Spec 209 — the ambiguous "กลับรายการ" conflated a mistake-undo with a real
// return (operator 2026-06-27). The two actions now carry DISTINCT, single-sourced
// terms; the store/WP mistake-undo buttons must use the label, never the old bare
// "กลับรายการ" string (which read identically on two opposite-effect buttons).
const THAI_CHAR = /[฀-๿]/;

describe("store returns vs mistake-undo labels (spec 209)", () => {
  it("defines two distinct, Thai, non-empty terms", () => {
    expect(STORE_FIX_WRONG_ENTRY_LABEL).toBe("แก้รายการที่บันทึกผิด");
    expect(STORE_RETURN_TO_STORE_LABEL).toBe("คืนเข้าสโตร์");
    expect(STORE_FIX_WRONG_ENTRY_LABEL).not.toBe(STORE_RETURN_TO_STORE_LABEL);
    for (const l of [STORE_FIX_WRONG_ENTRY_LABEL, STORE_RETURN_TO_STORE_LABEL]) {
      expect(l.trim().length).toBeGreaterThan(0);
      expect(THAI_CHAR.test(l)).toBe(true);
    }
  });

  // Guard: the mistake-undo buttons no longer use the bare ambiguous label inline.
  it("the store + WP reversal buttons use the label, not the bare กลับรายการ", () => {
    const files = [
      "src/components/features/store/store-manager.tsx",
      "src/components/features/store/wp-issue-stock.tsx",
    ];
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src, `${rel} should not hard-code idleLabel="กลับรายการ"`).not.toContain(
        'idleLabel="กลับรายการ"',
      );
      expect(src, `${rel} should use STORE_FIX_WRONG_ENTRY_LABEL`).toContain(
        "STORE_FIX_WRONG_ENTRY_LABEL",
      );
    }
  });
});
