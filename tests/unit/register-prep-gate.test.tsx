// Spec 343 U2 — the เตรียมตัว landing shown BEFORE the fresh registration form.
// A first-time applicant used to drop straight onto the form with no idea it
// needs an ID card and takes ~2 minutes; someone scanning at a site without
// their card on hand hit it cold. This gate sets the expectation, then hands off
// to the same form on one tap. It is a STATE, not a route — the QR params the
// form needs (?project&site&by&contractor&firm) never cross a navigation, which
// is the #677 bug class.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegisterPrepGate } from "@/components/features/register/register-prep-gate";
import {
  REGISTER_PREP_HEADING,
  REGISTER_PREP_START_LABEL,
  REGISTER_PREP_ID_CARD_ITEM,
  REGISTER_PREP_BANK_ITEM,
} from "@/lib/i18n/labels";

function Form() {
  return <div data-testid="the-form">form fields</div>;
}

describe("RegisterPrepGate — before the applicant starts", () => {
  it("shows the prep card, not the form", () => {
    render(
      <RegisterPrepGate bankExempt={false}>
        <Form />
      </RegisterPrepGate>,
    );
    expect(screen.getByText(REGISTER_PREP_HEADING)).toBeInTheDocument();
    expect(screen.queryByTestId("the-form")).toBeNull();
  });

  it("names the ID card as something to bring", () => {
    render(
      <RegisterPrepGate bankExempt={false}>
        <Form />
      </RegisterPrepGate>,
    );
    expect(screen.getByText(REGISTER_PREP_ID_CARD_ITEM)).toBeInTheDocument();
  });

  it("asks a PRC applicant for a passbook too", () => {
    render(
      <RegisterPrepGate bankExempt={false}>
        <Form />
      </RegisterPrepGate>,
    );
    expect(screen.getByText(REGISTER_PREP_BANK_ITEM)).toBeInTheDocument();
  });

  it("does NOT ask a bank-exempt firm member for a passbook", () => {
    render(
      <RegisterPrepGate bankExempt>
        <Form />
      </RegisterPrepGate>,
    );
    expect(screen.queryByText(REGISTER_PREP_BANK_ITEM)).toBeNull();
    // The ID card is still required of a firm member.
    expect(screen.getByText(REGISTER_PREP_ID_CARD_ITEM)).toBeInTheDocument();
  });
});

describe("RegisterPrepGate — after the applicant starts", () => {
  it("swaps to the form when เริ่มกรอกข้อมูล is tapped", async () => {
    const { act } = await import("@testing-library/react");
    render(
      <RegisterPrepGate bankExempt={false}>
        <Form />
      </RegisterPrepGate>,
    );
    await act(async () => {
      screen.getByRole("button", { name: REGISTER_PREP_START_LABEL }).click();
    });
    expect(screen.getByTestId("the-form")).toBeInTheDocument();
    expect(screen.queryByText(REGISTER_PREP_HEADING)).toBeNull();
  });
});
