// Spec 390 U2 — the per-channel switches on /settings/notifications.
//
// The risk this file exists for: the UI's floor and the RPC's floor disagreeing,
// so the page either offers a switch that errors on tap or greys out one the
// database would happily accept. Every case below has a pgTAP sibling in
// supabase/tests/database/390-notification-channels.test.sql.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const saveMock = vi.fn();
vi.mock("@/app/settings/notifications/actions", () => ({
  saveNotificationChannelPreference: (...args: unknown[]) => saveMock(...args),
}));

import { NotificationChannelForm } from "@/components/features/notifications/channel-preferences-form";
import {
  NOTIF_CHANNEL_LAST_ONE_HINT,
  NOTIF_CHANNEL_LINE_UNREACHABLE_HINT,
  NOTIF_CHANNEL_NONE_BOUND,
} from "@/lib/i18n/labels";

beforeEach(() => saveMock.mockReset().mockResolvedValue({ ok: true }));

const dualBound = {
  lineBound: true,
  lineFriendFlag: true,
  telegramBound: true,
  disabledChannels: [] as const,
};

describe("NotificationChannelForm", () => {
  it("renders one switch per BOUND channel — an unbound channel has nothing to switch", () => {
    render(<NotificationChannelForm {...dualBound} telegramBound={false} />);
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.queryByRole("switch", { name: "Telegram" })).toBeNull();
    expect(screen.getByRole("switch", { name: "LINE" })).toBeTruthy();
  });

  it("renders nothing to switch, and says so, when no channel is bound", () => {
    render(
      <NotificationChannelForm
        lineBound={false}
        lineFriendFlag={null}
        telegramBound={false}
        disabledChannels={[]}
      />,
    );
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByText(NOTIF_CHANNEL_NONE_BOUND)).toBeTruthy();
  });

  it("leaves both switches operable when either could be turned off", () => {
    render(<NotificationChannelForm {...dualBound} />);
    for (const name of ["LINE", "Telegram"]) {
      expect(screen.getByRole("switch", { name }).getAttribute("aria-disabled")).toBe("false");
    }
    expect(screen.queryByText(NOTIF_CHANNEL_LAST_ONE_HINT)).toBeNull();
  });

  it("locks the only bound channel ON and says WHY", () => {
    render(<NotificationChannelForm {...dualBound} telegramBound={false} />);
    const line = screen.getByRole("switch", { name: "LINE" });
    expect(line.getAttribute("aria-disabled")).toBe("true");
    expect(line.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(NOTIF_CHANNEL_LAST_ONE_HINT)).toBeTruthy();
  });

  it("a locked switch calls no action at all when tapped", () => {
    render(<NotificationChannelForm {...dualBound} telegramBound={false} />);
    fireEvent.click(screen.getByRole("switch", { name: "LINE" }));
    expect(saveMock).not.toHaveBeenCalled();
  });

  // The finding that reshaped the whole spec, mirrored on the client: a bound
  // LINE that is a VERIFIED non-friend cannot deliver, so Telegram is the last
  // real channel and must be the locked one — not LINE.
  it("treats a verified non-friend LINE as unreachable: Telegram locks, LINE stays operable", () => {
    render(<NotificationChannelForm {...dualBound} lineFriendFlag={false} />);
    expect(screen.getByRole("switch", { name: "Telegram" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(screen.getByRole("switch", { name: "LINE" }).getAttribute("aria-disabled")).toBe(
      "false",
    );
    expect(screen.getByText(NOTIF_CHANNEL_LINE_UNREACHABLE_HINT)).toBeTruthy();
  });

  it("treats a NULL friend flag as reachable — never probed is not unreachable", () => {
    render(<NotificationChannelForm {...dualBound} lineFriendFlag={null} />);
    expect(screen.getByRole("switch", { name: "Telegram" }).getAttribute("aria-disabled")).toBe(
      "false",
    );
  });

  it("flipping a switch off calls the action with (channel, false)", async () => {
    render(<NotificationChannelForm {...dualBound} />);
    fireEvent.click(screen.getByRole("switch", { name: "LINE" }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith("line", false));
  });

  it("an OFF switch is always operable — turning a channel back on is never blocked", async () => {
    // Both off: the floor would refuse a further disable, but an ENABLE must
    // always go through, or a user who silenced everything is stuck forever.
    render(<NotificationChannelForm {...dualBound} disabledChannels={["line", "telegram"]} />);
    const line = screen.getByRole("switch", { name: "LINE" });
    expect(line.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(line);
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith("line", true));
  });

  it("rolls the switch back and shows the reason when the action refuses", async () => {
    saveMock.mockResolvedValue({ ok: false, error: NOTIF_CHANNEL_LAST_ONE_HINT });
    render(<NotificationChannelForm {...dualBound} />);
    const line = screen.getByRole("switch", { name: "LINE" });
    fireEvent.click(line);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("ปิดไม่ได้"));
    expect(screen.getByRole("switch", { name: "LINE" }).getAttribute("aria-checked")).toBe("true");
  });
});
