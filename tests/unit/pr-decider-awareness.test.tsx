// Operator report 2026-07-31: "procurement manager needs access to pr tracker,
// she cannot find the page" (with a screenshot of a PM's /requests — the spec-22
// stepper cards under a leading รออนุมัติ band).
//
// She is not locked out: PURCHASING_ROLES admits her, /requests/[id] gates the
// decision on isPurchaseDecider (spec 286), and telemetry shows /requests as her
// single most-visited route. What she lacks is AWARENESS, in two places written
// before spec 286 delegated the PR decision to procurement_manager:
//
//   1. the pending-decision badge was gated on isManagerRole (PM tier only), in
//      BOTH the bottom bar and the desktop strip — so a decider whose spine has
//      no /requests tab (spec 323 U3b) saw no count anywhere;
//   2. the procurement pipeline put awaiting_approval LAST ("visibility only —
//      procurement can't act yet"), and groupByProcurementBand drops empty bands,
//      so the one pile only she can clear rendered below the history piles.
//
// These tests pin both, plus the pure helper that decides WHICH nav item carries
// the count (her spine's หน้าหลัก tab claims /requests via `match`, so the badge
// cannot ride a /requests item that does not exist for her).

import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUsePathname } = vi.hoisted(() => ({ mockUsePathname: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: mockUsePathname,
}));

// The badges self-fetch their count through the browser client (RLS-scoped).
// A fixed non-zero count is all these tests need — the pill is hidden at zero,
// so a zero here would make every assertion below vacuously "absent".
const { mockCount } = vi.hoisted(() => ({ mockCount: { value: 3 } }));

vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({
    from: () => {
      const result = Promise.resolve({ count: mockCount.value });
      const chain = {
        select: () => chain,
        eq: () => result,
        neq: () => result,
        then: result.then.bind(result),
      };
      return chain;
    },
  }),
}));

import { BottomTabBar } from "@/components/features/chrome/bottom-tab-bar";
import { HubNav, hubNavForRole } from "@/components/features/chrome/hub-nav";
import { purchaseDecisionBadgeHref } from "@/lib/auth/role-home";
import {
  groupByProcurementBand,
  procurementBandsFor,
  PROCUREMENT_BANDS,
} from "@/lib/purchasing/procurement-pipeline";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { PAGE_MAX_W } from "@/lib/ui/page-width";
import type { UserRole } from "@/lib/db/enums";

const PURCHASE_BADGE_LABEL = "คำขอซื้อรอพิจารณา 3 รายการ";

describe("purchaseDecisionBadgeHref", () => {
  // Exhaustive over the WHOLE role domain (USER_ROLE_LABEL is a
  // Record<UserRole>, so a new enum member reds this test rather than silently
  // defaulting to "no badge"). Asserting the EXACT map — not just "the deciders
  // get something" — so adding a role to the badge also has to be deliberate.
  it("names the badge's nav item for every role", () => {
    const actual = Object.fromEntries(
      (Object.keys(USER_ROLE_LABEL) as UserRole[])
        .map((role) => [role, purchaseDecisionBadgeHref(role)] as const)
        .filter(([, href]) => href !== null),
    );
    expect(actual).toEqual({
      // The PM tier decides and has a จัดซื้อ tab pointing straight at the queue.
      project_manager: "/requests",
      super_admin: "/requests",
      project_director: "/requests",
      // Spec 286: procurement_manager decides too — but its STR spine has no
      // /requests item (spec 323 U3b), so the count rides the หน้าหลัก tab that
      // claims /requests via `match`.
      procurement_manager: "/procurement",
    });
  });

  it("gives plain procurement no badge — it processes purchases, it does not decide", () => {
    expect(purchaseDecisionBadgeHref("procurement")).toBeNull();
  });

  it("gives a requester no badge — site_admin raises requests, someone else decides", () => {
    expect(purchaseDecisionBadgeHref("site_admin")).toBeNull();
  });
});

describe("BottomTabBar pending-purchase badge", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/procurement");
    mockCount.value = 3;
  });

  it("rides procurement_manager's หน้าหลัก tab (the one that claims /requests)", async () => {
    render(<BottomTabBar role="procurement_manager" />);
    const badge = await screen.findByLabelText(PURCHASE_BADGE_LABEL);
    // The pill sits inside the tab's icon wrapper, so its nearest link is the tab.
    expect(badge.closest("a")).toHaveAttribute("href", "/procurement");
  });

  it("stays off plain procurement's bar", async () => {
    render(<BottomTabBar role="procurement" />);
    // Give the self-fetching island a tick to resolve before asserting absence,
    // so this cannot pass merely by racing the effect.
    await screen.findByText("ขอบเขต");
    expect(screen.queryByLabelText(PURCHASE_BADGE_LABEL)).toBeNull();
  });

  it("still rides the PM tier's จัดซื้อ tab", async () => {
    mockUsePathname.mockReturnValue("/dashboard");
    render(<BottomTabBar role="project_manager" />);
    const badge = await screen.findByLabelText(PURCHASE_BADGE_LABEL);
    expect(badge.closest("a")).toHaveAttribute("href", "/requests");
  });
});

describe("HubNav pending-purchase badge", () => {
  it("rides procurement_manager's หน้าหลัก strip item", async () => {
    const items = hubNavForRole("procurement_manager");
    expect(items).not.toBeNull();
    render(
      <HubNav
        maxWidthClass={PAGE_MAX_W}
        items={items!}
        currentHref="/procurement"
        role="procurement_manager"
      />,
    );
    const badge = await screen.findByLabelText(PURCHASE_BADGE_LABEL);
    expect(badge.closest("a")).toHaveAttribute("href", "/procurement");
  });

  it("stays off plain procurement's strip", async () => {
    const items = hubNavForRole("procurement");
    render(
      <HubNav
        maxWidthClass={PAGE_MAX_W}
        items={items!}
        currentHref="/procurement"
        role="procurement"
      />,
    );
    await screen.findByText("ทรัพยากร");
    expect(screen.queryByLabelText(PURCHASE_BADGE_LABEL)).toBeNull();
  });
});

describe("procurementBandsFor", () => {
  it("leads with รออนุมัติ for a decider, and renders it hot", () => {
    const bands = procurementBandsFor(true);
    expect(bands.map((b) => b.band)).toEqual([
      "awaiting_approval",
      "to_order",
      "in_transit",
      "received",
    ]);
    // hot = the amber "this is your action" treatment. For a decider the pending
    // pile IS the action; to_order keeps its own hot state (she buys as well).
    expect(bands.find((b) => b.band === "awaiting_approval")?.hot).toBe(true);
    expect(bands.find((b) => b.band === "to_order")?.hot).toBe(true);
  });

  it("leaves plain procurement's buyer order untouched", () => {
    expect(procurementBandsFor(false)).toEqual(PROCUREMENT_BANDS);
    expect(procurementBandsFor(false).map((b) => b.band)).toEqual([
      "to_order",
      "in_transit",
      "received",
      "awaiting_approval",
    ]);
  });

  it("does not mutate the shared PROCUREMENT_BANDS constant", () => {
    procurementBandsFor(true);
    expect(PROCUREMENT_BANDS.map((b) => b.band)).toEqual([
      "to_order",
      "in_transit",
      "received",
      "awaiting_approval",
    ]);
    expect(PROCUREMENT_BANDS.find((b) => b.band === "awaiting_approval")?.hot).toBe(false);
  });
});

describe("/requests wires the decider band order", () => {
  // The page is a Server Component this suite cannot render, so the pin is a
  // source scan: comments stripped first (a comment naming the helper would
  // satisfy a bare toContain), and the EXACT use count asserted — 2 = the
  // import plus one real call. ≥2 alone would stay green with the call deleted
  // once a second use ever lands.
  // Same strip shape as doc-chase-surfaces.test.ts (the house pattern).
  const source = readFileSync("src/app/requests/page.tsx", "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const uses = (needle: string) => source.split(needle).length - 1;

  it("calls procurementBandsFor with the caller's decider status", () => {
    expect(uses("procurementBandsFor")).toBe(2);
    expect(uses("isPurchaseDecider")).toBe(2);
    expect(source).toContain("procurementBandsFor(isPurchaseDecider(ctx.role))");
  });

  it("passes those bands into the grouping, not the bare default", () => {
    expect(source).toContain("groupByProcurementBand(filteredRequests, pipelineBands)");
    // The bare one-arg call is what this unit replaced — pin its absence, or a
    // revert reads as green (the default parameter keeps it compiling).
    expect(source).not.toContain("groupByProcurementBand(filteredRequests)");
  });
});

describe("groupByProcurementBand", () => {
  const ROWS = [
    { id: "a", status: "requested" },
    { id: "b", status: "approved" },
    { id: "c", status: "delivered" },
  ];

  it("emits groups in the caller's band order", () => {
    expect(groupByProcurementBand(ROWS, procurementBandsFor(true)).map((g) => g.meta.band)).toEqual(
      ["awaiting_approval", "to_order", "received"],
    );
  });

  it("defaults to the buyer order when no bands are passed", () => {
    expect(groupByProcurementBand(ROWS).map((g) => g.meta.band)).toEqual([
      "to_order",
      "received",
      "awaiting_approval",
    ]);
  });

  it("still drops empty bands", () => {
    const groups = groupByProcurementBand(
      [{ id: "a", status: "requested" }],
      procurementBandsFor(true),
    );
    expect(groups.map((g) => g.meta.band)).toEqual(["awaiting_approval"]);
  });
});
