/**
 * How wide a photo (or anything else) sits in a story post: the text column,
 * wider than the text, or edge to edge. Outside story posts everything sits in
 * the text column. Keep the widths in sync with .story in global.css.
 */
export type StorySize = 'text' | 'wide' | 'full';

/** Maximum rendered width in px, for image `sizes`. */
export const STORY_WIDTHS: Record<StorySize, number> = { text: 672, wide: 1152, full: 1920 };

/** `sizes` for an image spanning the given width. */
export const storySizes = (size: StorySize) =>
  size === 'full' ? '100vw' : `(min-width: ${STORY_WIDTHS[size]}px) ${STORY_WIDTHS[size]}px, 100vw`;
