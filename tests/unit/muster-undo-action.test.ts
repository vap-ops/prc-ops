// Writing failing test first.
//
// Spec 379 U2 — `undoMusterScan` relays to the `muster_undo_scan` DEFINER RPC
// and maps ITS refusals to Thai. Spec 379 D7: the four new refusals get their
// OWN copy — `scanErrorToThai`'s `role not permitted` arm answers
// ไม่มีสิทธิ์เช็คชื่อ ("no permission to take attendance"), which is a claim
// about the wrong action, and none of its arms tells the SA what to do about a
// closed day or a booked wage.
//
// Gate + client mocked: this pins the arg mapping and the error map, not the DB.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, rpc } = vi.hoisted(() => ({
  getActionUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser,
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { undoMusterScan } from "@/lib/muster/actions";

const WORKER = "22222222-2222-2222-2222-222222222222";
const DATE = "2026-07-30";
const REVALIDATE = "/projects/x/muster";

function refusal(message: string) {
  rpc.mockResolvedValue({ data: null, error: { message } });
}

beforeEach(() => {
  getActionUser.mockReset().mockResolvedValue({ supabase: { rpc } });
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("undoMusterScan — the RPC relay", () => {
  it("threads (worker, date, session) to muster_undo_scan", async () => {
    const r = await undoMusterScan({
      workerId: WORKER,
      date: DATE,
      session: "regular",
      revalidate: REVALIDATE,
    });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("muster_undo_scan", {
      p_worker: WORKER,
      p_date: DATE,
      p_session: "regular",
    });
  });

  it("threads session:'ot' unchanged — the OT row is a row of its own", async () => {
    await undoMusterScan({ workerId: WORKER, date: DATE, session: "ot", revalidate: REVALIDATE });
    expect(rpc).toHaveBeenCalledWith(
      "muster_undo_scan",
      expect.objectContaining({ p_session: "ot" }),
    );
  });

  it("refuses a malformed worker id / date / revalidate BEFORE reaching the gate", async () => {
    for (const bad of [
      { workerId: "not-a-uuid", date: DATE, session: "regular" as const, revalidate: REVALIDATE },
      { workerId: WORKER, date: "30/07/2026", session: "regular" as const, revalidate: REVALIDATE },
      { workerId: WORKER, date: DATE, session: "regular" as const, revalidate: "projects/x" },
    ]) {
      const r = await undoMusterScan(bad);
      expect(r.ok).toBe(false);
    }
    expect(getActionUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("relays the signed-out case", async () => {
    getActionUser.mockResolvedValue(null);
    const r = await undoMusterScan({
      workerId: WORKER,
      date: DATE,
      session: "regular",
      revalidate: REVALIDATE,
    });
    expect(r).toEqual({ ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" });
  });
});

describe("undoMusterScan — the four new refusals get their own Thai", () => {
  async function errorFor(message: string) {
    refusal(message);
    const r = await undoMusterScan({
      workerId: WORKER,
      date: DATE,
      session: "regular",
      revalidate: REVALIDATE,
    });
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.error;
  }

  // Spec 379 D7 — this is the arm the spec singles out. The scan mapper answers
  // this exact substring with ไม่มีสิทธิ์เช็คชื่อ; reusing it would tell the SA
  // she may not take attendance, when what she may not do is retract it.
  it("names the RETRACTION, never ไม่มีสิทธิ์เช็คชื่อ, for a role refusal", async () => {
    const e = await errorFor("muster_undo_scan: role not permitted");
    expect(e).not.toBe("ไม่มีสิทธิ์เช็คชื่อ");
    expect(e).toContain("ยกเลิก");
  });

  // Spec 397 U3 changed this refusal's TRUTH: reopen_muster_day now exists, so
  // "ยกเลิกไม่ได้ ต้องแจ้งผู้จัดการ" named a dead end that is no longer one. The
  // copy states the PRECONDITION instead — and deliberately does not name the
  // surface, because site_admin (the main cockpit user) cannot open the page the
  // reopen form lives on (§9 Q8). So: no "ผู้จัดการ" hand-off, and no claim that
  // the retraction is impossible.
  it("says a closed day must be reopened first — not that it is impossible", async () => {
    const e = await errorFor("muster_undo_scan: the day is already closed");
    expect(e).toContain("ปิดวัน");
    expect(e).toContain("เปิดวันนั้นอีกครั้ง");
    expect(e).not.toContain("ยกเลิกไม่ได้");
    expect(e).not.toContain("ผู้จัดการ");
  });

  it("says the wage is already booked, and who to ask", async () => {
    const e = await errorFor("muster_undo_scan: wages are already booked for this check-in");
    expect(e).toContain("ค่าแรง");
    expect(e).toContain("ผู้จัดการ");
  });

  it("says to retract the OT session first — the one refusal the SA can act on herself", async () => {
    const e = await errorFor("muster_undo_scan: undo the OT session first");
    expect(e).toContain("OT");
    expect(e).not.toContain("ผู้จัดการ");
  });

  it("says the check-in is not there rather than blaming the network", async () => {
    const e = await errorFor("muster_undo_scan: no check-in to undo");
    expect(e).toContain("ไม่พบ");
  });

  // Every arm above is distinct copy — a mapper that collapsed two of them would
  // leave the SA acting on the wrong instruction.
  it("gives each refusal a distinct message", async () => {
    const messages = [
      await errorFor("muster_undo_scan: role not permitted"),
      await errorFor("muster_undo_scan: no check-in to undo"),
      await errorFor("muster_undo_scan: the day is already closed"),
      await errorFor("muster_undo_scan: wages are already booked for this check-in"),
      await errorFor("muster_undo_scan: undo the OT session first"),
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("falls back to a retraction-shaped generic for an unmapped failure", async () => {
    const e = await errorFor("could not connect");
    expect(e).toContain("ยกเลิก");
    expect(e).not.toContain("เช็คชื่อไม่สำเร็จ");
  });
});
