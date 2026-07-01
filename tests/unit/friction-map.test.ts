import { describe, expect, it } from "vitest";
import { buildFrictionMap, normalizeRoute } from "@/lib/usage/friction-map";

// Spec 244 U4 — the UX friction map: rank SCREENS by how much friction they generate
// (aggregate across all users), so the team gets a fix-list. Pure/DOM-free so the
// route-normalization + grouping logic is unit-testable. The tracker captures the raw
// pathname (with ids), so normalizeRoute collapses id segments to group by screen.

describe("normalizeRoute (spec 244 U4)", () => {
  it("keeps a plain route unchanged", () => {
    expect(normalizeRoute("/sa")).toBe("/sa");
    expect(normalizeRoute("/settings/usage")).toBe("/settings/usage");
  });

  it("collapses uuid + numeric id segments to :id", () => {
    expect(
      normalizeRoute(
        "/projects/1b0c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e/work-packages/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
    ).toBe("/projects/:id/work-packages/:id");
    expect(normalizeRoute("/requests/12345")).toBe("/requests/:id");
  });

  it("normalizes empty / root / trailing-slash paths to /", () => {
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("")).toBe("/");
    expect(normalizeRoute(null)).toBe("/");
    expect(normalizeRoute(undefined)).toBe("/");
    expect(normalizeRoute("/sa/")).toBe("/sa");
  });
});

describe("buildFrictionMap (spec 244 U4)", () => {
  it("groups friction by normalized route with a per-type breakdown", () => {
    const map = buildFrictionMap([
      { route: "/sa", event_type: "rage_tap" },
      { route: "/sa", event_type: "rage_tap" },
      { route: "/sa", event_type: "js_error" },
      { route: "/requests/1", event_type: "upload_fail" },
    ]);
    const sa = map.find((m) => m.route === "/sa");
    expect(sa?.total).toBe(3);
    expect(sa?.byType.rage_tap).toBe(2);
    expect(sa?.byType.js_error).toBe(1);
    expect(map.find((m) => m.route === "/requests/:id")?.total).toBe(1);
  });

  it("collapses different ids on the same screen into one row (aggregate, not per-id)", () => {
    const map = buildFrictionMap([
      { route: "/requests/1", event_type: "upload_fail" },
      { route: "/requests/2", event_type: "upload_fail" },
      { route: "/requests/3", event_type: "validation_error" },
    ]);
    expect(map).toHaveLength(1);
    expect(map[0]!.route).toBe("/requests/:id");
    expect(map[0]!.total).toBe(3);
  });

  it("ranks routes by total desc, breaking ties by route name", () => {
    const map = buildFrictionMap([
      { route: "/b", event_type: "js_error" },
      { route: "/a", event_type: "js_error" },
      { route: "/c", event_type: "rage_tap" },
      { route: "/c", event_type: "rage_tap" },
    ]);
    expect(map.map((m) => m.route)).toEqual(["/c", "/a", "/b"]);
  });

  it("returns an empty list for no friction", () => {
    expect(buildFrictionMap([])).toEqual([]);
  });
});
