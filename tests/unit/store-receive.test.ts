import { describe, it, expect } from "vitest";
import { isReceivedIntoStore } from "@/lib/purchasing/store-receive";

// Mirrors the spec-195-P3 trigger condition (purchase_requests_stock_in_on_receive):
// a WP-less (store-bound) PR reaching `delivered` auto-books its stock_receipt.
describe("isReceivedIntoStore", () => {
  it("true only for a delivered, store-bound (WP-less) PR", () => {
    expect(isReceivedIntoStore("delivered", null)).toBe(true);
  });
  it("false while still on_route (not yet delivered)", () => {
    expect(isReceivedIntoStore("on_route", null)).toBe(false);
  });
  it("false for a WP-bound delivered PR (goes to WP-WIP, not the store)", () => {
    expect(isReceivedIntoStore("delivered", "eeeeeeee-eeee-eeee-eeee-eeeeeeeeaaaa")).toBe(false);
  });
  it("false for other statuses", () => {
    expect(isReceivedIntoStore("purchased", null)).toBe(false);
    expect(isReceivedIntoStore("requested", null)).toBe(false);
  });
});
