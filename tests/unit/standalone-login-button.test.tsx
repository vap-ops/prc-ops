// Spec 43 + 44 + 45 + Android fix — StandaloneLoginButton: the
// installed PWA's login control.
//
// Platform-split navigation to LINE (field incident 2026-07-02, Android
// SA stuck at /login?handoff=approved, handoff rows approved but never
// consumed — the poll loop died with the navigated-away document):
// - iOS: SAME-WINDOW navigation (spec 45 — window.open swaps the view
//   to about:blank, the operator's white screen). iOS kills the
//   backgrounded PWA and relaunches at start_url, so the poll resumes
//   from localStorage (spec 44).
// - everywhere else (Android WebAPK / Samsung Internet standalone):
//   window.open — the initiator document STAYS mounted in the waiting
//   phase and completes the poll itself when the user returns. Android
//   does not relaunch the parked task at start_url, so navigating this
//   window away kills the only context that can claim the handoff.
//   window.open blocked (null) → same-window fallback (old behavior).
// jsdom: fetch is stubbed; same-window navigation goes through the
// injectable `navigate` prop (window.location.assign is unmockable);
// window.open via the stubbed global.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StandaloneLoginButton } from "@/app/login/standalone-login-button";

const CODE_KEY = "line_handoff_device_code";
const EXPIRES_KEY = "line_handoff_expires_at";

const fetchMock = vi.fn();
const openMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function storeCode(code: string, expiresInMs: number): void {
  localStorage.setItem(CODE_KEY, code);
  localStorage.setItem(EXPIRES_KEY, String(Date.now() + expiresInMs));
}

const ORIGINAL_UA = window.navigator.userAgent;

function setUserAgent(ua: string): void {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true });
}

beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", openMock);
  localStorage.clear();
  setUserAgent(ORIGINAL_UA);
});

describe("StandaloneLoginButton", () => {
  it("renders the login button when idle", () => {
    render(<StandaloneLoginButton className="x" />);
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" })).toBeInTheDocument();
  });

  it("tap (non-iOS) → starts the handoff, stores the code, opens LINE in a NEW window, stays waiting", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ device_code: "dc1", authorize_url: "https://access.line.me/x" }),
    );
    openMock.mockReturnValue({} as Window);
    const navigate = vi.fn();
    render(<StandaloneLoginButton className="x" navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith("https://access.line.me/x", "_blank"),
    );
    expect(fetchMock).toHaveBeenCalledWith("/auth/handoff/start", { method: "POST" });
    // The code is stored BEFORE leaving — the return trip resumes from it.
    expect(localStorage.getItem(CODE_KEY)).toBe("dc1");
    expect(Number(localStorage.getItem(EXPIRES_KEY))).toBeGreaterThan(Date.now());
    // THIS window must not navigate away: it is the only context
    // guaranteed to hold the device_code, so it stays and polls.
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText(/เปิดแอป LINE/)).toBeInTheDocument();
  });

  it("tap (iOS) → SAME-WINDOW navigation, window.open never runs (spec 45)", async () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    );
    fetchMock.mockResolvedValue(
      jsonResponse({ device_code: "dc1", authorize_url: "https://access.line.me/x" }),
    );
    const navigate = vi.fn();
    render(<StandaloneLoginButton className="x" navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://access.line.me/x"));
    // iOS standalone PWAs have no tab model: window.open swaps the view
    // to a dead about:blank (spec 45's white screen).
    expect(openMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(CODE_KEY)).toBe("dc1");
  });

  it("tap (non-iOS, window.open blocked) → falls back to same-window navigation", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ device_code: "dc1", authorize_url: "https://access.line.me/x" }),
    );
    openMock.mockReturnValue(null);
    const navigate = vi.fn();
    render(<StandaloneLoginButton className="x" navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://access.line.me/x"));
  });

  it("non-iOS: the initiator window completes the login itself — poll after open → navigate to redirect", async () => {
    // THE regression pin for the 2026-07-02 Android incident: rows went
    // approved-but-never-consumed because no surviving context polled.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ device_code: "dc9", authorize_url: "https://access.line.me/x" }),
      )
      .mockResolvedValue(jsonResponse({ status: "ok", redirect: "/sa" }));
    openMock.mockReturnValue({} as Window);
    const navigate = vi.fn();
    render(<StandaloneLoginButton className="x" navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sa"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/handoff/poll",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ device_code: "dc9" }) }),
    );
    expect(localStorage.getItem(CODE_KEY)).toBeNull();
  });

  it("double-tap fires exactly ONE handoff start", async () => {
    // Field forensics: two login_handoffs rows 161 ms apart. The second
    // start overwrites the stored code while navigation may race the
    // first authorize URL — the resume can then poll a code whose row
    // never gets approved.
    fetchMock.mockResolvedValue(
      jsonResponse({ device_code: "dc1", authorize_url: "https://access.line.me/x" }),
    );
    openMock.mockReturnValue({} as Window);
    render(<StandaloneLoginButton className="x" navigate={vi.fn()} />);
    await userEvent.dblClick(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    await waitFor(() => expect(openMock).toHaveBeenCalled());
    const startCalls = fetchMock.mock.calls.filter(([url]) => url === "/auth/handoff/start");
    expect(startCalls).toHaveLength(1);
  });

  it("shows the error state when the start call fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const navigate = vi.fn();
    render(<StandaloneLoginButton className="x" navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    await waitFor(() => expect(screen.getByText(/ไม่สำเร็จ/)).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
    expect(localStorage.getItem(CODE_KEY)).toBeNull();
  });

  it("resumes polling from an unexpired stored code and navigates on ok", async () => {
    storeCode("dc2", 60_000);
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok", redirect: "/sa" }));
    const navigate = vi.fn();
    render(<StandaloneLoginButton className="x" navigate={navigate} />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sa"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/handoff/poll",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ device_code: "dc2" }) }),
    );
    expect(localStorage.getItem(CODE_KEY)).toBeNull();
  });

  it("ignores a stale stored code: idle button, no poll", () => {
    storeCode("dc-old", -1);
    render(<StandaloneLoginButton className="x" />);
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the error state when the handoff expires", async () => {
    storeCode("dc3", 60_000);
    fetchMock.mockResolvedValue(jsonResponse({ status: "expired" }));
    render(<StandaloneLoginButton className="x" />);

    await waitFor(() => expect(screen.getByText(/หมดเวลา/)).toBeInTheDocument());
    expect(localStorage.getItem(CODE_KEY)).toBeNull();
    // Retry affordance returns to the start of the flow.
    expect(screen.getByRole("button", { name: "ลองอีกครั้ง" })).toBeInTheDocument();
  });

  it("cancel returns to idle and clears the stored code", async () => {
    // Resumed waiting state (the post-return shape) — cancel must reset it.
    storeCode("dc4", 60_000);
    fetchMock.mockResolvedValue(jsonResponse({ status: "pending" }));
    render(<StandaloneLoginButton className="x" />);
    await userEvent.click(await screen.findByRole("button", { name: "ยกเลิก" }));

    expect(localStorage.getItem(CODE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" })).toBeInTheDocument();
  });
});
