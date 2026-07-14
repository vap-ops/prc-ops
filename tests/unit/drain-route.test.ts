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

vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: "line-token",
    NOTIFICATION_DRAIN_SECRET: "drain-secret",
    // Telegram intentionally unset — exercise the LINE-only path.
    TELEGRAM_BOT_TOKEN: undefined,
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
let rowUpdates: Array<{ id: unknown; values: Record<string, unknown> }> = [];

const pushLineMessageMock = vi.fn();

vi.mock("@/lib/notifications/line-push", () => ({
  pushLineMessage: (args: unknown) => pushLineMessageMock(args),
}));
vi.mock("@/lib/notifications/telegram-push", () => ({
  pushTelegramMessage: vi.fn(),
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
          select: () => ({
            // super_admin pool (feedback_submitted)
            eq: async () => ({ data: superUsers, error: null }),
            // extra-user / role-pool lookups — not exercised by this batch
            in: async () => ({ data: [], error: null }),
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
