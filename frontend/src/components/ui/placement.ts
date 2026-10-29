export type Box = { top: number; left: number; right: number; bottom: number };

const MARGIN = 8;
const GAP = 6;

/**
 * Where a tooltip panel goes, in viewport coordinates, so it never runs past
 * the screen edge. The panel starts under its button, lined up with the
 * button's left or right edge as asked, then slides back inside the viewport.
 * It opens above the button when there is no room below and more room above.
 */
export function placeTooltip(
  anchor: Box,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'left' | 'right',
): { top: number; left: number } {
  const wanted = align === 'left' ? anchor.left : anchor.right - panel.width;
  const left = Math.max(MARGIN, Math.min(wanted, viewport.width - panel.width - MARGIN));
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - panel.height;
  const fitsBelow = below + panel.height <= viewport.height - MARGIN;
  const top = fitsBelow || above < MARGIN ? below : above;
  return { top: Math.max(MARGIN, Math.min(top, viewport.height - panel.height - MARGIN)), left };
}
