// Pure: the on-screen (mobile) keyboard inset in px, from VisualViewport
// readings. The soft keyboard shrinks the *visual* viewport but NOT the
// *layout* viewport, so a fixed / bottom-docked overlay is occluded at the
// bottom by `innerHeight - visualViewport.height - visualViewport.offsetTop`
// pixels. (Spec 95 handled auto-zoom + document scroll; this is the separate
// "keyboard covers the field inside a fixed sheet" case.)
//
// The hook useKeyboardInset (use-keyboard-inset.ts) feeds this live; kept pure
// here so the arithmetic is unit-tested without a browser.
export function keyboardInset(
  innerHeight: number,
  visualViewportHeight: number,
  visualViewportOffsetTop: number,
): number {
  const inset = innerHeight - visualViewportHeight - visualViewportOffsetTop;
  // Negative / sub-pixel readings are viewport-chrome jitter, not a keyboard.
  return inset > 0 ? Math.round(inset) : 0;
}
