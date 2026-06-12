// Spec 43 + 44 — StandaloneLoginButton: the installed PWA's login
// control. Tap → handoff start → open LINE → poll until the session
// lands. Spec 44 hardening pins: the device_code lives in localStorage
// with an expiry stamp (iOS kills backgrounded PWAs — sessionStorage
// does not survive), and the popup is opened synchronously in the tap
// gesture (async window.open loses iOS user activation).
// jsdom: fetch and window.open are stubbed; navigation goes through the
// injectable `navigate` prop (window.location.assign is unmockable).

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StandaloneLoginButton } from "@/app/login/standalone-login-button";

const CODE_KEY = "line_handoff_device_code";
const EXPIRES_KEY = "line_handoff_expires_at";

const fetchMock = vi.fn();
const openMock = vi.fn();

type FakePopup = { location: { href: string }; opener: unknown; close: ReturnType<typeof vi.fn> };

function makePopup(): FakePopup {
  return { location: { href: "" }, opener: {}, close: vi.fn() };
}

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

  it("tap → opens the popup synchronously, then starts and navigates it to LINE", async () => {
    const popup = makePopup();
    openMock.mockReturnValue(popup);
    fetchMock.mockResolvedValue(
      jsonResponse({ device_code: "dc1", authorize_url: "https://access.line.me/x" }),
    );
    render(<StandaloneLoginButton className="x" />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    // Synchronous open in the gesture: blank target, opener severed.
    expect(openMock).toHaveBeenCalledWith("", "_blank");
    expect(popup.opener).toBeNull();
    await waitFor(() => expect(popup.location.href).toBe("https://access.line.me/x"));

    expect(fetchMock).toHaveBeenCalledWith("/auth/handoff/start", { method: "POST" });
    // localStorage + expiry stamp (survives iOS process death).
    expect(localStorage.getItem(CODE_KEY)).toBe("dc1");
    expect(Number(localStorage.getItem(EXPIRES_KEY))).toBeGreaterThan(Date.now());
    expect(screen.getByText(/เปิดแอป LINE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยกเลิก" })).toBeInTheDocument();
  });

  it("falls back to same-window navigation when the popup is blocked", async () => {
    openMock.mockReturnValue(null);
    fetchMock.mockResolvedValue(
      jsonResponse({ device_code: "dc1b", authorize_url: "https://access.line.me/y" }),
    );
    const navigate = vi.fn();
    render(<StandaloneLoginButton className="x" navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://access.line.me/y"));
    // The code is stored BEFORE leaving — the relaunch resumes from it.
    expect(localStorage.getItem(CODE_KEY)).toBe("dc1b");
  });

  it("closes the orphan popup when the start call fails", async () => {
    const popup = makePopup();
    openMock.mockReturnValue(popup);
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<StandaloneLoginButton className="x" />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    await waitFor(() => expect(screen.getByText(/ไม่สำเร็จ/)).toBeInTheDocument());
    expect(popup.close).toHaveBeenCalled();
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
    const popup = makePopup();
    openMock.mockReturnValue(popup);
    fetchMock.mockResolvedValue(
      jsonResponse({ device_code: "dc4", authorize_url: "https://access.line.me/x" }),
    );
    render(<StandaloneLoginButton className="x" />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));
    await userEvent.click(await screen.findByRole("button", { name: "ยกเลิก" }));

    expect(localStorage.getItem(CODE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" })).toBeInTheDocument();
  });
});
