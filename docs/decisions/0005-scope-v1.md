# ADR 0005: v1 Scope

Date: 2026-05-03  
Status: Accepted

## Context

We have a 90-day delivery target for a meaningful pilot. Scope must be ruthlessly constrained to ship something useful without over-engineering.

## Decision

### 90-Day Goal

Run **2 pilot projects end-to-end** with:

- Photo upload by site admins via PWA.
- PM approval workflow.
- PDF report generation.
- Replacement of AppSheet for those 2 projects.

### In Scope for v1

- Project and work package management (read + import).
- Photo upload, storage, and watermark-on-demand.
- PM approval flow with audit trail.
- PDF report generation from approved photos.
- LINE OAuth login for site admins and PMs.
- Role-based access via Supabase RLS.

### Out of Scope for v1

| Feature                     | Rationale                              |
| --------------------------- | -------------------------------------- |
| DC (Daily Check) entries    | Complex; schema designed but not built |
| Biometric data              | Regulatory sensitivity; deferred       |
| Profit-share calculations   | Dependent on DC data                   |
| Gamification / leaderboards | Nice-to-have; v2                       |
| Technician LIFF Mini App    | LINE Mini App platform; v2             |
| Drone / CCTV integration    | Hardware dependency; v2                |
| Task-level tracking         | Granularity not needed for pilot       |
| Google Sheets auto-sync     | Manual import sufficient for v1        |

### Schema Strategy

- Schemas for DC entries and biometric tables will be **designed** during v1 (as ADRs + migration files) but **not deployed** or built out in the UI.
- This avoids schema churn when v2 development begins.

## Consequences

- Tight scope means the pilot is achievable in 90 days.
- AppSheet remains in use for non-pilot projects during v1; dual operation is accepted.
- Design-only for DC/biometric means v2 can start with a stable foundation rather than retrofitting.
