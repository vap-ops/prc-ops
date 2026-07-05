// Settings hub regroup — SettingsSectionCard renders one GROUPED card per
// section (iOS-Settings style): rows share a single bordered container with
// hairline dividers, instead of each row floating as its own card. Pins the
// grouped-card contract: divide-y + overflow-hidden on the card, ring-inset
// rows with no per-row border, badge injection by href, aria-disabled
// coming-soon rows, and null render when a role sees no entries.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsSectionCard } from "@/app/settings/section-card";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/app/settings/sections";

const section = (key: string): SettingsSection => {
  const found = SETTINGS_SECTIONS.find((s) => s.key === key);
  if (!found) throw new Error(`missing section ${key}`);
  return found;
};

describe("SettingsSectionCard", () => {
  it("renders link rows inside ONE grouped card (divide-y, clipped, bordered)", () => {
    const { container } = render(
      <SettingsSectionCard section={section("master-data")} role="project_manager" />,
    );
    const links = container.querySelectorAll("a");
    // Spec 266 U6: master-data dropped /workers (→ ทีมช่าง section), 7 → 6.
    expect(links).toHaveLength(6);
    expect(links[0]?.getAttribute("href")).toBe("/contacts/customers");

    const card = links[0]?.parentElement;
    expect(card).toBeTruthy();
    for (const cls of ["divide-y", "divide-edge", "overflow-hidden", "border", "rounded-control"]) {
      expect(card?.className).toContain(cls);
    }
    // every row lives in the SAME card
    for (const a of links) expect(a.parentElement).toBe(card);
  });

  it("rows are grouped rows, not floating cards: ring-inset, no per-row border/radius", () => {
    const { container } = render(
      <SettingsSectionCard section={section("master-data")} role="project_manager" />,
    );
    const row = container.querySelector("a");
    expect(row?.className).toContain("focus-visible:ring-inset");
    expect(row?.className).not.toContain("border");
    expect(row?.className).not.toContain("rounded-control");
  });

  it("renders a badge for the matching href", () => {
    render(
      <SettingsSectionCard
        section={section("help")}
        role="super_admin"
        badges={{ "/feedback": <span data-testid="b">B</span> }}
      />,
    );
    expect(screen.getByTestId("b")).toBeInTheDocument();
  });

  it("coming-soon rows are aria-disabled, not links", () => {
    const { container } = render(
      <SettingsSectionCard section={section("coming-soon")} role="site_admin" />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll('[aria-disabled="true"]')).toHaveLength(2);
  });

  it("renders nothing when the role sees no entries", () => {
    const { container } = render(
      <SettingsSectionCard section={section("admin")} role="site_admin" />,
    );
    expect(container.firstChild).toBeNull();
  });
});
