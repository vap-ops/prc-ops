# ADR 0003: Photo Upload and Watermarking

Date: 2026-05-03  
Status: Accepted

## Context

Site admins capture construction progress photos using their existing devices. Photos need to be stored immutably, support optional watermarking for reports and sharing, and preserve EXIF metadata for audit purposes.

## Decision

### Capture

- Site admins use their existing camera app or a timestamp camera app of their choice.
- Bulk upload is performed via the PWA after photos are captured.

### Storage

- **Originals are stored unmodified** in Supabase Storage. No compression, resizing, or modification on upload.
- Storage paths are recorded in the `photo_logs` table with a reference to the originating work package.

### EXIF

- EXIF metadata is **parsed server-side** on upload and stored as structured fields in `photo_logs`.
- Client-reported timestamps are recorded but not trusted; server receipt timestamp is authoritative.

### Watermarking

- Watermarks are **rendered on demand server-side** — never baked into stored originals.
- The watermark is applied when a user toggles it on for download, share, or report generation.
- **One watermark template** is used in v1. Exact fields (e.g. project name, date, logo) are to be finalised before week 9.

## Consequences

- Storing originals unmodified preserves evidentiary value and allows future re-processing with different watermark templates.
- On-demand server-side rendering adds latency to download/share actions but keeps storage simple.
- EXIF parsing server-side means we control the extraction logic and can handle malformed EXIF gracefully.
