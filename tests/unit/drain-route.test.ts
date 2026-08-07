// Hardening (2026-07-11) — the notification outbox drainer must survive a
// poisoned row. A row whose event_type the DEPLOYED code predates (a DB enum
// value + trigger pushed ahead of the consuming deploy — the house migration
// pattern) once made resolveRecipients return undefined → `recipients.map`
// threw → the whole POST 500'd → the row was reclaimed after 10 min and
// re-crashed every run → ALL notifications (approvals, PRs, feedback) stalled
// until the code deployed or the row expired (24 h). This drives a batch of
// [unknown, throwing, healthy] and asserts one bad row never poisons the
// others: the batch completes and the healthy row still delivers.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Spec 390 — the Telegram token used to be a hard `undefined` here, which meant
// the route's whole Telegram arm was unreachable in tests: the channel filter on
// that arm could be deleted with the entire suite still green. Hoisted + mutable
// so a test can turn the bot on; the getter is read per request inside POST.
const envState = vi.hoisted(() => ({ telegramToken: undefined as string | undefined }));

vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "line-token",
    NOTIFICATION_DRAIN_SECRET: "drain-secret",
    get TELEGRAM_BOT_TOKEN() {
      return envState.telegramToken;
    },
  },
}));

type OutboxRow = {
  id: string;
  event_type: string;
  work_package_id: string | null;
  purchase_request_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
};
type PoolUser = { id: string; line_user_id: string | null; telegram_chat_id: string | null };

// Mutable fixtures the admin mock closes over; reset each test (beforeEach).
let outboxRows: OutboxRow[] = [];
let superUsers: PoolUser[] = [];
// Spec 318 U3 — enabled=false preference rows served to the drain's mute fetch.
let mutedPrefRows: Array<{ user_id: string; event_type: string }> = [];
// Spec 390 — enabled=false CHANNEL rows served to the drain's channel fetch.
let channelOffRows: Array<{ user_id: string; channel: "line" | "telegram" }> = [];
// Spec 318 U5 — project-scoped PM fanout fixtures.
type PoolUserWithRole = PoolUser & { role: string };
let pmPoolUsers: PoolUserWithRole[] = [];
let candidateUsers: Array<
  PoolUserWithRole & { full_name: string | null; line_display_name: string | null }
> = [];
let wpTableRows: Array<{
  id: string;
  code: string;
  project_id: string | null;
  name?: string | null;
}> = [];
let projectRows: Array<{ id: string; name: string; project_lead_id: string | null }> = [];
let memberRows: Array<{ project_id: string; user_id: string }> = [];
// Spec 402 U1 — purchase_request_id → project_id, the PR family's L3 source.
let prProjectIdByRequest: Record<string, string> = {};
// Spec 402 U2 — wp_decision / wp_reopened fan out to the WP's photo uploaders,
// so driving those events needs the photo_logs leg the mock never had.
let photoLogRows: Array<{ work_package_id: string; uploaded_by: string }> = [];
// …and the contacts-only users lookup (`id, line_user_id, telegram_chat_id`)
// that maps those uploader uids to a channel. Returned [] before, which is why
// no test could ever produce a wp_decision push.
let contactUsers: Array<{
  id: string;
  line_user_id: string | null;
  telegram_chat_id: string | null;
}> = [];
let rowUpdates: Array<{ id: unknown; values: Record<string, unknown> }> = [];
// Feedback c5136ad9 — captured (cols, ids) of every users .in() lookup.
let usersInCalls: Array<{ cols: string; ids: unknown[] }> = [];

const pushLineMessageMock = vi.fn();
const pushTelegramMessageMock = vi.fn();

vi.mock("@/lib/notifications/line-push", () => ({
  pushLineMessage: (args: unknown) => pushLineMessageMock(args),
}));
vi.mock("@/lib/notifications/telegram-push", () => ({
  pushTelegramMessage: (args: unknown) => pushTelegramMessageMock(args),
}));

// Admin (service-role) client mock. Only two tables are touched by this batch:
// notification_outbox (reclaim / expire / candidates / claim / per-row update)
// and users (the feedback super_admin pool). Any other table is a test bug.
vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "notification_outbox") {
        return {
          update: (values: Record<string, unknown>) => {
            // reclaim pass: sending → pending
            if (values.status === "pending") {
              return { eq: () => ({ lt: async () => ({ error: null }) }) };
            }
            // expiry pass: pending → expired (exact count)
            if (values.status === "expired") {
              return { eq: () => ({ lt: async () => ({ count: 0, error: null }) }) };
            }
            // claim pass: pending → sending, returns the claimed rows
            if (values.status === "sending") {
              return {
                in: () => ({
                  eq: () => ({ select: async () => ({ data: outboxRows, error: null }) }),
                }),
              };
            }
            // per-row terminal update (sent / failed / pending)
            return {
              eq: async (_col: string, id: unknown) => {
                rowUpdates.push({ id, values });
                return { error: null };
              },
            };
          },
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: outboxRows.map((r) => ({ id: r.id })),
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "users") {
        return {
          // Branch on the selected columns (spec 318 U5): the PM pool reads
          // role+contacts, the enrichment candidates read names too, the
          // extra-user lookup reads contacts only, the super pool uses .eq.
          select: (cols: string) => ({
            eq: async () => ({ data: superUsers, error: null }),
            in: async (_col: string, ids: unknown[]) => {
              // Feedback c5136ad9 — the mock ignores the id filter, so a test
              // that only reads the RESULT cannot pin which ids were looked up.
              // Capture the args so the submitter-enrichment test can assert
              // the submitter uid actually reached the candidates query.
              usersInCalls.push({ cols, ids: ids ?? [] });
              return {
                data: cols.includes("full_name")
                  ? candidateUsers
                  : cols.includes("role")
                    ? pmPoolUsers
                    : // The contacts-only leg (spec 402 U2): uid → channel, for
                      // recipients resolved outside the pools (photo uploaders).
                      contactUsers,
                error: null,
              };
            },
          }),
        };
      }
      // Spec 402 U2 — `name` is CHECKED, not assumed: wp_decision's message can
      // only say what the work is via this join, so a revert to the pre-402
      // three-column select must red rather than silently drop the line.
      if (table === "work_packages") {
        return {
          select: (cols: string) => ({
            in: async () => ({
              data: wpTableRows.map((wp) =>
                cols.includes("name")
                  ? wp
                  : { id: wp.id, code: wp.code, project_id: wp.project_id },
              ),
              error: null,
            }),
          }),
        };
      }
      if (table === "projects") {
        return {
          select: () => ({ in: async () => ({ data: projectRows, error: null }) }),
        };
      }
      // wp_decision / wp_reopened recipients = the WP's photo uploaders.
      if (table === "photo_logs") {
        return {
          select: () => ({
            in: () => ({ not: async () => ({ data: photoLogRows, error: null }) }),
          }),
        };
      }
      if (table === "project_members") {
        return {
          select: () => ({ in: async () => ({ data: memberRows, error: null }) }),
        };
      }
      // PR→PO number enrichment (spec 211 U8) + the PR's project (spec 402 U1).
      // The columns are CHECKED: the project slot is only reachable if the
      // route actually selects project_id, so a revert to the two-column select
      // reds here instead of silently dropping the project line.
      if (table === "purchase_requests") {
        return {
          select: (cols: string) => ({
            in: async () => ({
              data: outboxRows
                .filter((r) => r.purchase_request_id !== null)
                .map((r) => ({
                  id: r.purchase_request_id,
                  purchase_order_id: null,
                  ...(cols.includes("project_id")
                    ? { project_id: prProjectIdByRequest[r.purchase_request_id as string] ?? null }
                    : {}),
                })),
              error: null,
            }),
          }),
        };
      }
      // Spec 318 U3 — per-user mutes (enabled=false rows, scoped .in on the
      // batch's event types).
      if (table === "notification_preferences") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: mutedPrefRows, error: null }),
            }),
          }),
        };
      }
      // Spec 390 — per-CHANNEL switches (enabled=false rows). NOT scoped by
      // event type: the preference is per-user, so this terminates at .eq().
      if (table === "notification_channel_preferences") {
        return {
          select: () => ({
            // Args are CHECKED, not ignored: an arg-blind mock would serve the
            // enabled=false fixtures even if the route flipped to .eq("enabled",
            // true), so the test would assert nothing about the real call.
            eq: async (col: string, value: unknown) => {
              if (col !== "enabled" || value !== false) {
                throw new Error(`unexpected channel-preference filter ${col}=${String(value)}`);
              }
              return { data: channelOffRows, error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/notifications/drain/route";

const SUPER_ID = "cccccccc-0000-4000-8000-000000000001";
const UNKNOWN_ID = "11111111-0000-4000-8000-000000000001";
const BOOM_ID = "22222222-0000-4000-8000-000000000002";
const OK_ID = "33333333-0000-4000-8000-000000000003";

function drainRequest(): NextRequest {
  return new NextRequest("https://ops.example.app/api/notifications/drain", {
    method: "POST",
    headers: { "x-drain-secret": "drain-secret" },
  });
}

beforeEach(() => {
  rowUpdates = [];
  mutedPrefRows = [];
  channelOffRows = [];
  envState.telegramToken = undefined; // default: LINE-only path, as before
  pmPoolUsers = [];
  candidateUsers = [];
  wpTableRows = [];
  projectRows = [];
  memberRows = [];
  prProjectIdByRequest = {};
  photoLogRows = [];
  contactUsers = [];
  superUsers = [{ id: SUPER_ID, line_user_id: "Lsuper", telegram_chat_id: null }];
  outboxRows = [
    // (1) event type the deployed code doesn't know → safe skip, not a crash.
    {
      id: UNKNOWN_ID,
      event_type: "some_future_event",
      work_package_id: null,
      purchase_request_id: null,
      payload: {},
      attempts: 0,
    },
    // (2) known event whose delivery THROWS → try/catch marks just this row,
    //     and the batch keeps going. attempts 2 → +1 hits MAX_ATTEMPTS(3) →
    //     terminal "failed".
    {
      id: BOOM_ID,
      event_type: "feedback_submitted",
      work_package_id: null,
      purchase_request_id: null,
      payload: { feedback_type: "bug", role_snapshot: "site_admin", feedback_title: "BOOM" },
      attempts: 2,
    },
    // (3) healthy known event AFTER the throwing one → proves the loop was not
    //     aborted by (1) or (2).
    {
      id: OK_ID,
      event_type: "feedback_submitted",
      work_package_id: null,
      purchase_request_id: null,
      payload: { feedback_type: "feature", role_snapshot: "project_manager", feedback_title: "OK" },
      attempts: 0,
    },
  ];
  pushLineMessageMock.mockReset().mockImplementation(async ({ text }: { text: string }) => {
    if (text.includes("BOOM")) throw new Error("kaboom");
    return { ok: true };
  });
  pushTelegramMessageMock.mockReset().mockResolvedValue({ ok: true });
});

describe("POST /api/notifications/drain — one poisoned row never stalls the batch", () => {
  it("skips an unknown event, isolates a throwing row, and still delivers the healthy row", async () => {
    const response = await POST(drainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      expired: 0,
      processed: 3,
      sent: 2, // unknown (0 recipients → consumed) + ok (delivered)
      retried: 0,
      failed: 1, // the throwing row, marked terminal
    });

    // Two pushes: BOOM threw, OK succeeded. The unknown row had no recipients so
    // was never pushed — and the loop still reached OK (after the throw).
    expect(pushLineMessageMock).toHaveBeenCalledTimes(2);

    // Every row was marked terminal — none left in `sending` to re-crash next run.
    const byId = new Map(rowUpdates.map((u) => [u.id, u.values]));
    expect(byId.get(UNKNOWN_ID)).toMatchObject({ status: "sent" });
    expect(byId.get(BOOM_ID)).toMatchObject({ status: "failed" });
    expect(byId.get(OK_ID)).toMatchObject({ status: "sent" });
  });

  // Spec 318 U3 — a muted recipient is dropped before contact mapping; the
  // row completes as sent (an intentional drop, not a delivery failure).
  it("mutes drop the recipient: no push, row consumed as sent", async () => {
    mutedPrefRows = [{ user_id: SUPER_ID, event_type: "feedback_submitted" }];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "feedback_submitted",
        work_package_id: null,
        purchase_request_id: null,
        payload: {
          feedback_type: "feature",
          role_snapshot: "project_manager",
          feedback_title: "OK",
        },
        attempts: 0,
      },
    ];

    const response = await POST(drainRequest());

    expect(await response.json()).toMatchObject({ processed: 1, sent: 1, failed: 0 });
    expect(pushLineMessageMock).not.toHaveBeenCalled();
    const byId = new Map(rowUpdates.map((u) => [u.id, u.values]));
    expect(byId.get(OK_ID)).toMatchObject({ status: "sent" });
  });

  // Spec 390 — the per-CHANNEL switch, applied at the drain.
  //
  // These exist because a mutation proved the wiring had NO behavioural
  // coverage: deleting `filterChannelTargets` from the LINE arm left every
  // other test in the suite green, so the duplicate this unit removes could
  // come straight back unnoticed.
  function feedbackRow() {
    return {
      id: OK_ID,
      event_type: "feedback_submitted",
      work_package_id: null,
      purchase_request_id: null,
      payload: {
        feedback_type: "feature" as const,
        role_snapshot: "project_manager",
        feedback_title: "OK",
      },
      attempts: 0,
    };
  }

  it("a LINE switch set to off drops the LINE push for that user", async () => {
    channelOffRows = [{ user_id: SUPER_ID, channel: "line" }];
    outboxRows = [feedbackRow()];

    const response = await POST(drainRequest());

    expect(pushLineMessageMock).not.toHaveBeenCalled();
    // recipientCount reaches 0, so the row is consumed rather than retried —
    // an intentional drop, exactly like a mute.
    expect(await response.json()).toMatchObject({ processed: 1, failed: 0 });
    const byId = new Map(rowUpdates.map((u) => [u.id, u.values]));
    expect(byId.get(OK_ID)).toMatchObject({ status: "sent" });
  });

  it("a switch off for the OTHER channel leaves the LINE push alone", async () => {
    // Guards the mirror-image mistake: keying the filter on the wrong channel
    // would silence a user who only ever turned Telegram off.
    channelOffRows = [{ user_id: SUPER_ID, channel: "telegram" }];
    outboxRows = [feedbackRow()];

    await POST(drainRequest());

    expect(pushLineMessageMock).toHaveBeenCalledTimes(1);
  });

  it("a switch belonging to a DIFFERENT user does not suppress delivery", async () => {
    channelOffRows = [{ user_id: BOOM_ID, channel: "line" }];
    outboxRows = [feedbackRow()];

    await POST(drainRequest());

    expect(pushLineMessageMock).toHaveBeenCalledTimes(1);
  });

  it("no channel rows at all = everyone still receives — absence of a row is ON", async () => {
    channelOffRows = [];
    outboxRows = [feedbackRow()];

    await POST(drainRequest());

    expect(pushLineMessageMock).toHaveBeenCalledTimes(1);
  });

  // The TELEGRAM arm needs its own cases: with the bot token unset (this file's
  // default) that whole branch is unreachable, so the filter on it could be
  // deleted with the suite green — half the wiring unpinned. Found by review.
  it("a Telegram switch set to off drops the Telegram push but keeps LINE", async () => {
    envState.telegramToken = "tg-token";
    superUsers = [{ id: SUPER_ID, line_user_id: "Lsuper", telegram_chat_id: "tg-chat" }];
    channelOffRows = [{ user_id: SUPER_ID, channel: "telegram" }];
    outboxRows = [feedbackRow()];

    await POST(drainRequest());

    expect(pushTelegramMessageMock).not.toHaveBeenCalled();
    expect(pushLineMessageMock).toHaveBeenCalledTimes(1);
  });

  it("both channels bound and neither switched off = the duplicate this spec exists to allow, deliberately", async () => {
    envState.telegramToken = "tg-token";
    superUsers = [{ id: SUPER_ID, line_user_id: "Lsuper", telegram_chat_id: "tg-chat" }];
    channelOffRows = [];
    outboxRows = [feedbackRow()];

    await POST(drainRequest());

    // Default is still BOTH — the switches are opt-out, so shipping this
    // changed nobody's delivery until they touch one.
    expect(pushLineMessageMock).toHaveBeenCalledTimes(1);
    expect(pushTelegramMessageMock).toHaveBeenCalledTimes(1);
  });

  it("a LINE switch off still lets the Telegram push through", async () => {
    envState.telegramToken = "tg-token";
    superUsers = [{ id: SUPER_ID, line_user_id: "Lsuper", telegram_chat_id: "tg-chat" }];
    channelOffRows = [{ user_id: SUPER_ID, channel: "line" }];
    outboxRows = [feedbackRow()];

    await POST(drainRequest());

    expect(pushLineMessageMock).not.toHaveBeenCalled();
    expect(pushTelegramMessageMock).toHaveBeenCalledTimes(1);
  });

  // Spec 318 U5 — the per-row project→PM glue: scoped delivery + the
  // unresolvable-project legacy fallback (transition safety).
  it("wp_pending_approval reaches the WP project's PM + org pool, not other-project PMs", async () => {
    const PM_A = "aaaaaaaa-0000-4000-8000-00000000000a";
    const PM_B = "aaaaaaaa-0000-4000-8000-00000000000b";
    const PD_1 = "dddddddd-0000-4000-8000-00000000000d";
    const W1 = "eeeeeeee-0000-4000-8000-00000000000e";
    const P1 = "ffffffff-0000-4000-8000-00000000000f";
    pmPoolUsers = [
      { id: PM_A, role: "project_manager", line_user_id: "LpmA", telegram_chat_id: null },
      { id: PM_B, role: "project_manager", line_user_id: "LpmB", telegram_chat_id: null },
      { id: PD_1, role: "project_director", line_user_id: "Lpd", telegram_chat_id: null },
    ];
    wpTableRows = [{ id: W1, code: "P-01", project_id: P1 }];
    projectRows = [{ id: P1, name: "โครงการทดสอบ", project_lead_id: PM_A }];
    memberRows = [{ project_id: P1, user_id: PM_A }];
    candidateUsers = [
      {
        id: PM_A,
        role: "project_manager",
        line_user_id: "LpmA",
        telegram_chat_id: null,
        full_name: "พีเอ็มเอ",
        line_display_name: null,
      },
    ];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "wp_pending_approval",
        work_package_id: W1,
        purchase_request_id: null,
        payload: { code: "P-01", name: "งานทดสอบ" },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    const targets = pushLineMessageMock.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(targets.sort()).toEqual(["Lpd", "LpmA"]);
    expect(targets).not.toContain("LpmB");
  });

  // Feedback c5136ad9 — the ping names who submitted. The submitter is an SA
  // OUTSIDE the recipient pool, so this pins the whole chain: payload
  // submitted_by → submitterIds → the candidates .in() lookup (captured args —
  // the result-only mock cannot pin that) → composeContext → the pushed text.
  it("wp_pending_approval names the submitter, resolved via the candidates lookup", async () => {
    const PM_A = "aaaaaaaa-0000-4000-8000-00000000000a";
    const PD_1 = "dddddddd-0000-4000-8000-00000000000d";
    const SA_1 = "bbbbbbbb-0000-4000-8000-00000000000b";
    const W1 = "eeeeeeee-0000-4000-8000-00000000000e";
    const P1 = "ffffffff-0000-4000-8000-00000000000f";
    usersInCalls = [];
    pmPoolUsers = [
      { id: PM_A, role: "project_manager", line_user_id: "LpmA", telegram_chat_id: null },
      { id: PD_1, role: "project_director", line_user_id: "Lpd", telegram_chat_id: null },
    ];
    wpTableRows = [{ id: W1, code: "P-01", project_id: P1 }];
    projectRows = [{ id: P1, name: "โครงการทดสอบ", project_lead_id: PM_A }];
    memberRows = [{ project_id: P1, user_id: PM_A }];
    candidateUsers = [
      {
        id: PM_A,
        role: "project_manager",
        line_user_id: "LpmA",
        telegram_chat_id: null,
        full_name: "พีเอ็มเอ",
        line_display_name: null,
      },
      {
        id: SA_1,
        role: "site_admin",
        line_user_id: null,
        telegram_chat_id: null,
        full_name: "สมชาย ทดสอบ",
        line_display_name: null,
      },
    ];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "wp_pending_approval",
        work_package_id: W1,
        purchase_request_id: null,
        payload: { code: "P-01", name: "งานทดสอบ", submitted_by: SA_1 },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    // The submitter uid reached the candidates lookup (not just the pool ids).
    const candidateCall = usersInCalls.find((c) => c.cols.includes("full_name"));
    expect(candidateCall?.ids).toContain(SA_1);
    // Every delivered ping carries the submitter line.
    const texts = pushLineMessageMock.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).toContain("ส่งตรวจโดย สมชาย ทดสอบ");
    }
  });

  // Operator report 2026-07-31 — "procurement manager cannot yet see requested
  // PRs instantly". The pool query was PM_ROLES-only, so the spec-286 PR decider
  // was never fetched, let alone notified. These two pin the SPLIT: the decider
  // joins pr_created and stays out of wp_pending_approval.
  it("pr_created reaches the spec-286 purchase decider alongside the PM pool", async () => {
    const PM_A = "aaaaaaaa-0000-4000-8000-00000000000a";
    const PD_1 = "dddddddd-0000-4000-8000-00000000000d";
    const PROC_M = "cccccccc-0000-4000-8000-00000000000c";
    pmPoolUsers = [
      { id: PM_A, role: "project_manager", line_user_id: "LpmA", telegram_chat_id: null },
      { id: PD_1, role: "project_director", line_user_id: "Lpd", telegram_chat_id: null },
      { id: PROC_M, role: "procurement_manager", line_user_id: "Lproc", telegram_chat_id: null },
    ];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "pr_created",
        work_package_id: null,
        purchase_request_id: "99999999-0000-4000-8000-000000000009",
        payload: { item_description: "ปูน", quantity: 1, unit: "ถุง", pr_number: 9 },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    const targets = pushLineMessageMock.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(targets).toContain("Lproc");
  });

  it("wp_pending_approval never reaches the purchase decider, even on the legacy fallback", async () => {
    const PM_A = "aaaaaaaa-0000-4000-8000-00000000000a";
    const PD_1 = "dddddddd-0000-4000-8000-00000000000d";
    const PROC_M = "cccccccc-0000-4000-8000-00000000000c";
    const W1 = "eeeeeeee-0000-4000-8000-00000000000e";
    pmPoolUsers = [
      { id: PM_A, role: "project_manager", line_user_id: "LpmA", telegram_chat_id: null },
      { id: PD_1, role: "project_director", line_user_id: "Lpd", telegram_chat_id: null },
      { id: PROC_M, role: "procurement_manager", line_user_id: "Lproc", telegram_chat_id: null },
    ];
    // No project on the WP → eventProjectPmIds null → the legacy FULL pool path,
    // which is where an un-split pool would leak the decider into WP approvals.
    wpTableRows = [{ id: W1, code: "P-02", project_id: null }];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "wp_pending_approval",
        work_package_id: W1,
        purchase_request_id: null,
        payload: { code: "P-02", name: "งานทดสอบ" },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    const targets = pushLineMessageMock.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(targets).not.toContain("Lproc");
    expect(targets.sort()).toEqual(["Lpd", "LpmA"]);
  });

  it("pr_created without a project payload falls back to the FULL legacy pool", async () => {
    const PM_A = "aaaaaaaa-0000-4000-8000-00000000000a";
    const PM_B = "aaaaaaaa-0000-4000-8000-00000000000b";
    const PD_1 = "dddddddd-0000-4000-8000-00000000000d";
    pmPoolUsers = [
      { id: PM_A, role: "project_manager", line_user_id: "LpmA", telegram_chat_id: null },
      { id: PM_B, role: "project_manager", line_user_id: "LpmB", telegram_chat_id: null },
      { id: PD_1, role: "project_director", line_user_id: "Lpd", telegram_chat_id: null },
    ];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "pr_created",
        work_package_id: null,
        purchase_request_id: "99999999-0000-4000-8000-000000000009",
        // pre-318 queue row: NO project_id in payload → legacy full pool.
        payload: { item_description: "ปูน", quantity: 1, unit: "ถุง", pr_number: 9 },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    const targets = pushLineMessageMock.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(targets.sort()).toEqual(["Lpd", "LpmA", "LpmB"]);
  });

  it("a mute for a DIFFERENT event does not suppress delivery", async () => {
    mutedPrefRows = [{ user_id: SUPER_ID, event_type: "pr_progress" }];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "feedback_submitted",
        work_package_id: null,
        purchase_request_id: null,
        payload: {
          feedback_type: "feature",
          role_snapshot: "project_manager",
          feedback_title: "OK",
        },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    expect(pushLineMessageMock).toHaveBeenCalledTimes(1);
  });
});

// Spec 402 U3 — feedback + the receipt-correction pair. Same load-bearing
// question as U2: does each event's link land somewhere its RECIPIENTS can
// actually open?
describe("POST /api/notifications/drain — spec 402 U3 feedback + correction enrichment", () => {
  const REPORTER = "aaaaaaaa-0000-4000-8000-0000000005a1";
  const FB_ID = "cccccccc-0000-4000-8000-0000000005c1";
  const P1 = "ffffffff-0000-4000-8000-0000000005f1";
  const BO_1 = "dddddddd-0000-4000-8000-0000000005d1";

  it("names the feedback reporter and links straight to the report", async () => {
    usersInCalls = [];
    candidateUsers = [
      {
        id: REPORTER,
        role: "site_admin",
        line_user_id: null,
        telegram_chat_id: null,
        full_name: "สมชาย ทดสอบ",
        line_display_name: null,
      },
    ];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "feedback_submitted",
        work_package_id: null,
        purchase_request_id: null,
        payload: {
          feedback_id: FB_ID,
          feedback_type: "bug",
          role_snapshot: "site_admin",
          feedback_title: "รูปอัปโหลดไม่ขึ้น",
          submitted_by: REPORTER,
        },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    // The reporter uid reached the candidates lookup — they are NOT a recipient
    // (the super pool is), so nothing else would have fetched their name.
    const candidateCall = usersInCalls.find((c) => c.cols.includes("full_name"));
    expect(candidateCall?.ids).toContain(REPORTER);

    const texts = pushLineMessageMock.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe(
      [
        "🐞 ข้อเสนอแนะใหม่ (ปัญหา)",
        "รูปอัปโหลดไม่ขึ้น",
        "แจ้งโดย สมชาย ทดสอบ (ผู้ดูแลหน้างาน)",
      ].join("\n"),
    );
  });

  // The flagged event goes to BACK_OFFICE_ROLES, whose queue is /store/corrections.
  // The resolved event goes to the SA who flagged, who would be REFUSED there —
  // so the absence of the queue URL is as load-bearing as the presence.
  it("sends the flagged correction to the back-office queue, naming the flagger", async () => {
    projectRows = [{ id: P1, name: "โครงการบ้านสวย", project_lead_id: null }];
    contactUsers = [{ id: BO_1, line_user_id: "Lbo", telegram_chat_id: null }];
    candidateUsers = [
      {
        id: REPORTER,
        role: "site_admin",
        line_user_id: null,
        telegram_chat_id: null,
        full_name: "สมชาย ทดสอบ",
        line_display_name: null,
      },
    ];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "receipt_correction_flagged",
        work_package_id: null,
        purchase_request_id: null,
        payload: {
          requested_by: REPORTER,
          item_description: "ปูนซีเมนต์",
          project_id: P1,
        },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    const texts = pushLineMessageMock.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe(
      ["⚠️ แจ้งแก้ไขจำนวนรับของ", "ปูนซีเมนต์", "โครงการบ้านสวย", "แจ้งโดย สมชาย ทดสอบ"].join("\n"),
    );
  });

  // Spec 402 U4 — this case used to pin WHICH link the resolved event got. With
  // links gone it pins what remains: the item and project reach the flagger,
  // and the message still names no actor (its only uid is the recipient's).
  it("tells the flagger the correction was resolved, naming the item but no actor", async () => {
    projectRows = [{ id: P1, name: "โครงการบ้านสวย", project_lead_id: null }];
    contactUsers = [{ id: REPORTER, line_user_id: "Lsa", telegram_chat_id: null }];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "receipt_correction_resolved",
        work_package_id: null,
        purchase_request_id: null,
        payload: {
          requested_by: REPORTER,
          item_description: "ปูนซีเมนต์",
          project_id: P1,
        },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    const texts = pushLineMessageMock.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe(["✅ แก้ไขจำนวนรับของแล้ว", "ปูนซีเมนต์", "โครงการบ้านสวย"].join("\n"));
  });
});

// Spec 402 U2 — the work-package family. The link is the load-bearing part:
// /review/work-packages is requireRole(PM_ROLES), and one outbox row produces
// ONE body for every recipient, so an event whose recipients are photo
// UPLOADERS must not be pointed at it.
describe("POST /api/notifications/drain — spec 402 U2 work-package enrichment", () => {
  const W1 = "eeeeeeee-0000-4000-8000-0000000004e1";
  const P1 = "ffffffff-0000-4000-8000-0000000004f2";
  const PM_A = "aaaaaaaa-0000-4000-8000-00000000000a";
  const SA_1 = "bbbbbbbb-0000-4000-8000-0000000004b2";

  it("gives wp_decision the WP name and project it never had, plus the PROJECT link", async () => {
    wpTableRows = [{ id: W1, code: "WP-02-06", project_id: P1, name: "งานจัดหาห้องน้ำชั่วคราว" }];
    projectRows = [{ id: P1, name: "โครงการบ้านสวย", project_lead_id: null }];
    memberRows = [];
    candidateUsers = [
      {
        id: PM_A,
        role: "project_manager",
        line_user_id: null,
        telegram_chat_id: null,
        full_name: "พีเอ็มเอ",
        line_display_name: null,
      },
    ];
    // The recipient is the WP's photo uploader (resolved from photo_logs), not
    // the decider — who is excluded from their own decision.
    photoLogRows = [{ work_package_id: W1, uploaded_by: SA_1 }];
    contactUsers = [{ id: SA_1, line_user_id: "Lsa", telegram_chat_id: null }];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "wp_decision",
        work_package_id: W1,
        purchase_request_id: null,
        payload: { decision: "approved", comment: null, decided_by: PM_A },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    const texts = pushLineMessageMock.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe(
      [
        "✅ ผลการตรวจ: อนุมัติแล้ว",
        "งานจัดหาห้องน้ำชั่วคราว",
        "โครงการบ้านสวย · WP-02-06",
        "ตรวจโดย พีเอ็มเอ",
      ].join("\n"),
    );
  });

  it("points wp_pending_approval at the REVIEW queue, not the project surface", async () => {
    pmPoolUsers = [
      { id: PM_A, role: "project_manager", line_user_id: "LpmA", telegram_chat_id: null },
    ];
    wpTableRows = [{ id: W1, code: "WP-02-06", project_id: P1, name: "งานจัดหาห้องน้ำชั่วคราว" }];
    projectRows = [{ id: P1, name: "โครงการบ้านสวย", project_lead_id: PM_A }];
    memberRows = [{ project_id: P1, user_id: PM_A }];
    candidateUsers = [
      {
        id: PM_A,
        role: "project_manager",
        line_user_id: "LpmA",
        telegram_chat_id: null,
        full_name: "พีเอ็มเอ",
        line_display_name: null,
      },
      {
        id: SA_1,
        role: "site_admin",
        line_user_id: null,
        telegram_chat_id: null,
        full_name: "สมชาย ทดสอบ",
        line_display_name: null,
      },
    ];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "wp_pending_approval",
        work_package_id: W1,
        purchase_request_id: null,
        payload: { code: "WP-02-06", name: "งานจัดหาห้องน้ำชั่วคราว", submitted_by: SA_1 },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    const texts = pushLineMessageMock.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).toContain("โครงการบ้านสวย · WP-02-06");
    }
  });
});

// Spec 402 U1 — the purchase-request family's skeleton slots. These batches
// contain NO site-issue row and NO work-package row, so they also pin that the
// PR legs resolve on their own: the enrichment gate must not depend on another
// leg being non-empty (the latent-coupling shape the submitter arm was fixed
// for).
describe("POST /api/notifications/drain — spec 402 U1 purchase-request enrichment", () => {
  const REQUESTER = "aaaaaaaa-0000-4000-8000-0000000004a1";
  const PR_UUID = "bbbbbbbb-0000-4000-8000-0000000004b1";
  const P1 = "ffffffff-0000-4000-8000-0000000004f1";

  it("gives pr_progress its project, item and deep link — and names no actor", async () => {
    prProjectIdByRequest = { [PR_UUID]: P1 };
    projectRows = [{ id: P1, name: "โครงการบ้านสวย", project_lead_id: null }];
    memberRows = [{ project_id: P1, user_id: REQUESTER }];
    candidateUsers = [
      {
        id: REQUESTER,
        role: "site_admin",
        line_user_id: "Lreq",
        telegram_chat_id: null,
        full_name: "สมชาย ทดสอบ",
        line_display_name: null,
      },
    ];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "pr_progress",
        work_package_id: null,
        purchase_request_id: PR_UUID,
        payload: {
          pr_number: 12,
          item_description: "เหล็กกล่อง กาวาไนซ์",
          transition: ["purchased", "on_route"],
          requested_by: REQUESTER,
          // The trigger snapshots decided_by from approved_by — the APPROVER,
          // not whoever shipped it.
          decided_by: REQUESTER,
        },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    const texts = pushLineMessageMock.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts).toHaveLength(1);
    const text = texts[0] as string;
    expect(text).toContain("เหล็กกล่อง กาวาไนซ์");
    expect(text).toContain("โครงการบ้านสวย");
    expect(text).toContain("สั่งซื้อแล้ว → กำลังจัดส่ง");
    // 🚨 The name IS resolvable here (the candidates lookup returned it), so
    // this pins the DECISION not to render it, never a lookup that came back
    // empty. Attributing a shipment to the approver is the misattribution the
    // pr_progress arm exists to avoid.
    expect(text).not.toContain("สมชาย ทดสอบ");
  });

  it("names the requester on pr_created, resolved via the candidates lookup", async () => {
    const PM_A = "aaaaaaaa-0000-4000-8000-00000000000a";
    usersInCalls = [];
    prProjectIdByRequest = { [PR_UUID]: P1 };
    projectRows = [{ id: P1, name: "โครงการบ้านสวย", project_lead_id: PM_A }];
    memberRows = [{ project_id: P1, user_id: PM_A }];
    pmPoolUsers = [
      { id: PM_A, role: "project_manager", line_user_id: "LpmA", telegram_chat_id: null },
    ];
    candidateUsers = [
      {
        id: PM_A,
        role: "project_manager",
        line_user_id: "LpmA",
        telegram_chat_id: null,
        full_name: "พีเอ็มเอ",
        line_display_name: null,
      },
      {
        id: REQUESTER,
        role: "site_admin",
        line_user_id: null,
        telegram_chat_id: null,
        full_name: "สมชาย ทดสอบ",
        line_display_name: null,
      },
    ];
    outboxRows = [
      {
        id: OK_ID,
        event_type: "pr_created",
        work_package_id: null,
        purchase_request_id: PR_UUID,
        payload: {
          pr_number: 7,
          item_description: "ปูน",
          quantity: 10,
          unit: "ถุง",
          project_id: P1,
          requested_by: REQUESTER,
        },
        attempts: 0,
      },
    ];

    await POST(drainRequest());

    // The requester uid reached the candidates lookup — a result-only assertion
    // could not tell that apart from a name that happened to be in the pool.
    const candidateCall = usersInCalls.find((c) => c.cols.includes("full_name"));
    expect(candidateCall?.ids).toContain(REQUESTER);

    const texts = pushLineMessageMock.mock.calls.map((c) => (c[0] as { text: string }).text);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).toBe(
        ["🆕 คำขอซื้อใหม่", "ปูน × 10 ถุง", "โครงการบ้านสวย · PR-0007", "ขอโดย สมชาย ทดสอบ"].join(
          "\n",
        ),
      );
    }
  });
});
