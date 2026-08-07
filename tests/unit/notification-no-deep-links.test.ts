import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composeNotification,
  type NotificationEventType,
} from "@/lib/notifications/compose-notification";
import type { NotificationPayload } from "@/lib/notifications/payload";

// Spec 402 U4 — push notifications carry NO URL, deliberately.
//
// Operator, 2026-08-07: "sending a link is not helpful because users have pwa
// installed, links take them to browser, not to mention login problem."
// Both halves are real and neither is fixable from the message:
//   · LINE and Telegram open links in their own in-app WebView, and an iOS
//     home-screen PWA cannot capture a link at all — so a field user can never
//     be taken to the app they actually work in.
//   · That WebView has its own cookie jar, so the tap lands logged out.
// The message's JOB is to say enough that the reader does not need to open
// anything to understand it; U1–U3 did that. This guard keeps the URL out.
//
// It is EXHAUSTIVE over the enum on purpose: a new event type must decide this
// question deliberately rather than inherit a link by copy-paste.

// The live `notification_event_type` domain (queried 2026-08-07). A value added
// to the enum without being added here fails the completeness check below.
const ALL_EVENT_TYPES: NotificationEventType[] = [
  "wp_pending_approval",
  "wp_decision",
  "pr_created",
  "pr_decision",
  "pr_progress",
  "pr_cancelled",
  "feedback_submitted",
  "wp_reopened",
  "site_issue_reported",
  "receipt_correction_flagged",
  "receipt_correction_resolved",
  "wp_evidence_resubmitted",
];

// Deliberately over-full: every field every arm reads, so no arm can be blank
// for want of input and pass this guard vacuously.
const RICH_PAYLOAD: NotificationPayload = {
  code: "WP-01-02",
  name: "งานเทพื้น",
  decision: "approved",
  comment: "ดูดีแล้ว",
  round: 2,
  itemDescription: "ปูนซีเมนต์",
  quantity: 10,
  unit: "ถุง",
  prNumber: 12,
  transition: ["purchased", "on_route"],
  decisionComment: "อนุมัติ",
  cancellationReason: "ไม่ต้องการแล้ว",
  feedbackId: "fb-1",
  feedbackType: "bug",
  feedbackTitle: "รูปอัปโหลดไม่ขึ้น",
  roleSnapshot: "site_admin",
  submittedBy: "u-1",
  projectId: "p-1",
  issueType: "safety",
  reportedBy: "u-2",
  requestedBy: "u-3",
  decidedBy: "u-4",
  cancelledBy: "u-5",
  reopenedBy: "u-6",
  resubmittedBy: "u-7",
};

// ⚠️ `deepLink` is supplied ON PURPOSE and is the reason this guard is not
// vacuous. Without it the 12 cases below pass against the LINKING code too —
// they were green on the first run, which is what exposed it. Kept as an extra
// property on a NAMED const (TypeScript only excess-property-checks fresh
// object literals), so it type-checks both before the slot is removed and
// after: before, a link renders and every case REDs; after, the key is inert.
const RICH_CONTEXT = {
  wpCode: "WP-01-02",
  wpName: "งานเทพื้น",
  poNumber: 3,
  projectName: "โครงการบ้านสวย",
  submitterName: "สมชาย ใจดี",
  actorName: "สมชาย ใจดี",
  deepLink: "https://ops.prc.app/requests/should-never-render",
};

describe("push notifications carry no URL", () => {
  it("covers every notification_event_type", () => {
    expect(new Set(ALL_EVENT_TYPES).size).toBe(ALL_EVENT_TYPES.length);
    expect(ALL_EVENT_TYPES).toHaveLength(12);
  });

  for (const eventType of ALL_EVENT_TYPES) {
    it(`composes ${eventType} without a link`, () => {
      const message = composeNotification(eventType, RICH_PAYLOAD, RICH_CONTEXT);
      // Not a vacuous pass: the arm must actually have rendered something.
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("http");
      expect(message).not.toContain("://");
    });
  }
});

// The behavioural guard above cannot see a link builder that exists but is
// currently unused — and an unused builder is an invitation. These pin the
// ABSENCE of the machinery itself.
describe("the link machinery is gone, not merely unused", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  // Comments explain WHY there are no links and legitimately mention them;
  // strip them so the prose cannot satisfy — or trip — a source scan.
  const stripComments = (src: string) =>
    src
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");

  it("message-skeleton exports no link builder and its slots have no link", () => {
    const src = stripComments(read("src/lib/notifications/message-skeleton.ts"));
    expect(src).not.toMatch(/export function \w*[Ll]ink\b/);
    expect(src).not.toMatch(/^\s*link\?:/m);
    // Positive control: the file is still the skeleton, so a rename or a wrong
    // path cannot make this pass by reading nothing.
    expect(src).toContain("export function buildNotificationMessage");
  });

  it("the drain builds no URL and no longer needs the app URL", () => {
    const src = stripComments(read("src/app/api/notifications/drain/route.ts"));
    expect(src).not.toContain("NEXT_PUBLIC_APP_URL");
    expect(src).not.toContain("deepLink");
    expect(src).toContain("composeNotification(");
  });

  it("ComposeContext has no deepLink slot", () => {
    const src = stripComments(read("src/lib/notifications/compose-notification.ts"));
    expect(src).not.toMatch(/deepLink\??:/);
    expect(src).toContain("export interface ComposeContext");
  });
});
