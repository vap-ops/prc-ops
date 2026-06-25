import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LaborBudgetCard } from "@/components/features/labor/labor-budget-card";
import { laborBudgetSummary } from "@/lib/labor/budget";

// The embedded LaborBudgetControl is a client component (useRouter).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("LaborBudgetCard", () => {
  const base = { workPackageId: "wp-1", revalidate: "/review/work-packages/wp-1" };

  it("unset → prompts to set a budget; no used/remaining rows", () => {
    render(<LaborBudgetCard summary={laborBudgetSummary(null, 12000)} {...base} />);
    expect(screen.getByText("ยังไม่ได้ตั้งงบค่าแรง")).toBeInTheDocument();
    // control idle label is the "set" verb when unset
    expect(screen.getByText("ตั้งงบค่าแรง")).toBeInTheDocument();
    expect(screen.queryByText("ใช้ไป")).not.toBeInTheDocument();
    expect(screen.queryByText("คงเหลือ")).not.toBeInTheDocument();
  });

  it("under budget → budget + used (with %) + remaining; control shows the edit verb", () => {
    render(<LaborBudgetCard summary={laborBudgetSummary(100000, 40000)} {...base} />);
    expect(screen.getByText("100,000 บาท")).toBeInTheDocument();
    expect(screen.getByText("ใช้ไป")).toBeInTheDocument();
    expect(screen.getByText("40,000 บาท")).toBeInTheDocument();
    expect(screen.getByText("(40%)")).toBeInTheDocument();
    expect(screen.getByText("คงเหลือ")).toBeInTheDocument();
    expect(screen.getByText("60,000 บาท")).toBeInTheDocument();
    expect(screen.getByText("แก้งบค่าแรง")).toBeInTheDocument();
    // accessible progress semantics (matches work-package-list's bar)
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  });

  it("over budget → shows เกินงบ and the absolute overage, not คงเหลือ", () => {
    render(<LaborBudgetCard summary={laborBudgetSummary(100000, 130000)} {...base} />);
    expect(screen.getByText("เกินงบ")).toBeInTheDocument();
    expect(screen.getByText("30,000 บาท")).toBeInTheDocument();
    expect(screen.queryByText("คงเหลือ")).not.toBeInTheDocument();
  });
});
