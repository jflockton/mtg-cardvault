// Card-frame geometry shared by the live-feed overlay and the frame cropper.
// One source of truth: what the operator aligns the card to on screen is
// exactly what gets cropped for OCR (step 3).
//
// All region rects are in card-relative coordinates (0..1 of the card guide's
// width/height, origin top-left).

export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

/** Physical MTG card aspect ratio (63mm × 88mm). */
export const CARD_ASPECT = 63 / 88

/** Fraction of the video frame height the card guide occupies. */
export const GUIDE_HEIGHT_FRAC = 0.92

/** Title bar: the card name across the top. OCR cross-check source. */
export const TITLE_REGION: NormRect = { x: 0.03, y: 0.03, w: 0.94, h: 0.085 }

/**
 * Bottom-left corner: collector number + set code, two small lines
 * (e.g. "0123/280 R" over "M21 • EN"). The primary identifier.
 */
export const CORNER_REGION: NormRect = { x: 0.0, y: 0.895, w: 0.46, h: 0.105 }

/** The card guide rect in display/frame pixels, centered horizontally. */
export function cardGuideRect(frameWidth: number, frameHeight: number): {
  x: number
  y: number
  w: number
  h: number
} {
  const h = frameHeight * GUIDE_HEIGHT_FRAC
  const w = h * CARD_ASPECT
  return { x: (frameWidth - w) / 2, y: (frameHeight - h) / 2, w, h }
}

/** Convert a card-relative region to absolute pixels within a frame. */
export function regionToFrameRect(
  region: NormRect,
  frameWidth: number,
  frameHeight: number
): { x: number; y: number; w: number; h: number } {
  const guide = cardGuideRect(frameWidth, frameHeight)
  return {
    x: guide.x + region.x * guide.w,
    y: guide.y + region.y * guide.h,
    w: region.w * guide.w,
    h: region.h * guide.h
  }
}
