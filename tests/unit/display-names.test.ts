// Tests for the shared admin-client display-name resolver (spec 17 item E)
// that consolidates pm/requests' fetchRequesterNames and the PM WP review
// page's fetchDeciderNames. The admin client is mocked at the module
// boundary; the helper's contract is the Map shape and the non-fatal
// error path.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }));

vi.mock("@/lib/db/admin", () => ({
  createClient: mockCreateClient,
}));

import { fetchDisplayNames } from "@/lib/users/display-names";

function clientReturning(result: { data: unknown; error: unknown }) {
  const inFn = vi.fn().mockResolvedValue(result);
  const selectFn = vi.fn().mockReturnValue({ in: inFn });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn });
  return { client: { from: fromFn }, fromFn, selectFn, inFn };
}

describe("fetchDisplayNames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty map for empty input without creating a client", async () => {
    const result = await fetchDisplayNames([], "[test]");
    expect(result.size).toBe(0);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("maps user ids to full names", async () => {
    const { client, fromFn, inFn } = clientReturning({
      data: [
        { id: "a", full_name: "สมชาย" },
        { id: "b", full_name: "สมหญิง" },
      ],
      error: null,
    });
    mockCreateClient.mockReturnValue(client);

    const result = await fetchDisplayNames(["a", "b"], "[test]");
    expect(fromFn).toHaveBeenCalledWith("users");
    expect(inFn).toHaveBeenCalledWith("id", ["a", "b"]);
    expect(result.get("a")).toBe("สมชาย");
    expect(result.get("b")).toBe("สมหญิง");
  });

  it("skips rows with a null full_name", async () => {
    const { client } = clientReturning({
      data: [
        { id: "a", full_name: null },
        { id: "b", full_name: "สมหญิง" },
      ],
      error: null,
    });
    mockCreateClient.mockReturnValue(client);

    const result = await fetchDisplayNames(["a", "b"], "[test]");
    expect(result.has("a")).toBe(false);
    expect(result.get("b")).toBe("สมหญิง");
  });

  it("returns an empty map and logs with the caller's tag on query error", async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: "boom" },
    });
    mockCreateClient.mockReturnValue(client);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await fetchDisplayNames(["a"], "[pm/requests]");
    expect(result.size).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[pm/requests]"),
      expect.anything(),
    );
    errorSpy.mockRestore();
  });
});
