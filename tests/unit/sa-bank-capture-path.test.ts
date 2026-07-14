import { describe, expect, it } from "vitest";

import { saBankCapturePath } from "@/lib/sa/sa-bank-capture-path";

// Spec 298 U2 — the walled capture object key. Must live under `sa-bank-capture/`
// (the RPC gates on split_part(path,'/',1)='sa-bank-capture'); no worker id / no PII
// in the path; the extension is sanitized so a crafted name can't break the key.
describe("saBankCapturePath", () => {
  it("puts the object under the sa-bank-capture/ folder", () => {
    expect(saBankCapturePath("jpg").startsWith("sa-bank-capture/")).toBe(true);
  });

  it("keeps a normal extension (lowercased)", () => {
    expect(saBankCapturePath("PNG")).toMatch(/^sa-bank-capture\/\d{4}\/[a-f0-9-]{36}\.png$/);
  });

  it("falls back to jpg for a bogus/injection extension", () => {
    expect(saBankCapturePath("../evil")).toMatch(/\.jpg$/);
    expect(saBankCapturePath("")).toMatch(/\.jpg$/);
  });

  it("mints a distinct key each call (no collision)", () => {
    expect(saBankCapturePath("jpg")).not.toBe(saBankCapturePath("jpg"));
  });
});
