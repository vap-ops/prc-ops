# Spike 01: PDF generation with Playwright

## Question

Can we generate a 30-photo PDF report using Playwright's `chromium.page.pdf()`
from an HTML/CSS template with images embedded as base64 `data:` URIs, within
the 50 MB / 30 s budget?

This path matters because:

1. Playwright renders arbitrary HTML/CSS — required for visually-designed
   evidence reports.
2. Watermarking and report design iteration ride on the same HTML/CSS pipeline.
3. The Vercel deploy-size concern only exists for Playwright; choosing a
   non-browser PDF lib would dodge the question rather than answer it.

## Result

**PASS.** All four assertions in `tests/integration/spike-pdf.test.ts` pass.

| Metric        | Measured                                   | Budget  |
| ------------- | ------------------------------------------ | ------- |
| PDF file size | 18.56 MB                                   | < 50 MB |
| Wall time     | 3.9 s (warm)                               | < 30 s  |
| Pages         | 30 cards (3-col grid) over ~4 Letter pages |

Numbers from `pnpm exec tsx spikes/01-pdf-generation/bench.ts` on Windows
Server 2019, headless Chromium 147 (chromium-headless-shell v1217), Node 20.

## Files

- `template.html` — 3-column CSS grid template with `{{TITLE}}`,
  `{{PHOTO_COUNT}}`, `{{GENERATED_AT}}`, `{{CARDS}}` placeholders. Designers
  iterate on this directly.
- `generate-pdf.ts` — exports `generatePdf(photos)`: reads template, builds
  card HTML with base64-encoded image `data:` URIs, launches headless
  Chromium, calls `page.pdf()`, returns the output path.
- `generate-fixtures.ts` — uses `sharp` to generate 30 noise JPEGs at
  1280×960 q70 (~630 KB each, ~18.5 MB total) so the spike validates against
  realistic phone-photo input sizes.
- `bench.ts` — one-shot timed run for measuring real numbers.
- `output/` — gitignored. Generated PDFs land here as
  `report-<timestamp>.pdf`.
- `fixtures/` — gitignored. Regenerate with `pnpm spike:fixtures`.

## How to reproduce

```sh
pnpm install
pnpm exec playwright install chromium   # one time
pnpm spike:fixtures                     # generate 30 fixtures
pnpm test tests/integration/spike-pdf.test.ts
pnpm exec tsx spikes/01-pdf-generation/bench.ts   # for clean timing
```

## Notes / open follow-ups (not part of the spike)

- The output PDF is ~18.5 MB because Chromium re-encodes input JPEGs at
  fairly high quality. For real phone photos (often 2–5 MB each), the spec
  remains achievable but a server-side downscale step before base64 encoding
  will likely be desirable to bring report size down.
- Vercel function size limit (250 MB unzipped) for the eventual API route is
  the real production concern with Playwright. Not in scope for this spike;
  this spike only proves the pipeline works.
- `page.setContent(html, { waitUntil: "networkidle" })` is used because
  `data:` URIs resolve synchronously, so networkidle returns near-instantly
  but guarantees image decode is complete.

## Failed approaches

None. The Playwright path worked first try after `pnpm exec playwright
install chromium`.
