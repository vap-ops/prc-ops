// Bug 8e9c9fc7 — the conversation detail page (where the operator reviews a report)
// showed no attached images. FeedbackAttachmentGallery is the presentational fix:
// given signed URLs it renders a clickable thumbnail per image; given none it renders
// nothing. This guards the regression — if attachments stop rendering, this fails.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeedbackAttachmentGallery } from "@/components/features/feedback/feedback-attachment-gallery";

describe("FeedbackAttachmentGallery", () => {
  it("renders an image per attachment url", () => {
    render(<FeedbackAttachmentGallery urls={["https://s/a", "https://s/b"]} />);
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(2);
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["https://s/a", "https://s/b"]);
  });

  it("links each thumbnail to the full image in a new tab", () => {
    render(<FeedbackAttachmentGallery urls={["https://s/a"]} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://s/a");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders nothing when there are no attachments", () => {
    const { container } = render(<FeedbackAttachmentGallery urls={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
