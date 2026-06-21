// Spec 170 U4a — WorkerInviteBlock: the PM affordance on /workers to issue a DC
// a single-use portal-claim link (create_worker_invite via the action), or show
// the linked state when the worker is already bound to a portal user. Mirrors
// ContractorInviteBlock (spec 130 U5) but binds a worker, not a contractor.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { createWorkerInvite } = vi.hoisted(() => ({ createWorkerInvite: vi.fn() }));
vi.mock("@/app/workers/actions", () => ({ createWorkerInvite }));

import { WorkerInviteBlock } from "@/components/features/portal/worker-invite-block";

describe("WorkerInviteBlock", () => {
  beforeEach(() => {
    createWorkerInvite.mockReset();
  });

  it("shows the issue-link affordance when the worker is not yet bound", () => {
    render(<WorkerInviteBlock workerId="w1" alreadyBound={false} />);
    expect(screen.getByRole("button", { name: "สร้างลิงก์เชิญ" })).toBeInTheDocument();
    expect(screen.queryByText("เชื่อมบัญชีพอร์ทัลแล้ว")).not.toBeInTheDocument();
  });

  it("shows the linked state and no issue button when already bound", () => {
    render(<WorkerInviteBlock workerId="w1" alreadyBound={true} />);
    expect(screen.getByText("เชื่อมบัญชีพอร์ทัลแล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "สร้างลิงก์เชิญ" })).not.toBeInTheDocument();
  });
});
