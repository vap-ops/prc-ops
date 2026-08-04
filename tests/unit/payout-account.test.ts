// Writing failing test first.
//
// Spec 395 U1 — classifying a worker's payout account as own / nominee / unrecorded.
//
// Every fixture below is a REAL shape from the live roster (measured 2026-08-04),
// because the two decisions that make this detector correct are both invisible
// unless you look at the actual data:
//
//  ① Whitespace collapse is load-bearing, not cosmetic. Holder "นางแก้ว··บุญวัง"
//     (double space) against worker "นางแก้ว บุญวัง" is the SAME person, and
//     honorific-stripping alone reports a mismatch.
//  ② The shared count is over ACTIVE workers only — proved by spec 396's incident:
//     account 020203221364 looks shared, but the second row is the DEACTIVATED
//     mis-edit "นายเหิน เมืองงาม". Counting it would permanently flag a correct
//     record over a mistake that has already been reversed.
//
// ⚠️ A non-matching holder is NORMAL at this firm (operator: some technicians use a
// family member's account temporarily). `unrecorded` means "not written down yet",
// never "wrong" — the tests name it that way on purpose.

import { describe, it, expect } from "vitest";
import { assessPayoutAccounts, type PayoutAccountWorker } from "@/lib/workers/payout-account";

const worker = (
  workerId: string,
  name: string,
  accountNumber: string | null,
  accountName: string | null,
): PayoutAccountWorker => ({ workerId, name, accountNumber, accountName });

const NO_NOMINEES: ReadonlySet<string> = new Set();

const byId = (rows: ReturnType<typeof assessPayoutAccounts>) =>
  new Map(rows.map((r) => [r.workerId, r]));

describe("assessPayoutAccounts — the concentration case (live: 014162319729)", () => {
  // Three different technicians paying into one minor's account.
  const ROWS = [
    worker("w1", "นางสาว โนรี ทิพย์โภชน์", "014162319729", "ด.ช.อนันตชัย  ฑีฆายุทธสกุล"),
    worker("w2", "นาย พิเชษฐ์ พันธุพัฒน์", "014162319729", "ด.ช.อนันตชัย  ฑีฆายุทธสกุล"),
    worker("w3", "นายสายฟ้า บุญเกิด", "014162319729", "ด.ช.อนันตชัย ทีฆายุทธสกุล"),
  ];

  it("reports the GROUP size, the number spec §3 headlines (3, not 2 'others')", () => {
    const r = byId(assessPayoutAccounts(ROWS, NO_NOMINEES));
    for (const id of ["w1", "w2", "w3"]) {
      expect(r.get(id)?.accountWorkerCount, id).toBe(3);
    }
  });

  it("classifies all three as unrecorded", () => {
    const r = byId(assessPayoutAccounts(ROWS, NO_NOMINEES));
    for (const id of ["w1", "w2", "w3"]) {
      expect(r.get(id)?.state, id).toBe("unrecorded");
      expect(r.get(id)?.nameMatches, id).toBe(false);
    }
  });

  it("strips ด.ช. — the honorific that actually appears in this data", () => {
    const rows = [worker("m1", "ด.ช.อนันตชัย ทีฆายุทธสกุล", "999", "อนันตชัย ทีฆายุทธสกุล")];
    expect(assessPayoutAccounts(rows, NO_NOMINEES)[0]?.nameMatches).toBe(true);
  });
});

describe("assessPayoutAccounts — whitespace variance is the same person", () => {
  // Live: 020087576927. แก้ว is the account's own holder (double space in the
  // stored holder name); แดง is a genuine third party on her account.
  const ROWS = [
    worker("k", "นางแก้ว บุญวัง", "020087576927", "นางแก้ว  บุญวัง"),
    worker("d", "นายแดง บุญวัง", "020087576927", "นางแก้ว บุญวัง"),
  ];

  it("matches across a doubled space — the mismatch count is 1, not 2", () => {
    const r = byId(assessPayoutAccounts(ROWS, NO_NOMINEES));
    expect(r.get("k")?.nameMatches).toBe(true);
    expect(r.get("d")?.nameMatches).toBe(false);
  });

  // Sharing is enough on its own: แก้ว's own account is still not "own", because
  // somebody else's wages land in it and that is what needs recording.
  it("still calls the account holder's OWN row unrecorded while it is shared", () => {
    const r = byId(assessPayoutAccounts(ROWS, NO_NOMINEES));
    expect(r.get("k")?.state).toBe("unrecorded");
    expect(r.get("k")?.accountWorkerCount).toBe(2);
  });
});

describe("assessPayoutAccounts — a lone account", () => {
  it("is own when the name matches and nothing else uses it", () => {
    const rows = [worker("s", "นางสาวปาณิศา บุญเรือง", "1130967980", "ปาณิศา บุญเรือง")];
    const a = assessPayoutAccounts(rows, NO_NOMINEES)[0];
    expect(a?.state).toBe("own");
    expect(a?.accountWorkerCount).toBe(1);
    expect(a?.nameMatches).toBe(true);
  });

  // Live: 044162319729 — one worker, name does not match, account NOT shared.
  // This is the whole reason name mismatch stays a signal even when nothing is shared.
  it("is unrecorded on a name mismatch alone", () => {
    const rows = [worker("n", "นายสมชาย ใจดี", "044162319729", "ด.ช.อนันตชัย ทีฆายุทธสกุล")];
    const a = assessPayoutAccounts(rows, NO_NOMINEES)[0];
    expect(a?.state).toBe("unrecorded");
    expect(a?.accountWorkerCount).toBe(1);
    expect(a?.nameMatches).toBe(false);
  });

  // ⚠️ 044162319729 vs 014162319729 differ by ONE character. Fuzzy-matching them
  // would invent a shared account that does not exist; §5 leaves that to U4 as a
  // human correction.
  it("never fuzzy-matches a near-miss account number into a shared group", () => {
    const rows = [
      worker("a", "นายสายฟ้า บุญเกิด", "014162319729", "ด.ช.อนันตชัย ทีฆายุทธสกุล"),
      worker("b", "นายสมชาย ใจดี", "044162319729", "ด.ช.อนันตชัย ทีฆายุทธสกุล"),
    ];
    const r = byId(assessPayoutAccounts(rows, NO_NOMINEES));
    expect(r.get("a")?.accountWorkerCount).toBe(1);
    expect(r.get("b")?.accountWorkerCount).toBe(1);
  });
});

describe("assessPayoutAccounts — a recorded nominee wins", () => {
  const ROWS = [
    worker("p", "นายสายฟ้า บุญเกิด", "014162319729", "ด.ช.อนันตชัย ทีฆายุทธสกุล"),
    worker("q", "นางสาว โนรี ทิพย์โภชน์", "014162319729", "ด.ช.อนันตชัย ทีฆายุทธสกุล"),
  ];

  it("is nominee even though the account is shared and the name differs", () => {
    const r = byId(assessPayoutAccounts(ROWS, new Set(["p"])));
    expect(r.get("p")?.state).toBe("nominee");
    // The consented row still reports the truth about the account it shares.
    expect(r.get("p")?.accountWorkerCount).toBe(2);
    expect(r.get("p")?.nameMatches).toBe(false);
    // …and its neighbour is untouched by p's consent.
    expect(r.get("q")?.state).toBe("unrecorded");
  });
});

describe("assessPayoutAccounts — what it refuses to classify", () => {
  it("omits a worker with no account (spec 320's listBanklessWorkers owns those)", () => {
    const rows = [
      worker("has", "นายสายฟ้า บุญเกิด", "014162319729", "นายสายฟ้า บุญเกิด"),
      worker("none", "นายไม่มี บัญชี", null, null),
      worker("blank", "นายว่าง เปล่า", "   ", "นายว่าง เปล่า"),
    ];
    const ids = assessPayoutAccounts(rows, NO_NOMINEES).map((a) => a.workerId);
    expect(ids).toEqual(["has"]);
  });

  // Mirrors isNormalisingRename's rule: an empty normalisation is an ABSENCE of
  // evidence, never a match. A blank holder name must not read as "their own".
  it("treats a blank holder name as unmatched, not as a match", () => {
    const rows = [worker("e", "นายสายฟ้า บุญเกิด", "555", "   ")];
    const a = assessPayoutAccounts(rows, NO_NOMINEES)[0];
    expect(a?.nameMatches).toBe(false);
    expect(a?.state).toBe("unrecorded");
  });

  it("treats a bare-honorific worker name as unmatched on both sides", () => {
    const rows = [worker("h", "นาย", "556", "นาง")];
    expect(assessPayoutAccounts(rows, NO_NOMINEES)[0]?.nameMatches).toBe(false);
  });
});

describe("assessPayoutAccounts — account-number normalisation", () => {
  it("groups on the trimmed number so stray spacing cannot hide a shared account", () => {
    const rows = [
      worker("x", "นายหนึ่ง หนึ่ง", " 014162319729", "ด.ช.อนันตชัย ทีฆายุทธสกุล"),
      worker("y", "นายสอง สอง", "014162319729 ", "ด.ช.อนันตชัย ทีฆายุทธสกุล"),
    ];
    const r = byId(assessPayoutAccounts(rows, NO_NOMINEES));
    expect(r.get("x")?.accountWorkerCount).toBe(2);
    expect(r.get("y")?.accountWorkerCount).toBe(2);
  });
});
