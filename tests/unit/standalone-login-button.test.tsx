// Spec 43 + 44 + 45 — StandaloneLoginButton: the installed PWA's login
// control. Tap → handoff start → SAME-WINDOW navigation to LINE
// (spec 45: standalone PWAs have no tab model — window.open swaps the
// view to about:blank, the operator's white screen) → on return or
// relaunch, resume the poll from localStorage (spec 44: iOS kills
// backgrounded PWAs; sessionStorage does not survive) until the
// session lands.
// jsdom: fetch is stubbed; all navigation goes through the injectable
// `navigate` prop (window.location.assign is unmockable).

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

beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", openMock);
  localStorage.clear();
});

describe("StandaloneLoginButton", () => {
  it("renders the login button when idle", () => {
    render(<StandaloneLoginButton className="x" />);
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" })).toBeInTheDocument();
  });

  it("tap → starts the handoff, stores the code, then navigates THIS window to LINE", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ device_code: "dc1", authorize_url: "https://access.line.me/x" }),
    );
    const navigate = vi.fn();
    render(<StandaloneLoginButton className="x" navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://access.line.me/x"));
    expect(fetchMock).toHaveBeenCalledWith("/auth/handoff/start", { method: "POST" });
    // The code is stored BEFORE leaving — the return trip resumes from it.
    expect(localStorage.getItem(CODE_KEY)).toBe("dc1");
    expect(Number(localStorage.getItem(EXPIRES_KEY))).toBeGreaterThan(Date.now());
    // Standalone PWAs have no tabs: window.open must never run (spec 45).
    expect(openMock).not.toHaveBeenCalled();
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
