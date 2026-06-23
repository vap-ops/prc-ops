// Spec 190 — the pre-paint theme script. Runs synchronously before first paint
// (it's the first thing in <body>) so a 'dark' or 'system'-on-a-dark-OS user
// never sees a light flash. It reproduces resolveTheme/parseThemeSetting inline
// (a string can't import the module) and stays tiny. The server already sets the
// 'dark' class for an explicit dark cookie (layout.tsx) — this also covers the
// 'system' case, which the server can't resolve, and reconciles on bfcache
// restore. Default LIGHT when no cookie (sun-first, opt-in dark).
//
// suppressHydrationWarning on <html> (layout.tsx) absorbs the class the server
// could not predict for 'system' users.

const SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|; )theme=([^;]+)/);
var s=m?decodeURIComponent(m[1]):'light';
var dark=s==='dark'||(s==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var e=document.documentElement;
e.classList.toggle('dark',dark);
e.style.colorScheme=dark?'dark':'light';
}catch(_){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
