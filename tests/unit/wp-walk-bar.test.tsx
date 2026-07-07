import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

// Spec 278 U1 — the WP-detail "งานถัดไป" walk bar. prev/next link to the neighbour
// WP, preserving the ?from referrer so the back chip still returns to the caller.

import { WpWalkBar } from "@/components/features/work-packages/wp-walk-bar";
import type { WpWalk } from "@/lib/work-packages/wp-walk";

const walk: WpWalk = {
  prev: { id: "a", code: "WP-01" },
  next: { id: "c", code: "WP-03" },
  index: 1,
  total: 3,
};

describe("WpWalkBar", () => {
  it("links prev + next to the neighbour WP and preserves ?from", () => {
    render(<WpWalkBar projectId="p1" walk={walk} from="/projects/p1" />);
    expect(screen.getByRole("link", { name: /ก่อนหน้า/ })).toHaveAttribute(
      "href",
      "/projects/p1/work-packages/a?from=%2Fprojects%2Fp1",
    );
    expect(screen.getByRole("link", { name: /งานถัดไป/ })).toHaveAttribute(
      "href",
      "/projects/p1/work-packages/c?from=%2Fprojects%2Fp1",
    );
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("omits ?from when there is no referrer", () => {
    render(<WpWalkBar projectId="p1" walk={walk} />);
    expect(screen.getByRole("link", { name: /งานถัดไป/ })).toHaveAttribute(
      "href",
      "/projects/p1/work-packages/c",
    );
  });

  it("renders the end as non-interactive (no next link at the last WP)", () => {
    render(<WpWalkBar projectId="p1" walk={{ prev: walk.prev, next: null, index: 2, total: 3 }} />);
    expect(screen.queryByRole("link", { name: /งานถัดไป/ })).toBeNull();
    expect(screen.getByRole("link", { name: /ก่อนหน้า/ })).toBeInTheDocument();
  });

  it("renders nothing when there is neither a prev nor a next", () => {
    const { container } = render(
      <WpWalkBar projectId="p1" walk={{ prev: null, next: null, index: 0, total: 1 }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
