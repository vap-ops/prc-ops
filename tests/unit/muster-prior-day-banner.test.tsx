// Writing failing test first.
//
// Spec 306 close-day carryover — the cockpit banner that offers to close a prior
// day the SA never pressed ปิดวัน on.
//
// Design calls this pins (operator-approved 2026-07-25, WARN not FORCE):
// - it never blocks today's board — the morning muster is time-critical, so this
//   is a banner the SA can scroll past, not a gate;
// - it is NOT dismissible: it is derived from the closure rows, so the only way
//   to clear it is to actually close the day (a dismiss button would recreate the
//   exact failure it exists to catch);
// - the close CTA is confirm-then-act with an OT DISCLOSURE, because a bare
//   one-tap close would silently repeat the 07-24 data loss through a new door.
//   The wording differs from the today-bar's on purpose: on a past day there is
//   no UI anywhere that can still close those OT sessions, so this is a statement
//   of what is already lost, not a "go close them first" prompt.

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const closeMusterDay = vi.fn();
vi.mock("@/lib/muster/actions", () => ({
  closeMusterDay: (...a: unknown[]) => closeMusterDay(...a),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import {
  PriorDayCloseBanner,
  PRIOR_DAY_ROWS,
} from "@/components/features/muster/prior-day-close-banner";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const props = { projectId: PROJECT, revalidate: `/projects/${PROJECT}/muster` };

beforeEach(() => {
  closeMusterDay.mockReset();
  closeMusterDay.mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("PriorDayCloseBanner", () => {
  it("renders nothing when every prior day is closed", () => {
    const { container } = render(<PriorDayCloseBanner {...props} days={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("carries the attention treatment, with no competing surface utility", () => {
    // Caught live, not by any green test: composing the shared CARD constant
    // (which bundles `bg-card` + `border-edge`) with `bg-attn-soft` /
    // `border-attn` puts two utilities for the same property on one element, and
    // the GENERATED stylesheet order decides the winner — not the order they
    // appear in the className. CARD won, so the amber warning rendered as a plain
    // white card with a grey border: the entire "something is wrong here"
    // affordance, silently gone. Assert the attention tokens are present AND that
    // the neutral-surface ones are not there to fight them.
    const { container } = render(
      <PriorDayCloseBanner {...props} days={[{ date: "2026-07-25", teamCount: 1, openOt: 0 }]} />,
    );
    const banner = container.firstElementChild as HTMLElement;
    const cls = banner.className;
    expect(cls).toContain("bg-attn-soft");
    expect(cls).toContain("border-attn");
    expect(cls).toContain("text-attn-ink");
    expect(cls).not.toContain("bg-card");
    expect(cls).not.toContain("border-edge");
  });

  it("names each unclosed day and says why it matters (wages are not booked)", () => {
    render(
      <PriorDayCloseBanner
        {...props}
        days={[
          { date: "2026-07-25", teamCount: 3, openOt: 0 },
          { date: "2026-07-20", teamCount: 1, openOt: 0 },
        ]}
      />,
    );
    // The Thai date, not the ISO string — this is the SA's own working language.
    expect(screen.getByText(/25 ก\.ค\./)).toBeInTheDocument();
    expect(screen.getByText(/20 ก\.ค\./)).toBeInTheDocument();
    expect(screen.getByText(/บันทึกค่าแรง/)).toBeInTheDocument();
  });

  it("offers NO dismiss control — the only way to clear it is to close the day", () => {
    render(
      <PriorDayCloseBanner {...props} days={[{ date: "2026-07-25", teamCount: 1, openOt: 0 }]} />,
    );
    expect(screen.queryByRole("button", { name: /ปิดแจ้งเตือน|ซ่อน|ไม่แสดงอีก/ })).toBeNull();
  });

  it("a close tap confirms first, then calls close_muster_day for THAT day", async () => {
    const user = userEvent.setup();
    render(
      <PriorDayCloseBanner
        {...props}
        days={[
          { date: "2026-07-25", teamCount: 1, openOt: 0 },
          { date: "2026-07-20", teamCount: 1, openOt: 0 },
        ]}
      />,
    );
    const row = screen.getByTestId("unclosed-day-2026-07-25");
    await user.click(within(row).getByRole("button", { name: /^ปิดวัน/ }));
    // Confirming is a second, deliberate tap — the first one must not have acted.
    expect(closeMusterDay).not.toHaveBeenCalled();

    await user.click(within(row).getByRole("button", { name: /^ยืนยันปิดวัน/ }));
    expect(closeMusterDay).toHaveBeenCalledWith({
      projectId: PROJECT,
      date: "2026-07-25",
      revalidate: props.revalidate,
    });
  });

  it("confirming one day does not arm the others", async () => {
    const user = userEvent.setup();
    render(
      <PriorDayCloseBanner
        {...props}
        days={[
          { date: "2026-07-25", teamCount: 1, openOt: 0 },
          { date: "2026-07-20", teamCount: 1, openOt: 0 },
        ]}
      />,
    );
    await user.click(
      within(screen.getByTestId("unclosed-day-2026-07-25")).getByRole("button", {
        name: /^ปิดวัน/,
      }),
    );
    const other = screen.getByTestId("unclosed-day-2026-07-20");
    expect(within(other).queryByRole("button", { name: /^ยืนยันปิดวัน/ })).toBeNull();
    expect(within(other).getByRole("button", { name: /^ปิดวัน/ })).toBeInTheDocument();
  });

  it("a day with open OT discloses that the OT has no exit time and cannot be booked", async () => {
    const user = userEvent.setup();
    render(
      <PriorDayCloseBanner {...props} days={[{ date: "2026-07-24", teamCount: 2, openOt: 9 }]} />,
    );
    const row = screen.getByTestId("unclosed-day-2026-07-24");
    await user.click(within(row).getByRole("button", { name: /^ปิดวัน/ }));
    const warning = within(row).getByText(/OT/);
    expect(warning).toHaveTextContent("9");
    // The honest half: the span is already gone, closing is not what loses it.
    expect(warning).toHaveTextContent(/ไม่มีเวลาออก/);
  });

  it("a day with no open OT shows no OT warning", async () => {
    const user = userEvent.setup();
    render(
      <PriorDayCloseBanner {...props} days={[{ date: "2026-07-25", teamCount: 1, openOt: 0 }]} />,
    );
    const row = screen.getByTestId("unclosed-day-2026-07-25");
    await user.click(within(row).getByRole("button", { name: /^ปิดวัน/ }));
    expect(within(row).queryByText(/OT/)).toBeNull();
  });

  it("cancelling returns to the list without closing anything", async () => {
    const user = userEvent.setup();
    render(
      <PriorDayCloseBanner {...props} days={[{ date: "2026-07-25", teamCount: 1, openOt: 0 }]} />,
    );
    const row = screen.getByTestId("unclosed-day-2026-07-25");
    await user.click(within(row).getByRole("button", { name: /^ปิดวัน/ }));
    await user.click(within(row).getByRole("button", { name: /^ยกเลิก/ }));
    expect(closeMusterDay).not.toHaveBeenCalled();
    expect(within(row).getByRole("button", { name: /^ปิดวัน/ })).toBeInTheDocument();
  });

  it("surfaces a refused close ON THE DAY THAT FAILED, not banner-wide", async () => {
    const user = userEvent.setup();
    // The REAL string the action can produce: closeMusterDay routes every RPC
    // error through scanErrorToThai, whose `role not permitted` arm returns this.
    // (It says เช็คชื่อ — "take attendance" — which is the wrong domain for a
    // failed day-close; that is a pre-existing defect in the shared mapper,
    // recorded as its own follow-up. Pin what the user actually sees.)
    closeMusterDay.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์เช็คชื่อ" });
    render(
      <PriorDayCloseBanner
        {...props}
        days={[
          { date: "2026-07-25", teamCount: 1, openOt: 0 },
          { date: "2026-07-20", teamCount: 1, openOt: 0 },
        ]}
      />,
    );
    const row = screen.getByTestId("unclosed-day-2026-07-25");
    await user.click(within(row).getByRole("button", { name: /^ปิดวัน/ }));
    await user.click(within(row).getByRole("button", { name: /^ยืนยันปิดวัน/ }));
    expect(await within(row).findByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์เช็คชื่อ");
    // With several days listed, an unattributed error leaves the SA unable to
    // tell which one to retry.
    expect(within(screen.getByTestId("unclosed-day-2026-07-20")).queryByRole("alert")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the team count for each day", () => {
    render(
      <PriorDayCloseBanner {...props} days={[{ date: "2026-07-25", teamCount: 3, openOt: 0 }]} />,
    );
    expect(
      within(screen.getByTestId("unclosed-day-2026-07-25")).getByText(/3 ทีม/),
    ).toBeInTheDocument();
  });

  it("discloses that wages book at the worker's CURRENT rate", async () => {
    // derive_muster_labor snapshots workers.day_rate as of the close and there is
    // no effective-dated rate history, so closing an old day prices it at today's
    // rate. Non-actionable, but it is a money write the SA is authorising.
    const user = userEvent.setup();
    render(
      <PriorDayCloseBanner {...props} days={[{ date: "2026-06-01", teamCount: 1, openOt: 0 }]} />,
    );
    const row = screen.getByTestId("unclosed-day-2026-06-01");
    await user.click(within(row).getByRole("button", { name: /^ปิดวัน/ }));
    expect(within(row).getByText(/อัตราปัจจุบัน/)).toBeInTheDocument();
  });

  it("locks every row while a close is in flight (no concurrent double-close)", async () => {
    const user = userEvent.setup();
    let release: (v: { ok: boolean }) => void = () => {};
    closeMusterDay.mockReturnValue(
      new Promise<{ ok: boolean }>((r) => {
        release = r;
      }),
    );
    render(
      <PriorDayCloseBanner
        {...props}
        days={[
          { date: "2026-07-25", teamCount: 1, openOt: 0 },
          { date: "2026-07-20", teamCount: 1, openOt: 0 },
        ]}
      />,
    );
    const row = screen.getByTestId("unclosed-day-2026-07-25");
    await user.click(within(row).getByRole("button", { name: /^ปิดวัน/ }));
    await user.click(within(row).getByRole("button", { name: /^ยืนยันปิดวัน/ }));
    // The shared `pending` flag is the whole double-submit defence — a second day
    // must not be closable while the first is still in flight.
    await waitFor(() => {
      expect(
        within(screen.getByTestId("unclosed-day-2026-07-20")).getByRole("button", {
          name: /^ปิดวัน/,
        }),
      ).toBeDisabled();
    });
    release({ ok: true });
  });

  it("renders only the newest few days and summarises the rest", () => {
    // An unbounded list would push the muster board below the fold and turn a
    // warning into a soft gate. The reader stays unbounded; this is display only,
    // and closing one promotes the next into view.
    const days = [
      "2026-07-25",
      "2026-07-24",
      "2026-07-23",
      "2026-07-22",
      "2026-07-21",
      "2026-07-20",
      "2026-07-19",
    ].map((date) => ({ date, teamCount: 1, openOt: 0 }));
    render(<PriorDayCloseBanner {...props} days={days} />);
    expect(screen.getAllByTestId(/^unclosed-day-/)).toHaveLength(PRIOR_DAY_ROWS);
    // Newest kept, oldest deferred.
    expect(screen.getByTestId("unclosed-day-2026-07-25")).toBeInTheDocument();
    expect(screen.queryByTestId("unclosed-day-2026-07-19")).toBeNull();
    // And the remainder is DISCLOSED, never silently dropped.
    expect(screen.getByText(/และอีก 2 วัน/)).toBeInTheDocument();
  });

  it("says nothing about older days when they all fit", () => {
    render(
      <PriorDayCloseBanner {...props} days={[{ date: "2026-07-25", teamCount: 1, openOt: 0 }]} />,
    );
    expect(screen.queryByText(/และอีก/)).toBeNull();
  });

  it("refreshes the board after a successful close so the day drops off the list", async () => {
    const user = userEvent.setup();
    render(
      <PriorDayCloseBanner {...props} days={[{ date: "2026-07-25", teamCount: 1, openOt: 0 }]} />,
    );
    const row = screen.getByTestId("unclosed-day-2026-07-25");
    await user.click(within(row).getByRole("button", { name: /^ปิดวัน/ }));
    await user.click(within(row).getByRole("button", { name: /^ยืนยันปิดวัน/ }));
    expect(refresh).toHaveBeenCalled();
  });
});
