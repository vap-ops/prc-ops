// Vitest stand-in for the `server-only` poison package (spec 65).
// Wired as a resolve.alias in vitest.config.ts so unit tests can import
// server-only modules without a per-file vi.mock("server-only") preamble.
// The real package throws when bundled into a Client Component — that
// protection is a build-time concern and stays fully active in `next build`.
export {};
