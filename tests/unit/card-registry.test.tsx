// Spec 310 U2 — behavior coverage for the company-card registry component:
// add creates (id=null), แก้ไข populates + updates (id set), empty label blocks.

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

type UpsertInput = { id: string | null; label: string; holderUserId: string; last4: string | null };
const upsertCompanyCard = vi.fn(async (_i: UpsertInput) => ({ ok: true, id: "new-id" }) as const);
const deactivateCompanyCard = vi.fn(async (_id: string) => ({ ok: true }) as const);
vi.mock("@/app/settings/cards/actions", () => ({
  upsertCompanyCard: (i: UpsertInput) => upsertCompanyCard(i),
  deactivateCompanyCard: (id: string) => deactivateCompanyCard(id),
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CardRegistry } from "@/components/features/expenses/card-registry";
import type { CompanyCard, HolderOption } from "@/lib/expenses/load-office-expenses";
import {
  CARD_ADD_LABEL,
  CARD_HOLDER_LABEL,
  CARD_LAST4_LABEL,
  CARD_NAME_LABEL,
  CARD_SAVE_LABEL,
} from "@/lib/i18n/labels";

const holders: HolderOption[] = [
  { id: "u-pat", fullName: "Pattrawut" },
  { id: "u-acc", fullName: "Accounting" },
];
const existing: CompanyCard = {
  id: "card-1",
  label: "PD Visa",
  holderUserId: "u-pat",
  holderName: "Pattrawut",
  last4: "4821",
  isActive: true,
};

beforeEach(() => {
  upsertCompanyCard.mockClear();
  deactivateCompanyCard.mockClear();
  refresh.mockClear();
});

describe("CardRegistry", () => {
  it("adds a new card with id=null and the entered fields", async () => {
    render(<CardRegistry cards={[]} holders={holders} />);
    fireEvent.change(screen.getByLabelText(CARD_NAME_LABEL), { target: { value: "  PD Visa  " } });
    fireEvent.change(screen.getByLabelText(CARD_HOLDER_LABEL), { target: { value: "u-pat" } });
    fireEvent.change(screen.getByLabelText(CARD_LAST4_LABEL), { target: { value: "4821" } });
    fireEvent.click(screen.getByRole("button", { name: CARD_ADD_LABEL }));

    await waitFor(() =>
      expect(upsertCompanyCard).toHaveBeenCalledWith({
        id: null,
        label: "  PD Visa  ",
        holderUserId: "u-pat",
        last4: "4821",
      }),
    );
  });

  it("blocks submit with an empty label (action not called)", () => {
    render(<CardRegistry cards={[]} holders={holders} />);
    fireEvent.change(screen.getByLabelText(CARD_HOLDER_LABEL), { target: { value: "u-pat" } });
    fireEvent.click(screen.getByRole("button", { name: CARD_ADD_LABEL }));
    expect(upsertCompanyCard).not.toHaveBeenCalled();
  });

  it("แก้ไข populates the form and updates with the card id", async () => {
    render(<CardRegistry cards={[existing]} holders={holders} />);
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    // form now shows the card's values + a Save button
    expect((screen.getByLabelText(CARD_NAME_LABEL) as HTMLInputElement).value).toBe("PD Visa");
    fireEvent.change(screen.getByLabelText(CARD_NAME_LABEL), { target: { value: "PD Master" } });
    fireEvent.click(screen.getByRole("button", { name: CARD_SAVE_LABEL }));

    await waitFor(() =>
      expect(upsertCompanyCard).toHaveBeenCalledWith({
        id: "card-1",
        label: "PD Master",
        holderUserId: "u-pat",
        last4: "4821",
      }),
    );
  });

  it("last4 input strips non-digits", () => {
    render(<CardRegistry cards={[]} holders={holders} />);
    const last4 = screen.getByLabelText(CARD_LAST4_LABEL) as HTMLInputElement;
    fireEvent.change(last4, { target: { value: "12ab" } });
    expect(last4.value).toBe("12");
  });
});
