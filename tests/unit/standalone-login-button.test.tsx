// Spec 43 — StandaloneLoginButton: the installed PWA's login control.
// Tap → handoff start → open LINE → poll until the session lands.
// jsdom: fetch and window.open are stubbed; navigation goes through the
// injectable `navigate` prop (window.location.assign is unmockable).

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StandaloneLoginButton } from "@/app/login/standalone-login-button";

const fetchMock = vi.fn();
const openMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("open", openMock);
  sessionStorage.clear();
});

describe("StandaloneLoginButton", () => {
  it("renders the login button when idle", () => {
    render(<StandaloneLoginButton className="x" />);
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" })).toBeInTheDocument();
  });

  it("tap → starts a handoff, opens LINE, and shows the waiting state", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ device_code: "dc1", authorize_url: "https://access.line.me/x" }),
    );
    render(<StandaloneLoginButton className="x" />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));

    await waitFor(() => {
      expect(openMock).toHaveBeenCalledWith("https://access.line.me/x", "_blank", "noopener");
    });
    expect(fetchMock).toHaveBeenCalledWith("/auth/handoff/start", { method: "POST" });
    expect(sessionStorage.getItem("line_handoff_device_code")).toBe("dc1");
    expect(screen.getByText(/เปิดแอป LINE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยกเลิก" })).toBeInTheDocument();
  });

  it("resumes polling from sessionStorage and navigates on ok", async () => {
    sessionStorage.setItem("line_handoff_device_code", "dc2");
    fetchMock.mockResolvedValue(jsonResponse({ status: "ok", redirect: "/sa" }));
    const navigate = vi.fn();
    render(<StandaloneLoginButton className="x" navigate={navigate} />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/sa"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/handoff/poll",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ device_code: "dc2" }) }),
    );
    expect(sessionStorage.getItem("line_handoff_device_code")).toBeNull();
  });

  it("shows the error state when the handoff expires", async () => {
    sessionStorage.setItem("line_handoff_device_code", "dc3");
    fetchMock.mockResolvedValue(jsonResponse({ status: "expired" }));
    render(<StandaloneLoginButton className="x" />);

    await waitFor(() => expect(screen.getByText(/หมดเวลา/)).toBeInTheDocument());
    expect(sessionStorage.getItem("line_handoff_device_code")).toBeNull();
    // Retry affordance returns to the start of the flow.
    expect(screen.getByRole("button", { name: "ลองอีกครั้ง" })).toBeInTheDocument();
  });

  it("cancel returns to idle and clears the stored code", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ device_code: "dc4", authorize_url: "https://access.line.me/x" }),
    );
    render(<StandaloneLoginButton className="x" />);
    await userEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" }));
    await userEvent.click(await screen.findByRole("button", { name: "ยกเลิก" }));

    expect(sessionStorage.getItem("line_handoff_device_code")).toBeNull();
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบด้วย LINE" })).toBeInTheDocument();
  });
});
