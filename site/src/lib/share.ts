// Link-preview pictures (og:image) for the photography pages: 1200×630, the cover with
// the logo and the page's name, drawn by scripts/lib/share.mjs (the editor, Publish or
// `pnpm photos share`) and listed in src/data/share-images.json.
import data from '../data/share-images.json';
import { shareKey } from '../../scripts/lib/share-key.mjs';
import { PHOTOS_BASE } from './photos';

export interface ShareImage {
  url: string;
  width: number;
  height: number;
}

/** The photography index's entry. */
export const SHARE_INDEX = '_photography';

const entries = data as Record<string, { key: string; file: string }>;
const warned = new Set<string>();

/**
 * A page's picture, while it still shows the page's current name, cover and crop.
 * Otherwise undefined (the page falls back to its cover's plain og.jpg) until the
 * picture is drawn again.
 */
export function shareImage(page: string, what: { title: string; cover: string; position?: string }): ShareImage | undefined {
  const entry = entries[page];
  if (!entry || entry.key !== shareKey(what)) {
    if (!warned.has(page)) {
      warned.add(page);
      console.warn(`[share] ${page}: no up-to-date link-preview picture; run \`pnpm photos share\` (or Publish from the editor).`);
    }
    return undefined;
  }
  return { url: `${PHOTOS_BASE}/_share/${entry.file}`, width: 1200, height: 630 };
}
