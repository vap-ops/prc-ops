// Spec 41 (width unification): THE one content-page width. Every page's
// header strip, nav strip, and content container use this same token —
// AppHeader/HubNav accept only `typeof PAGE_MAX_W`, so a page cannot
// drift to its own width again. Exceptions (recorded): /login,
// /profile, /coming-soon — single-card form screens stay max-w-md.
export const PAGE_MAX_W = "max-w-2xl md:max-w-4xl lg:max-w-6xl xl:max-w-7xl";
