import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spec 294: the sandbox banner shows ONLY when NEXT_PUBLIC_APP_ENV=sandbox —
// production builds (var unset) render nothing. It names the environment and
// the deployed commit so a designer/tester can always tell they are current.

const envState: { NEXT_PUBLIC_APP_ENV?: string; NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?: string } = {};

vi.mock("@/lib/env", () => ({
  get clientEnv() {
    return envState;
  },
}));

async function renderBanner() {
  const { SandboxBanner } = await import("@/components/features/chrome/sandbox-banner");
  return render(<SandboxBanner />);
}

describe("SandboxBanner (spec 294)", () => {
  beforeEach(() => {
    delete envState.NEXT_PUBLIC_APP_ENV;
    delete envState.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
  });
  afterEach(() => {
    cleanup();
    vi.resetModules();
  });

  it("renders nothing when NEXT_PUBLIC_APP_ENV is unset (production)", async () => {
    const { container } = await renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the sandbox notice with the short commit sha", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    envState.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = "abcdef1234567890";
    await renderBanner();
    expect(screen.getByText(/SANDBOX/)).toBeInTheDocument();
    expect(screen.getByText(/abcdef1/)).toBeInTheDocument();
    // Thai copy tells non-dev users this is safe test data
    expect(screen.getByText(/ข้อมูลทดสอบ/)).toBeInTheDocument();
  });

  it("renders without a sha when the commit var is absent", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    await renderBanner();
    expect(screen.getByText(/SANDBOX/)).toBeInTheDocument();
  });
});
