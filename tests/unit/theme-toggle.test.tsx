// Spec 190 U1 — ThemeToggle: a 3-way segmented control (สว่าง / มืด / ระบบ) on
// /settings. Reflects the current setting (aria-pressed), and on change applies
// the <html> class + persists the cookie. Default light (sun-first, opt-in dark).

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "@/components/features/chrome/theme-toggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    document.cookie = "theme=; path=/; max-age=0";
  });

  it("renders the three options with the initial one pressed", () => {
    render(<ThemeToggle initial="light" />);
    expect(screen.getByRole("button", { name: "สว่าง" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "มืด" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "ระบบ" })).toHaveAttribute("aria-pressed", "false");
  });

  it("selecting มืด presses it, applies the dark class, and writes the cookie", () => {
    render(<ThemeToggle initial="light" />);
    fireEvent.click(screen.getByRole("button", { name: "มืด" }));
    expect(screen.getByRole("button", { name: "มืด" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain("theme=dark");
  });

  it("selecting สว่าง removes the dark class", () => {
    render(<ThemeToggle initial="dark" />);
    expect(document.documentElement.classList.contains("dark")).toBe(false); // not applied on mount, only on click
    fireEvent.click(screen.getByRole("button", { name: "มืด" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "สว่าง" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
