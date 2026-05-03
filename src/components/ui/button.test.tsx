import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders with default variant", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: /click me/i })).toBeInTheDocument();
  });

  it("renders as child when asChild is true", () => {
    render(
      <Button asChild>
        <a href="/">Link</a>
      </Button>
    );
    expect(screen.getByRole("link", { name: /link/i })).toBeInTheDocument();
  });
});
