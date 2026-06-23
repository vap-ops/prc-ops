// Spec 190 — dark mode. The theme is a cookie-backed tri-state setting; the
// cookie is the single source of truth (readable both server-side, for the
// no-flash initial <html> class, and client-side, for the toggle + the pre-paint
// script). Default is LIGHT (operator decision 2026-06-24): the design system was
// built sun-first (spec 20), so dark is opt-in, not the default.
//
// resolveTheme + parseThemeSetting are pure (unit-tested). applyTheme is the DOM
// side-effect shared by the toggle; the pre-paint script (theme-script.tsx)
// reproduces the same resolution inline as a string (it can't import this module).

export type ThemeSetting = "light" | "dark" | "system";

export const THEME_COOKIE = "theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Cookie value (or any raw string) → a valid setting. Unknown / missing → light.
export function parseThemeSetting(raw: string | undefined | null): ThemeSetting {
  if (raw === "dark" || raw === "system") return raw;
  return "light";
}

// setting + the OS preference → is the dark palette active?
export function resolveTheme(setting: ThemeSetting, systemPrefersDark: boolean): boolean {
  if (setting === "system") return systemPrefersDark;
  return setting === "dark";
}

// --- client-side DOM helpers (used by the toggle) -------------------------

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

// Flip the <html> class + the native color-scheme (so form controls,
// scrollbars, and the UA match). Idempotent.
export function applyTheme(isDark: boolean): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.toggle("dark", isDark);
  el.style.colorScheme = isDark ? "dark" : "light";
}

// Persist the chosen setting as a year-long, lax cookie (sent on the next SSR so
// the initial class matches → no flash on reload).
export function setThemeCookie(setting: ThemeSetting): void {
  if (typeof document === "undefined") return;
  document.cookie = `${THEME_COOKIE}=${setting}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
}
