// Spec 292 U4 — the PM's "set an SA's primary site" control on project settings
// (the members surface the PM already uses). Smallest control: one button per
// site_admin member; the current primary is marked, not re-offered. The DB RPC
// set_primary_project_for is the load-bearing gate — this UI only relays.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetFor, mockToast } = vi.hoisted(() => ({
  mockSetFor: vi.fn(async () => ({ ok: true })),
  mockToast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({ useToast: () => mockToast }));
vi.mock("@/app/projects/[projectId]/settings/actions", () => ({
  setPrimaryProjectFor: mockSetFor,
}));

import {
  ProjectPrimarySiteAdmins,
  type PrimarySiteAdmin,
} from "@/app/projects/[projectId]/settings/primary-site-admins";

const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

const ADMINS: PrimarySiteAdmin[] = [
  { id: U1, name: "ช่างเอก", isPrimary: true },
  { id: U2, name: "ช่างโท", isPrimary: false },
];

beforeEach(() => vi.clearAllMocks());

describe("ProjectPrimarySiteAdmins", () => {
  it("renders nothing when the project has no site_admin members", () => {
    const { container } = render(<ProjectPrimarySiteAdmins projectId={PROJECT} siteAdmins={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists each site_admin; marks the current primary and does not re-offer the pin", () => {
    render(<ProjectPrimarySiteAdmins projectId={PROJECT} siteAdmins={ADMINS} />);
    expect(screen.getByText("ช่างเอก")).toBeInTheDocument();
    expect(screen.getByText("ช่างโท")).toBeInTheDocument();
    // The primary (ช่างเอก) is marked, not offered a redundant pin.
    expect(screen.getByText("ไซต์หลัก")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตั้งเป็นไซต์หลัก.*ช่างเอก/ })).toBeNull();
    // ช่างโท (not primary) gets an enabled pin button.
    expect(screen.getByRole("button", { name: /ตั้งเป็นไซต์หลัก.*ช่างโท/ })).toBeEnabled();
  });

  it("relays set_primary_project_for with (userId, projectId) when a pin is tapped", () => {
    render(<ProjectPrimarySiteAdmins projectId={PROJECT} siteAdmins={ADMINS} />);
    fireEvent.click(screen.getByRole("button", { name: /ตั้งเป็นไซต์หลัก.*ช่างโท/ }));
    expect(mockSetFor).toHaveBeenCalledWith(U2, PROJECT);
  });
});
