// What decides a link-preview picture (./share.mjs), shared with the site's pages
// (src/lib/share.ts): a page uses its picture only while the key still matches.
import { createHash } from 'node:crypto';

// Raise to draw every picture again after changing the design.
export const SHARE_VERSION = 1;

/** A page's name as drawn: without its leading flag or other emoji (the fonts have none). */
export const shareName = (title) =>
  String(title ?? '')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{E0020}-\u{E007F}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The key of a page's picture: its name, cover photo and crop.
 * @param {{ title: string, cover: string, position?: string }} page
 */
export const shareKey = ({ title, cover, position }) =>
  createHash('sha256').update(JSON.stringify([SHARE_VERSION, shareName(title), cover, position ?? ''])).digest('hex').slice(0, 12);
