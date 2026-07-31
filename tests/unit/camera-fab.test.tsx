import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Spec 277 P0 — the floating ถ่ายรูป FAB on the SA home. No new capture: it routes
// into the existing WP-detail photo deep-link (#wp-photos), recording /sa as the
// referrer so the back chip returns home. One active WP → a direct link; several →
// a เลือกงาน picker, then navigate to the chosen WP's photo tab.
//
// Spec 384 U3 — the picker gains type-to-find over code + name. U2 widened its
// domain to ~178 rows (unions in every ต้องแก้ไข WP too), so an unsearchable flat
// list is a real scroll wall now, not decoration. Mirrors PersonPicker's search
// idiom (spec 363 U4 slice 1b) — same reset-on-close, focus-on-open, highlight.

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import { CameraFab, type CameraFabWp } from "@/components/features/sa/camera-fab";

const one: CameraFabWp[] = [{ id: "wp1", projectId: "p1", code: "WP-01", name: "งานเดินไฟ" }];
const many: CameraFabWp[] = [...one, { id: "wp2", projectId: "p2", code: "WP-02", name: "งานปูน" }];

// A third row whose CODE shares no substring with the other two's codes, and
// whose NAME shares no substring with the other two's names — so a match can
// be attributed to code alone or name alone, not either ambiguously.
const searchable: CameraFabWp[] = [
  ...many,
  { id: "wp3", projectId: "p3", code: "PLB-05", name: "งานประปา" },
];

const SEARCH_PLACEHOLDER = "ค้นหาชื่อหรือรหัสงาน";

function openMultiSheet(wps: CameraFabWp[] = searchable) {
  render(<CameraFab wps={wps} />);
  fireEvent.click(screen.getByRole("button", { name: /ถ่ายรูป/ }));
  return screen.getByRole("dialog");
}

beforeEach(() => mockPush.mockReset());

describe("CameraFab (spec 277 P0)", () => {
  it("with a single active WP, links straight to its photo tab (referrer /sa)", () => {
    render(<CameraFab wps={one} />);
    expect(screen.getByRole("link", { name: /ถ่ายรูป/ })).toHaveAttribute(
      "href",
      "/projects/p1/work-packages/wp1?from=%2Fsa#wp-photos",
    );
  });

  it("with several WPs, opens a picker and routes the chosen WP to its photo tab", () => {
    render(<CameraFab wps={many} />);
    expect(screen.queryByRole("link", { name: /ถ่ายรูป/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /ถ่ายรูป/ }));
    fireEvent.click(screen.getByRole("button", { name: /WP-02/ }));
    expect(mockPush).toHaveBeenCalledWith("/projects/p2/work-packages/wp2?from=%2Fsa#wp-photos");
  });

  it("renders nothing when there are no active WPs", () => {
    const { container } = render(<CameraFab wps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("names itself via aria-label only — drops the sub-13px visible caption", () => {
    render(<CameraFab wps={one} />);
    // Accessible name still resolves (aria-label on the control)…
    expect(screen.getByRole("link", { name: /ถ่ายรูป/ })).toBeInTheDocument();
    // …but the tiny 8px visible label is gone — the icon + aria-label carry it.
    expect(screen.queryByText("ถ่ายรูป")).toBeNull();
  });
});

describe("CameraFab picker search (spec 384 U3)", () => {
  it("opens with a search box and every WP listed", () => {
    const sheet = openMultiSheet();
    expect(within(sheet).getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
    for (const w of searchable) {
      expect(within(sheet).getByRole("button", { name: new RegExp(w.code) })).toBeInTheDocument();
    }
  });

  it("filters by CODE — a query with no name overlap still matches", () => {
    const sheet = openMultiSheet();
    fireEvent.change(within(sheet).getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "PLB" },
    });
    expect(within(sheet).getByRole("button", { name: /PLB-05/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /WP-01/ })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /WP-02/ })).toBeNull();
  });

  it("filters by NAME — a query with no code overlap still matches", () => {
    const sheet = openMultiSheet();
    fireEvent.change(within(sheet).getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "ปูน" },
    });
    expect(within(sheet).getByRole("button", { name: /งานปูน/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /WP-01/ })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /PLB-05/ })).toBeNull();
  });

  it("is case-insensitive on the code", () => {
    const sheet = openMultiSheet();
    fireEvent.change(within(sheet).getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "plb" },
    });
    expect(within(sheet).getByRole("button", { name: /PLB-05/ })).toBeInTheDocument();
  });

  it("says so when nothing matches instead of showing an empty sheet", () => {
    const sheet = openMultiSheet();
    fireEvent.change(within(sheet).getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "ไม่มีงานนี้" },
    });
    expect(within(sheet).getByText(/ไม่พบ/)).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /WP-01/ })).toBeNull();
  });

  it("highlights the matched substring in the NAME", () => {
    const sheet = openMultiSheet();
    fireEvent.change(within(sheet).getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "ปูน" },
    });
    const row = within(sheet).getByRole("button", { name: /งานปูน/ });
    const marked = row.querySelector(".text-action");
    expect(marked).not.toBeNull();
    expect(marked).toHaveTextContent("ปูน");
  });

  // A code-only match is exactly the case where highlighting carries real
  // information — the name shows no reason for the hit at all.
  it("highlights the matched substring in the CODE", () => {
    const sheet = openMultiSheet();
    fireEvent.change(within(sheet).getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "PLB" },
    });
    const row = within(sheet).getByRole("button", { name: /PLB-05/ });
    const marked = row.querySelector(".text-action");
    expect(marked).not.toBeNull();
    expect(marked).toHaveTextContent("PLB");
  });

  it("routes to the filtered-down WP's photo tab on pick", () => {
    render(<CameraFab wps={searchable} />);
    fireEvent.click(screen.getByRole("button", { name: /ถ่ายรูป/ }));
    const sheet = screen.getByRole("dialog");
    fireEvent.change(within(sheet).getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "PLB" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: /PLB-05/ }));
    expect(mockPush).toHaveBeenCalledWith("/projects/p3/work-packages/wp3?from=%2Fsa#wp-photos");
  });

  // Mirrors PersonPicker: a reopen on a stale filter would show a picker that
  // LOOKS empty for a WP that plainly exists, on the SA's most time-pressured
  // control.
  it("reopens on a clean query so a stale filter never hides the list", () => {
    render(<CameraFab wps={searchable} />);
    fireEvent.click(screen.getByRole("button", { name: /ถ่ายรูป/ }));
    const first = screen.getByRole("dialog");
    fireEvent.change(within(first).getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "PLB" },
    });
    fireEvent.click(within(first).getByRole("button", { name: /PLB-05/ }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /ถ่ายรูป/ }));
    const reopened = screen.getByRole("dialog");
    expect(within(reopened).getByPlaceholderText(SEARCH_PLACEHOLDER)).toHaveValue("");
    for (const w of searchable) {
      expect(
        within(reopened).getByRole("button", { name: new RegExp(w.code) }),
      ).toBeInTheDocument();
    }
  });

  // The LIKELIER stale-filter path in the field: type, find nothing (or find
  // it and just back out), dismiss via ปิด rather than picking a row, reopen.
  // Only pinning the pick-path (above) would leave this route to `setOpen(false)`
  // directly, skipping the query reset the pick-path happens to go through.
  it("reopens on a clean query after DISMISSING (ปิด), not just after picking", () => {
    render(<CameraFab wps={searchable} />);
    fireEvent.click(screen.getByRole("button", { name: /ถ่ายรูป/ }));
    const first = screen.getByRole("dialog");
    fireEvent.change(within(first).getByPlaceholderText(SEARCH_PLACEHOLDER), {
      target: { value: "PLB" },
    });
    fireEvent.click(within(first).getByRole("button", { name: "ปิด" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /ถ่ายรูป/ }));
    const reopened = screen.getByRole("dialog");
    expect(within(reopened).getByPlaceholderText(SEARCH_PLACEHOLDER)).toHaveValue("");
    for (const w of searchable) {
      expect(
        within(reopened).getByRole("button", { name: new RegExp(w.code) }),
      ).toBeInTheDocument();
    }
  });

  it("focuses the search box on open, mirroring PersonPicker", async () => {
    const sheet = openMultiSheet();
    const search = within(sheet).getByPlaceholderText(SEARCH_PLACEHOLDER);
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(search).toHaveFocus();
  });
});
