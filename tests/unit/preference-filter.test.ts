// Spec 318 U3 — pure drain-side mute filter. Muted key = `${userId}:${event}`;
// locked events bypass the filter entirely (safety alerts are unmutable).

import { describe, it, expect } from "vitest";
import { filterMutedRecipients } from "@/lib/notifications/preference-filter";

describe("filterMutedRecipients", () => {
  it("drops recipients whose (user, event) key is muted", () => {
    const muted = new Set(["u1:pr_progress"]);
    expect(filterMutedRecipients(["u1", "u2"], "pr_progress", muted)).toEqual(["u2"]);
  });

  it("keeps recipients muted for a DIFFERENT event", () => {
    const muted = new Set(["u1:pr_progress"]);
    expect(filterMutedRecipients(["u1"], "pr_decision", muted)).toEqual(["u1"]);
  });

  it("locked event ignores mutes entirely", () => {
    const muted = new Set(["u1:site_issue_reported"]);
    expect(filterMutedRecipients(["u1"], "site_issue_reported", muted)).toEqual(["u1"]);
  });

  it("empty mute set is a no-op", () => {
    expect(filterMutedRecipients(["u1", "u2"], "wp_decision", new Set())).toEqual(["u1", "u2"]);
  });
});
