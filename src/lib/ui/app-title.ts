// The app's name and the document-title shape it composes — ONE declaration,
// consumed by both the side that WRITES titles and the side that READS them.
//
// It exists because those two sides used to hand-copy each other. The root
// layout declared `title: { default: "PRC Ops", template: "%s — PRC Ops" }`,
// and the route-announcement layer declared its own `" — PRC Ops"` and
// `"PRC Ops"` to strip back off. Nothing connected them, and the test that
// looked like it covered the suffix asserted the constant against itself — so
// renaming the app or changing the separator would have left every test green
// while every spoken announcement kept a stale suffix glued on, and a page with
// no title of its own would have started being announced as the app name
// instead of staying silent.
//
// Deliberately a LEAF: no imports, no `server-only`, no `"use client"`. The
// layout is a Server Component and the announcer is in the client bundle, so
// anything else here would poison one of them (spec 371 U2 took /dashboard down
// with exactly that mistake).

/** The product's name. Renaming it here renames it everywhere, by construction. */
export const APP_NAME = "PRC Ops";

/** Em dash with spaces, as the shipped titles read: `โครงการ — PRC Ops`. */
export const APP_TITLE_SEPARATOR = " — ";

/** What every routed page's `document.title` ends with. */
export const APP_TITLE_SUFFIX = `${APP_TITLE_SEPARATOR}${APP_NAME}`;

/**
 * Next's `metadata.title.template`. `%s` is Next's placeholder for the page's
 * own title; a template without it would give every page the same one.
 */
export const APP_TITLE_TEMPLATE = `%s${APP_TITLE_SUFFIX}`;
