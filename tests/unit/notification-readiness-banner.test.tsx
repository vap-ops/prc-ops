// Spec 318 U2 — OA-friend readiness banner. Shows ONLY on a confirmed
// non-friend (friendFlag === false): null = never probed (don't nag —
// the flag populates at the user's next login), true = reachable.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotificationReadinessBanner } from "@/components/features/notifications/readiness-banner";
import { OA_ADD_FRIEND_URL } from "@/lib/notifications/readiness";

const base = { lineLinked: true, checkedAt: "2026-07-14T00:00:00Z", telegramLinked: false };

describe("NotificationReadinessBanner", () => {
  it("renders the add-friend CTA when the user is a confirmed non-friend", () => {
    render(<NotificationReadinessBanner readiness={{ ...base, friendFlag: false }} />);
    const banner = screen.getByTestId("notif-readiness-banner");
    expect(banner).toBeTruthy();
    const link = screen.getByRole("link", { name: /เพิ่มเพื่อน/ });
    expect(link.getAttribute("href")).toBe(OA_ADD_FRIEND_URL);
  });

  it("renders nothing when the user is already a friend", () => {
    const { container } = render(
      <NotificationReadinessBanner readiness={{ ...base, friendFlag: true }} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when friendship was never probed (null)", () => {
    const { container } = render(
      <NotificationReadinessBanner readiness={{ ...base, friendFlag: null, checkedAt: null }} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
