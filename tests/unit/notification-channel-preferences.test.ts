import { describe, it, expect } from "vitest";

import {
  channelKey,
  filterChannelTargets,
  reachableChannels,
  canDisableChannel,
  canSetChannel,
  NOTIFICATION_CHANNELS,
  type ChannelBindingInput,
} from "@/lib/notifications/channel-preference-filter";

// Spec 390 U2. The cases below deliberately mirror the pgTAP fixtures A–G in
// supabase/tests/database/390-notification-channels.test.sql, because the whole
// risk of this unit is the CLIENT floor and the SQL floor disagreeing: the UI
// would then offer a switch the RPC refuses, or grey out one it would allow.
const bound = (over: Partial<ChannelBindingInput> = {}): ChannelBindingInput => ({
  lineBound: true,
  lineFriendFlag: true,
  telegramBound: true,
  disabled: new Set(),
  ...over,
});

describe("reachableChannels", () => {
  it("counts LINE only when the OA-friend flag is not false — a 403 is not delivery", () => {
    expect([...reachableChannels(bound({ lineFriendFlag: false }))]).toEqual(["telegram"]);
  });

  it("counts LINE when the friend flag is NULL — never probed is not unreachable", () => {
    expect([...reachableChannels(bound({ lineFriendFlag: null }))].sort()).toEqual([
      "line",
      "telegram",
    ]);
  });

  it("counts neither channel when nothing is bound", () => {
    expect([...reachableChannels(bound({ lineBound: false, telegramBound: false }))]).toEqual([]);
  });

  it("ignores the enabled state — reachability is about delivery, not preference", () => {
    const rows = reachableChannels(bound({ disabled: new Set(["line", "telegram"] as const) }));
    expect([...rows].sort()).toEqual(["line", "telegram"]);
  });
});

describe("canDisableChannel — the floor, mirroring set_notification_channel_preference", () => {
  it("A: allows disabling LINE while Telegram is reachable and on", () => {
    expect(canDisableChannel(bound(), "line")).toBe(true);
  });

  it("A: refuses the last reachable enabled channel", () => {
    expect(canDisableChannel(bound({ disabled: new Set(["line"] as const) }), "telegram")).toBe(
      false,
    );
  });

  it("B: refuses disabling Telegram when LINE is bound but a verified non-friend", () => {
    expect(canDisableChannel(bound({ lineFriendFlag: false }), "telegram")).toBe(false);
  });

  it("B: still allows disabling the channel that cannot reach them", () => {
    expect(canDisableChannel(bound({ lineFriendFlag: false }), "line")).toBe(true);
  });

  it("C: allows disabling Telegram when the friend flag is null", () => {
    expect(canDisableChannel(bound({ lineFriendFlag: null }), "telegram")).toBe(true);
  });

  it("F: stands down entirely when NOTHING is reachable — there is nothing to protect", () => {
    // The SQL floor skips its check when the reachable set is empty. If this
    // returned false the UI would grey out a switch the RPC would accept, and
    // tell 11 live users a channel would be lost that already delivers nothing.
    expect(canDisableChannel(bound({ lineFriendFlag: false, telegramBound: false }), "line")).toBe(
      true,
    );
  });

  it("is a DISABLE-only question — a user with everything off must still be able to switch one back on", () => {
    // Regression guard for a real footgun this test caught: gating an ENABLE on
    // canDisableChannel would strand a user who had turned everything off, and
    // it would not match the RPC, whose floor sits behind `if not p_enabled`.
    const allOff = bound({ disabled: new Set(["line", "telegram"] as const) });
    expect(canDisableChannel(allOff, "line")).toBe(false);
    expect(canSetChannel(allOff, "line", true)).toBe(true);
    expect(canSetChannel(allOff, "line", false)).toBe(false);
  });

  it("canSetChannel allows an enable even when nothing is reachable", () => {
    const nothing = bound({ lineFriendFlag: false, telegramBound: false });
    expect(canSetChannel(nothing, "telegram", true)).toBe(true);
  });
});

describe("filterChannelTargets", () => {
  it("drops only the users who switched THAT channel off", () => {
    const disabled = new Set([channelKey("u1", "line"), channelKey("u2", "telegram")]);
    expect(filterChannelTargets(["u1", "u2", "u3"], "line", disabled)).toEqual(["u2", "u3"]);
    expect(filterChannelTargets(["u1", "u2", "u3"], "telegram", disabled)).toEqual(["u1", "u3"]);
  });

  it("keeps everyone when no preference rows exist — absence of a row is ON", () => {
    expect(filterChannelTargets(["u1", "u2"], "line", new Set())).toEqual(["u1", "u2"]);
  });

  it("does NOT bypass for any event — unlike the per-event mute filter", () => {
    // filterMutedRecipients lets LOCKED events through. The channel filter must
    // not copy that: the floor already guarantees a channel remains, so a bypass
    // would only resurrect the duplicate for the rarest event class.
    const disabled = new Set([channelKey("u1", "line")]);
    expect(filterChannelTargets(["u1"], "line", disabled)).toEqual([]);
  });
});

describe("NOTIFICATION_CHANNELS", () => {
  it("is exactly the live enum, in order", () => {
    expect(NOTIFICATION_CHANNELS).toEqual(["line", "telegram"]);
  });
});
