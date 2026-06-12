// Shared next/navigation mock for component tests whose subject calls
// useRouter().refresh() (the spec 53 RefreshButton pattern). Spec 65
// consolidation — replaces five identical hand-rolled per-file factories.
//
// Usage in a test file:
//   vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));
//   import { refreshMock } from "../helpers/router-refresh";
//
// Vitest isolates modules per test file, so each file gets its own fresh
// refreshMock — same lifetime as the old per-file `const refreshMock =
// vi.fn()`. Files that assert call counts keep resetting it in their own
// beforeEach, exactly as before.
//
// Not collected as a suite: vitest's include globs cover only tests/unit
// and tests/integration.
import { vi } from "vitest";

export const refreshMock = vi.fn();

export function useRouter() {
  return { refresh: refreshMock };
}
