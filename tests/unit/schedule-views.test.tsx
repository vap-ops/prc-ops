// Spec 256 U2 — real calendar views. The schedule page's view switch
// (เดือน | สัปดาห์ | วัน | ไทม์ไลน์): true Thai month grid with activity dots +
// due markers and tap-day drill, week/day agendas, and the Gantt intact under
// ไทม์ไลน์.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ScheduleViews } from "@/components/features/work-packages/schedule-views";
import type { GanttWp } from "@/components/features/work-packages/schedule-gantt";
import { getSchedulePhotos } from "@/app/projects/[projectId]/schedule/actions";

// Spec 257 — thumbnails are fetched client-side (signed URLs expire in
// 120s); the action is mocked here, covered by its own unit tests.
vi.mock("@/app/projects/[projectId]/schedule/actions", () => ({
  getSchedulePhotos: vi.fn(),
}));
// ZoomablePhoto's trigger doesn't import this, but opening the overlay does
// (established pattern — see photo-lightbox.test.tsx).
vi.mock("@/app/photo-markups/actions", () => ({
  listPhotoMarkups: vi.fn().mockResolvedValue({ ok: true, markups: [] }),
  addPhotoMarkup: vi.fn(),
  removePhotoMarkup: vi.fn(),
}));

const mockGetSchedulePhotos = vi.mocked(getSchedulePhotos);

const ACTIVE_WP: GanttWp = {
  id: "w1",
  code: "WP-1",
  name: "งานเสาเข็ม",
  status: "in_progress",
  deliverableId: "d1",
  plannedStart: "2026-07-01",
  plannedEnd: "2026-07-10",
  priority: "normal",
  isCritical: false,
  activityStart: "2026-07-02",
  activityEnd: "2026-07-02",
};

const QUIET_WP: GanttWp = {
  ...ACTIVE_WP,
  id: "w2",
  code: "WP-2",
  name: "งานทาสี",
  plannedStart: null,
  plannedEnd: null,
  activityStart: null,
  activityEnd: null,
};

beforeEach(() => {
  mockGetSchedulePhotos.mockReset();
  mockGetSchedulePhotos.mockResolvedValue({ ok: true, days: {} });
});
afterEach(() => {
  vi.useRealTimers();
});

function renderViews(overrides?: Partial<Parameters<typeof ScheduleViews>[0]>) {
  return render(
    <ScheduleViews
      projectId="p1"
      todayISO="2026-07-05"
      workPackages={[ACTIVE_WP, QUIET_WP]}
      deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
      dependencies={[]}
      activityDays={{ "2026-07-02": { w1: 3 } }}
      {...overrides}
    />,
  );
}

describe("ScheduleViews", () => {
  it("shows the 4-view switch and defaults to the month grid", () => {
    renderViews();
    for (const label of ["เดือน", "สัปดาห์", "วัน", "ไทม์ไลน์"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "เดือน" })).toHaveAttribute("aria-checked", "true");
    // BE month header + Sunday-first weekday row
    expect(screen.getByText("ก.ค. 2569")).toBeInTheDocument();
    expect(screen.getByText("อา")).toBeInTheDocument();
  });

  it("month cell shows the activity count and due marker", () => {
    renderViews();
    // 2026-07-02: 1 WP active
    expect(screen.getByRole("button", { name: /^2 ก\.ค\..*งานจริง 1/ })).toBeInTheDocument();
    // 2026-07-10: planned_end of WP-1
    expect(screen.getByRole("button", { name: /^10 ก\.ค\..*ครบกำหนด 1/ })).toBeInTheDocument();
  });

  it("tapping a month day drills into the วัน view for that date", () => {
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: /^2 ก\.ค\./ }));
    expect(screen.getByRole("radio", { name: "วัน" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("มีงานจริง")).toBeInTheDocument();
    expect(screen.getByText("งานเสาเข็ม")).toBeInTheDocument();
    expect(screen.getByText(/3 รูป/)).toBeInTheDocument();
  });

  it("month nav moves the header a month at a time", () => {
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: "เดือนถัดไป" }));
    expect(screen.getByText("ส.ค. 2569")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "เดือนก่อนหน้า" }));
    fireEvent.click(screen.getByRole("button", { name: "เดือนก่อนหน้า" }));
    expect(screen.getByText("มิ.ย. 2569")).toBeInTheDocument();
  });

  it("week view lists 7 days with activity and due chips", () => {
    renderViews();
    fireEvent.click(screen.getByRole("radio", { name: "สัปดาห์" }));
    // week containing 2026-07-05 (Sun) → 5..11 ก.ค.; activity on the 2nd is
    // NOT in this week, but the due chip on the 10th is.
    expect(screen.getAllByText(/ก\.ค\./).length).toBeGreaterThan(0);
    expect(screen.getByText(/ครบกำหนด/)).toBeInTheDocument();
    expect(screen.getByText("งานเสาเข็ม")).toBeInTheDocument();
  });

  it("day view sections: due + planned-start on their dates, empty state otherwise", () => {
    renderViews();
    fireEvent.click(screen.getByRole("radio", { name: "วัน" }));
    // today 2026-07-05: nothing happens that day
    expect(screen.getByText(/ไม่มีข้อมูลวันนี้|ไม่มีข้อมูลในวันนี้/)).toBeInTheDocument();
    // navigate back to 2026-07-01 → เริ่มตามแผน
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: "วันก่อนหน้า" }));
    }
    expect(screen.getByText("เริ่มตามแผน")).toBeInTheDocument();
    expect(screen.getByText("งานเสาเข็ม")).toBeInTheDocument();
  });

  it("day-view WP link carries the schedule back-referrer", () => {
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: /^2 ก\.ค\./ }));
    const link = screen.getByRole("link", { name: /งานเสาเข็ม/ });
    expect(link).toHaveAttribute(
      "href",
      "/projects/p1/work-packages/w1?from=%2Fprojects%2Fp1%2Fschedule",
    );
  });

  it("ไทม์ไลน์ renders the Gantt with its honest zoom labels", () => {
    renderViews();
    fireEvent.click(screen.getByRole("radio", { name: "ไทม์ไลน์" }));
    expect(screen.getByText("ใกล้")).toBeInTheDocument();
    expect(screen.getByTestId("gantt-scroll")).toBeInTheDocument();
  });

  it("วันนี้ button returns the month view to the current month", () => {
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: "เดือนถัดไป" }));
    expect(screen.getByText("ส.ค. 2569")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "วันนี้" }));
    expect(screen.getByText("ก.ค. 2569")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Spec 257 — real thumbnails (not just counts) in วัน/สัปดาห์.

const THUMB = {
  photoId: "ph1",
  workPackageId: "w1",
  thumbUrl: "https://thumb/ph1.jpg",
  fullUrl: "https://full/ph1.jpg",
};

describe("ScheduleViews photo thumbnails (spec 257)", () => {
  it("fetches photos for the selected date on entering the day view", async () => {
    mockGetSchedulePhotos.mockResolvedValue({ ok: true, days: { "2026-07-02": [THUMB] } });
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: /^2 ก\.ค\./ }));
    await waitFor(() => {
      expect(mockGetSchedulePhotos).toHaveBeenCalledWith("p1", ["2026-07-02"]);
    });
    // ZoomablePhoto's thumbnail img is alt="" (decorative) — not exposed via
    // role "img"; query through its labelled trigger button instead.
    const trigger = await screen.findByRole("button", { name: "ดูรูปขยาย" });
    expect(trigger.querySelector("img")).toHaveAttribute("src", THUMB.thumbUrl);
  });

  it("fetches all 7 days of the week on entering the week view", async () => {
    renderViews();
    fireEvent.click(screen.getByRole("radio", { name: "สัปดาห์" }));
    // todayISO 2026-07-05 is itself a Sunday — its week runs 07-05..07-11.
    await waitFor(() => {
      expect(mockGetSchedulePhotos).toHaveBeenCalledWith(
        "p1",
        expect.arrayContaining(["2026-07-05", "2026-07-11"]),
      );
    });
  });

  it("does not fetch photos for เดือน or ไทม์ไลน์", () => {
    renderViews();
    expect(mockGetSchedulePhotos).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "ไทม์ไลน์" }));
    expect(mockGetSchedulePhotos).not.toHaveBeenCalled();
  });

  it("shows a loading skeleton while the fetch is pending, then the thumbnail", async () => {
    let resolveFetch: (v: Awaited<ReturnType<typeof getSchedulePhotos>>) => void = () => {};
    mockGetSchedulePhotos.mockReturnValue(
      new Promise((r) => {
        resolveFetch = r;
      }),
    );
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: /^2 ก\.ค\./ }));
    expect(screen.getByTestId("photo-skeleton")).toBeInTheDocument();
    await act(async () => {
      resolveFetch({ ok: true, days: { "2026-07-02": [THUMB] } });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("photo-skeleton")).not.toBeInTheDocument();
    });
    const trigger = screen.getByRole("button", { name: "ดูรูปขยาย" });
    expect(trigger.querySelector("img")).toHaveAttribute("src", THUMB.thumbUrl);
  });

  it("degrades silently on a fetch error — the count-only view keeps working", async () => {
    mockGetSchedulePhotos.mockResolvedValue({ ok: false, error: "boom" });
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: /^2 ก\.ค\./ }));
    await waitFor(() => expect(mockGetSchedulePhotos).toHaveBeenCalled());
    // no crash, no error text — WpLink (count-based) still renders
    expect(screen.getByText("งานเสาเข็ม")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("caps thumbnails per day and notes the remainder", async () => {
    const many = Array.from({ length: 61 }, (_, i) => ({
      photoId: `ph${i}`,
      workPackageId: "w1",
      thumbUrl: `https://thumb/${i}.jpg`,
      fullUrl: `https://full/${i}.jpg`,
    }));
    mockGetSchedulePhotos.mockResolvedValue({ ok: true, days: { "2026-07-02": many } });
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: /^2 ก\.ค\./ }));
    expect(await screen.findByText(/\+1/)).toBeInTheDocument();
  });

  it("tapping a thumbnail opens the lightbox", async () => {
    mockGetSchedulePhotos.mockResolvedValue({ ok: true, days: { "2026-07-02": [THUMB] } });
    renderViews();
    fireEvent.click(screen.getByRole("button", { name: /^2 ก\.ค\./ }));
    const trigger = await screen.findByRole("button", { name: "ดูรูปขยาย" });
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("refreshes photos periodically so signed URLs never fully expire while viewing", async () => {
    vi.useFakeTimers();
    mockGetSchedulePhotos.mockResolvedValue({ ok: true, days: {} });
    render(
      <ScheduleViews
        projectId="p1"
        todayISO="2026-07-05"
        workPackages={[ACTIVE_WP]}
        deliverables={[{ id: "d1", code: "D1", name: "งวดที่ 1", sortOrder: 0 }]}
        dependencies={[]}
        activityDays={{}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "วัน" }));
    });
    const callsAfterMount = mockGetSchedulePhotos.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);
    await act(async () => {
      vi.advanceTimersByTime(100_000);
    });
    expect(mockGetSchedulePhotos.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });
});
