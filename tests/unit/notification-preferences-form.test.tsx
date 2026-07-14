// Spec 318 U4 — the /settings/notifications toggle form. One row per catalog
// entry the caller can receive; a locked entry is greyed-ON and cannot be
// toggled; flipping a row calls saveNotificationPreference(event, enabled).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const saveMock = vi.fn();
vi.mock("@/app/settings/notifications/actions", () => ({
  saveNotificationPreference: (...args: unknown[]) => saveMock(...args),
}));

import { NotificationPreferencesForm } from "@/components/features/notifications/preferences-form";
import { NOTIFICATION_CATALOG_BY_EVENT } from "@/lib/notifications/notification-catalog";

const entries = [
  NOTIFICATION_CATALOG_BY_EVENT.pr_progress, // unlocked
  NOTIFICATION_CATALOG_BY_EVENT.site_issue_reported, // locked
];

beforeEach(() => saveMock.mockReset().mockResolvedValue({ ok: true }));

describe("NotificationPreferencesForm", () => {
  it("renders one toggle per entry with its Thai label", () => {
    render(<NotificationPreferencesForm entries={entries} mutedEvents={[]} />);
    expect(screen.getByText(NOTIFICATION_CATALOG_BY_EVENT.pr_progress.label)).toBeTruthy();
    expect(screen.getByText(NOTIFICATION_CATALOG_BY_EVENT.site_issue_reported.label)).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("reflects a muted event as off and an absent one as on", () => {
    render(<NotificationPreferencesForm entries={entries} mutedEvents={["pr_progress"]} />);
    const prSwitch = screen.getByRole("switch", {
      name: new RegExp(NOTIFICATION_CATALOG_BY_EVENT.pr_progress.label),
    });
    expect(prSwitch.getAttribute("aria-checked")).toBe("false");
  });

  it("flipping an unlocked toggle calls saveNotificationPreference(event, enabled)", async () => {
    render(<NotificationPreferencesForm entries={entries} mutedEvents={[]} />);
    const prSwitch = screen.getByRole("switch", {
      name: new RegExp(NOTIFICATION_CATALOG_BY_EVENT.pr_progress.label),
    });
    fireEvent.click(prSwitch);
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith("pr_progress", false));
  });

  it("a locked entry is on, disabled, and never calls the action", () => {
    render(<NotificationPreferencesForm entries={entries} mutedEvents={[]} />);
    const locked = screen.getByRole("switch", {
      name: new RegExp(NOTIFICATION_CATALOG_BY_EVENT.site_issue_reported.label),
    });
    expect(locked.getAttribute("aria-checked")).toBe("true");
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(locked);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
