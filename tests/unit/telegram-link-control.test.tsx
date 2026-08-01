import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { TelegramLinkControl } from "@/components/features/notifications/telegram-link-control";
import {
  NOTIF_TELEGRAM_BIND_BUTTON,
  NOTIF_TELEGRAM_NOT_CONFIGURED,
  NOTIF_TELEGRAM_PRIVACY_HINT,
  NOTIF_TELEGRAM_ROW,
  NOTIF_TELEGRAM_UNLINK_BUTTON,
  NOTIF_TELEGRAM_UNLINKED_ROW,
} from "@/lib/i18n/labels";

vi.mock("@/app/settings/notifications/actions", () => ({
  startTelegramLink: vi.fn(),
  unlinkTelegram: vi.fn(),
}));

// Spec 386 U3 — the three states this row can be in. The unlinked state is the
// one that did not exist before (§1.3: 39 of 40 users were shown nothing), and
// the not-configured state is the honest-copy arm: while U0 is undone, binding
// cannot work, so no button may be offered.
describe("TelegramLinkControl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unlinked + bot configured: offers the bind button and states what is stored", () => {
    render(<TelegramLinkControl linked={false} botConfigured />);

    expect(screen.getByRole("button", { name: NOTIF_TELEGRAM_BIND_BUTTON })).toBeInTheDocument();
    expect(screen.getByText(NOTIF_TELEGRAM_UNLINKED_ROW)).toBeInTheDocument();
    // PDPA notice at the point of collection — before the tap, not after.
    expect(screen.getByText(NOTIF_TELEGRAM_PRIVACY_HINT)).toBeInTheDocument();
    expect(screen.queryByText(NOTIF_TELEGRAM_NOT_CONFIGURED)).not.toBeInTheDocument();
  });

  it("unlinked + bot NOT configured: no bind button at all, and says why", () => {
    render(<TelegramLinkControl linked={false} botConfigured={false} />);

    // A button that can only refuse is worse than no button: it reads as a bug.
    expect(
      screen.queryByRole("button", { name: NOTIF_TELEGRAM_BIND_BUTTON }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(NOTIF_TELEGRAM_NOT_CONFIGURED)).toBeInTheDocument();
  });

  it("linked: shows the ✓ row and an unlink button, and drops the bind affordance", () => {
    render(<TelegramLinkControl linked botConfigured />);

    expect(screen.getByText(NOTIF_TELEGRAM_ROW)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: NOTIF_TELEGRAM_UNLINK_BUTTON })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: NOTIF_TELEGRAM_BIND_BUTTON }),
    ).not.toBeInTheDocument();
  });

  it("linked + bot unconfigured still offers unlink — a bound user must never be trapped", () => {
    // The token can be removed from Vercel after someone bound. Unbinding must
    // not depend on the bot being configured, or that user can never get out.
    render(<TelegramLinkControl linked botConfigured={false} />);

    expect(screen.getByRole("button", { name: NOTIF_TELEGRAM_UNLINK_BUTTON })).toBeInTheDocument();
  });
});
