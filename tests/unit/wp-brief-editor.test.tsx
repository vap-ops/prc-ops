// Writing failing test first.
//
// Spec 377 U2b — WpBriefEditor: the tablet-first authoring surface over the
// U2a RPCs (via the wp-brief actions). Save lifecycle mirrors notes-field.tsx
// (toast.success + router.refresh, no inline "saved" span). Criteria/
// evidence-slot CRUD renders existing rows + one add-row form each; delete
// goes through the shared ConfirmActionButton (trigger → dialog → ยืนยัน).
// Publish is disabled when no draft exists OR the draft form has unsaved
// edits (wp_brief_versions is append-only — publishing over a dirty form
// would freeze stale content forever).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  saveWpBriefDraft,
  addWpBriefCriterion,
  deleteWpBriefCriterion,
  addWpBriefEvidenceSlot,
  deleteWpBriefEvidenceSlot,
  publishWpBrief,
  mockRefresh,
  mockToast,
} = vi.hoisted(() => ({
  saveWpBriefDraft: vi.fn(),
  addWpBriefCriterion: vi.fn(),
  deleteWpBriefCriterion: vi.fn(),
  addWpBriefEvidenceSlot: vi.fn(),
  deleteWpBriefEvidenceSlot: vi.fn(),
  publishWpBrief: vi.fn(),
  mockRefresh: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  },
}));

vi.mock("@/lib/wp-brief/actions", () => ({
  saveWpBriefDraft,
  addWpBriefCriterion,
  updateWpBriefCriterion: vi.fn(),
  deleteWpBriefCriterion,
  addWpBriefEvidenceSlot,
  updateWpBriefEvidenceSlot: vi.fn(),
  deleteWpBriefEvidenceSlot,
  publishWpBrief,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/ui/use-toast", () => ({ useToast: () => mockToast }));

import { WpBriefEditor } from "@/components/features/work-packages/wp-brief-editor";
import type { Json } from "@/lib/db/database.types";

const PROJECT_ID = "proj-1";
const WP_ID = "wp-1";

const baseProps = {
  projectId: PROJECT_ID,
  workPackageId: WP_ID,
  draft: null as null | {
    id: string;
    scopeIncluded: string | null;
    scopeExcluded: string | null;
    quantity: string | null;
    location: string | null;
    sheetCode: string | null;
    sheetRev: string | null;
    displayConfig: Json;
  },
  criteria: [] as Array<{ id: string; body: string; sortOrder: number }>,
  evidenceSlots: [] as Array<{
    id: string;
    label: string;
    criterionId: string | null;
    sortOrder: number;
  }>,
  latestVersion: null as null | {
    version: number;
    publishedByName: string;
    publishedAt: string;
  },
};

const draftWithId = (overrides: Partial<NonNullable<typeof baseProps.draft>> = {}) => ({
  id: "brief-1",
  scopeIncluded: null,
  scopeExcluded: null,
  quantity: null,
  location: null,
  sheetCode: null,
  sheetRev: null,
  displayConfig: null,
  ...overrides,
});

function setup(overrides: Partial<typeof baseProps> = {}) {
  return render(<WpBriefEditor {...baseProps} {...overrides} />);
}

beforeEach(() => {
  mockRefresh.mockReset();
  mockToast.success.mockReset();
  saveWpBriefDraft.mockReset();
  addWpBriefCriterion.mockReset();
  deleteWpBriefCriterion.mockReset();
  addWpBriefEvidenceSlot.mockReset();
  deleteWpBriefEvidenceSlot.mockReset();
  publishWpBrief.mockReset();
});

describe("WpBriefEditor — draft fields", () => {
  it("renders empty fields and a blank-draft empty state when no draft exists yet", () => {
    setup();
    expect(screen.getByText(/ยังไม่มีร่างข้อมูลงาน/)).toBeInTheDocument();
  });

  it("renders existing draft values", () => {
    setup({
      draft: draftWithId({
        scopeIncluded: "ผูกเหล็กฐานราก F1",
        quantity: "12 จุด",
        location: "โซนหน้าอาคาร",
      }),
    });
    expect(screen.getByDisplayValue("ผูกเหล็กฐานราก F1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12 จุด")).toBeInTheDocument();
  });

  it("saves the draft, round-trips display_config unchanged, and toasts (no inline saved span)", async () => {
    saveWpBriefDraft.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    setup({ draft: draftWithId({ displayConfig: { sections: ["scope"] } }) });

    await user.type(screen.getByLabelText(/ขอบเขตงาน \(รวม\)/), "ผูกเหล็ก F2");
    await user.click(screen.getByRole("button", { name: /^บันทึก$/ }));

    await waitFor(() => expect(saveWpBriefDraft).toHaveBeenCalled());
    expect(saveWpBriefDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        workPackageId: WP_ID,
        scopeIncluded: "ผูกเหล็ก F2",
        displayConfig: { sections: ["scope"] },
      }),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("บันทึกแล้ว"));
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByText("บันทึกแล้ว")).not.toBeInTheDocument();
  });

  it("shows the action's error message when save fails", async () => {
    saveWpBriefDraft.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์ (เฉพาะผู้จัดการโครงการ)" });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /^บันทึก$/ }));
    expect(await screen.findByText("ไม่มีสิทธิ์ (เฉพาะผู้จัดการโครงการ)")).toBeInTheDocument();
  });

  it("disables the fields while a save is in flight", async () => {
    let resolveSave: (v: { ok: true }) => void = () => {};
    saveWpBriefDraft.mockImplementation(() => new Promise((resolve) => (resolveSave = resolve)));
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /^บันทึก$/ }));
    expect(screen.getByLabelText(/ขอบเขตงาน \(รวม\)/)).toBeDisabled();
    resolveSave({ ok: true });
    await waitFor(() => expect(screen.getByLabelText(/ขอบเขตงาน \(รวม\)/)).not.toBeDisabled());
  });
});

describe("WpBriefEditor — criteria", () => {
  it("renders existing criteria and adds a new one (refreshes + clears the input)", async () => {
    addWpBriefCriterion.mockResolvedValue({ ok: true, id: "crit-new" });
    const user = userEvent.setup();
    setup({
      draft: draftWithId(),
      criteria: [{ id: "crit-1", body: "เหล็กครบทุกจุดตามแบบ", sortOrder: 1 }],
    });

    expect(screen.getByText("เหล็กครบทุกจุดตามแบบ", { selector: "span" })).toBeInTheDocument();

    const input = screen.getByLabelText(/เพิ่มเกณฑ์/);
    await user.type(input, "ระยะห่างถูกต้อง");
    await user.click(screen.getByRole("button", { name: /^เพิ่ม$/ }));

    await waitFor(() =>
      expect(addWpBriefCriterion).toHaveBeenCalledWith(
        expect.objectContaining({ briefId: "brief-1", body: "ระยะห่างถูกต้อง" }),
      ),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(input).toHaveValue("");
  });

  it("does not add, refresh, or clear when the action fails", async () => {
    addWpBriefCriterion.mockResolvedValue({ ok: false, error: "ข้อมูลไม่ถูกต้อง" });
    const user = userEvent.setup();
    setup({ draft: draftWithId() });

    const input = screen.getByLabelText(/เพิ่มเกณฑ์/);
    await user.type(input, "ระยะห่างถูกต้อง");
    await user.click(screen.getByRole("button", { name: /^เพิ่ม$/ }));

    expect(await screen.findByText("ข้อมูลไม่ถูกต้อง")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(input).toHaveValue("ระยะห่างถูกต้อง");
  });

  it("deletes a criterion through the confirm dialog (trigger alone does nothing)", async () => {
    deleteWpBriefCriterion.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    setup({
      draft: draftWithId(),
      criteria: [{ id: "crit-1", body: "เหล็กครบทุกจุดตามแบบ", sortOrder: 1 }],
    });

    await user.click(screen.getByRole("button", { name: "ลบ" }));
    expect(deleteWpBriefCriterion).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() =>
      expect(deleteWpBriefCriterion).toHaveBeenCalledWith(
        expect.objectContaining({ criterionId: "crit-1" }),
      ),
    );
  });

  it("names how many evidence slots lose their mapping in the confirm message", async () => {
    const user = userEvent.setup();
    setup({
      draft: draftWithId(),
      criteria: [{ id: "crit-1", body: "เหล็กครบทุกจุดตามแบบ", sortOrder: 1 }],
      evidenceSlots: [
        { id: "slot-1", label: "มุมกว้าง", criterionId: "crit-1", sortOrder: 1 },
        { id: "slot-2", label: "ระยะใกล้", criterionId: "crit-1", sortOrder: 2 },
      ],
    });

    const criteriaList = screen.getByText("เกณฑ์การยอมรับ").closest("section")!;
    await user.click(within(criteriaList).getByRole("button", { name: "ลบ" }));
    expect(screen.getByText(/จุดถ่ายรูป 2 จุด/)).toBeInTheDocument();
  });

  it("cannot add a criterion before a draft exists (no brief id to attach to)", () => {
    setup();
    expect(screen.queryByLabelText(/เพิ่มเกณฑ์/)).not.toBeInTheDocument();
  });
});

describe("WpBriefEditor — evidence slots", () => {
  it("adds a slot optionally mapped to a criterion (refreshes + clears inputs)", async () => {
    addWpBriefEvidenceSlot.mockResolvedValue({ ok: true, id: "slot-new" });
    const user = userEvent.setup();
    setup({
      draft: draftWithId(),
      criteria: [{ id: "crit-1", body: "เหล็กครบทุกจุดตามแบบ", sortOrder: 1 }],
    });

    const labelInput = screen.getByLabelText(/เพิ่มจุดถ่ายรูป/);
    await user.type(labelInput, "มุมกว้างเห็นทั้งฐาน");
    await user.selectOptions(screen.getByLabelText(/เกณฑ์ที่พิสูจน์/), "crit-1");
    await user.click(screen.getByRole("button", { name: /^เพิ่มจุด$/ }));

    await waitFor(() =>
      expect(addWpBriefEvidenceSlot).toHaveBeenCalledWith(
        expect.objectContaining({
          briefId: "brief-1",
          label: "มุมกว้างเห็นทั้งฐาน",
          criterionId: "crit-1",
        }),
      ),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(labelInput).toHaveValue("");
  });

  it("deletes a slot through the confirm dialog", async () => {
    deleteWpBriefEvidenceSlot.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    setup({
      draft: draftWithId(),
      evidenceSlots: [{ id: "slot-1", label: "มุมกว้าง", criterionId: null, sortOrder: 1 }],
    });

    await user.click(screen.getByRole("button", { name: "ลบ" }));
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() =>
      expect(deleteWpBriefEvidenceSlot).toHaveBeenCalledWith(
        expect.objectContaining({ slotId: "slot-1" }),
      ),
    );
  });
});

describe("WpBriefEditor — publish", () => {
  it("disables publish when there is no draft yet", () => {
    setup();
    expect(screen.getByRole("button", { name: /เผยแพร่/ })).toBeDisabled();
  });

  it("disables publish while the draft form has unsaved edits", async () => {
    const user = userEvent.setup();
    setup({ draft: draftWithId({ scopeIncluded: "x" }) });

    expect(screen.getByRole("button", { name: /เผยแพร่/ })).not.toBeDisabled();
    await user.type(screen.getByLabelText(/ขอบเขตงาน \(รวม\)/), " แก้ไข");
    expect(screen.getByRole("button", { name: /เผยแพร่/ })).toBeDisabled();
    expect(screen.getByText(/บันทึกร่างข้อมูลงานก่อน/)).toBeInTheDocument();
  });

  it("re-enables publish after the dirty draft is saved", async () => {
    saveWpBriefDraft.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    setup({ draft: draftWithId({ scopeIncluded: "x" }) });

    await user.type(screen.getByLabelText(/ขอบเขตงาน \(รวม\)/), " แก้ไข");
    expect(screen.getByRole("button", { name: /เผยแพร่/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^บันทึก$/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /เผยแพร่/ })).not.toBeDisabled());
  });

  it("publishes and toasts (no inline published span)", async () => {
    publishWpBrief.mockResolvedValue({ ok: true, versionId: "v-1" });
    const user = userEvent.setup();
    setup({ draft: draftWithId({ scopeIncluded: "x" }) });

    await user.click(screen.getByRole("button", { name: /เผยแพร่/ }));
    await waitFor(() =>
      expect(publishWpBrief).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, workPackageId: WP_ID }),
      ),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("เผยแพร่แล้ว"));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("renders the latest published version's attribution when one exists", () => {
    setup({
      draft: draftWithId({ scopeIncluded: "x" }),
      latestVersion: { version: 2, publishedByName: "สมชาย", publishedAt: "2026-07-30" },
    });
    expect(screen.getByText(/เวอร์ชัน 2/)).toBeInTheDocument();
    expect(screen.getByText(/สมชาย/)).toBeInTheDocument();
  });
});
