// Link-preview pictures (og:image) for the photography pages: 1200×630 JPEGs with the
// album's cover, the site's logo at the top and the album's name at the bottom.
//
//   public/photos/_share/<page>-<hash>.jpg   (uploaded to R2 with the photos)
//   src/data/share-images.json               (which file each page uses, and its key)
//
// Everything that matters sits in the middle 630×630 square, which is what WhatsApp
// and Signal keep for their small square thumbnails, and each file stays under 300 KB
// (WhatsApp skips heavier ones). The hash in the name changes with the picture, so
// link previews and caches never keep showing an old one.
//
// Drawn here, where the photo files are, not in the site's build (Cloudflare's build
// has no photos): by the editor when an album changes, by Publish for anything out of
// date, or with `pnpm photos share`. The pages use a picture only while its key still
// matches their title and cover; otherwise they fall back to the cover's plain og.jpg.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import YAML from 'yaml';
import { ALBUM_DIR, OUT_DIR, ROOT, readManifest } from './photos.mjs';
import { shareKey, shareName } from './share-key.mjs';

export { shareKey, shareName };
export const SHARE_W = 1200;
export const SHARE_H = 630;
export const SHARE_DIR = path.join(OUT_DIR, '_share');
export const SHARE_DATA = path.join(ROOT, 'src/data/share-images.json');
/** The photography index's entry in SHARE_DATA (album ids are a–z, 0–9 and hyphens). */
export const INDEX_PAGE = '_photography';

const TEXT_W = 560; // the title stays inside the middle square
const MAX_BYTES = 300_000;
const ADDRESS = 'jakubsekula.com';
const FONTS = path.join(ROOT, 'scripts/fonts');
const INTER = path.join(FONTS, 'Inter.ttf');
const MONO = path.join(FONTS, 'SourceCodePro.ttf');
const COLORS = { yellow: '#fed557', blue: '#59b8df' };

// Text is drawn by Pango, through fontconfig: point it at just our fonts (read when the
// first text is drawn), instead of a scan of every font installed (~30 s the first time).
process.env.FONTCONFIG_FILE ??= path.join(FONTS, 'fonts.conf');

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text as an RGBA image (Pango markup). */
const textImage = (markup, { fontfile, font, width, align = 'centre', spacing = 0 }) =>
  sharp({ text: { text: markup, fontfile, font, width, align, rgba: true, dpi: 72, spacing, wrap: 'word' } }).png().toBuffer({ resolveWithObject: true });

/** How wide a line of the title is at a size. */
async function measure(line, size) {
  const { info } = await textImage(escape(line), { fontfile: INTER, font: `Inter Bold ${size}` });
  return info.width;
}

/**
 * The title's size and lines: as large as fits in at most two lines (three when it
 * must), with the lines balanced rather than one long and one short.
 */
async function fitTitle(title) {
  const words = title.split(' ').filter(Boolean);
  const wrap = async (size, limit) => {
    const lines = [];
    for (const word of words) {
      const last = lines.length - 1;
      if (last >= 0 && (await measure(`${lines[last]} ${word}`, size)) <= limit) lines[last] += ` ${word}`;
      else lines.push(word);
    }
    return lines;
  };
  for (const size of [68, 60, 54, 48, 42, 38]) {
    const lines = await wrap(size, TEXT_W);
    const widest = Math.max(...(await Promise.all(lines.map((l) => measure(l, size)))));
    if (widest > TEXT_W || lines.length > (size >= 54 ? 2 : 3)) continue;
    // Balanced: the narrowest width that needs no more lines.
    if (lines.length > 1) {
      let low = 0;
      let high = TEXT_W;
      for (const w of words) low = Math.max(low, await measure(w, size));
      while (high - low > 4) {
        const mid = Math.floor((low + high) / 2);
        if ((await wrap(size, mid)).length <= lines.length) high = mid;
        else low = mid;
      }
      return { size, lines: await wrap(size, high) };
    }
    return { size, lines };
  }
  return { size: 38, lines: (await wrap(38, TEXT_W)).slice(0, 3) };
}

/** A vertical black gradient, as an SVG overlay: from `from` opacity at the top to `to` at the bottom. */
const shade = (height, from, to) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_W}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#000" stop-opacity="${from}"/><stop offset="1" stop-color="#000" stop-opacity="${to}"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/></svg>`,
  );

/** A soft black shadow of an RGBA text image. */
async function shadow(png, blur, opacity) {
  return sharp(png)
    .ensureAlpha()
    .linear([0, 0, 0, opacity], [0, 0, 0, 0])
    .extend({ top: blur * 3, bottom: blur * 3, left: blur * 3, right: blur * 3, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(blur)
    .png()
    .toBuffer();
}

/** "50% 30%" (CSS object-position) as fractions; without one, portraits keep their upper part. */
function focus(position, portrait) {
  const [x = 50, y = portrait ? 20 : 50] = String(position ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => ({ left: 0, top: 0, center: 50, right: 100, bottom: 100 })[p] ?? parseFloat(p));
  return { x: Math.min(1, Math.max(0, x / 100)), y: Math.min(1, Math.max(0, y / 100)) };
}

/**
 * Draw a picture: `source` is a photo file, `title` the page's name.
 * @returns {Promise<Buffer>} JPEG
 */
export async function drawShareImage({ source, title, position }) {
  const meta = await sharp(source).metadata();
  const w = meta.autoOrient?.width ?? meta.width;
  const h = meta.autoOrient?.height ?? meta.height;
  const scale = Math.max(SHARE_W / w, SHARE_H / h);
  const sw = Math.ceil(w * scale);
  const sh = Math.ceil(h * scale);
  const f = focus(position, h > w);
  const photo = await sharp(source)
    .rotate()
    .resize(sw, sh)
    .extract({ left: Math.round((sw - SHARE_W) * f.x), top: Math.round((sh - SHARE_H) * f.y), width: SHARE_W, height: SHARE_H })
    .toBuffer();

  // The logo, as in the site's header: jakubsekula@personal:~$
  const logo = await textImage(
    `<span foreground="${COLORS.yellow}">jakubsekula<span foreground="${COLORS.blue}">@personal</span>:</span><span foreground="#ffffff">~</span><span foreground="${COLORS.blue}">$</span>`,
    { fontfile: MONO, font: 'Source Code Pro Bold 30' },
  );
  const fit = await fitTitle(shareName(title) || 'Photography');
  const titleImg = await textImage(fit.lines.map(escape).join('\n'), { fontfile: INTER, font: `Inter Bold ${fit.size}`, spacing: Math.round(fit.size * 0.12) });
  const white = await sharp(titleImg.data).linear([0, 0, 0, 1], [255, 255, 255, 0]).png().toBuffer();
  const address = await textImage(`<span foreground="#d9d9d9">${ADDRESS}</span>`, { fontfile: INTER, font: 'Inter Medium 24' });

  const addressTop = SHARE_H - 52 - address.info.height;
  const titleTop = addressTop - 18 - titleImg.info.height;
  const logoTop = 44;
  const center = (width) => Math.round((SHARE_W - width) / 2);
  const bottomShade = SHARE_H - titleTop + 150;

  const layers = [
    { input: shade(220, 0.45, 0), top: 0, left: 0 },
    { input: shade(Math.min(SHARE_H, bottomShade), 0, 0.78), top: SHARE_H - Math.min(SHARE_H, bottomShade), left: 0 },
    { input: await shadow(logo.data, 6, 0.6), top: logoTop - 18, left: center(logo.info.width) - 18 },
    { input: logo.data, top: logoTop, left: center(logo.info.width) },
    { input: await shadow(titleImg.data, 8, 0.55), top: titleTop - 24, left: center(titleImg.info.width) - 24 },
    { input: white, top: titleTop, left: center(titleImg.info.width) },
    { input: address.data, top: addressTop, left: center(address.info.width) },
  ];
  const image = sharp(photo).composite(layers).flatten({ background: '#000' });
  const flat = await image.toBuffer();
  for (const quality of [82, 76, 70, 64, 58, 50]) {
    const jpeg = await sharp(flat).jpeg({ quality, mozjpeg: true, progressive: true }).toBuffer();
    if (jpeg.length <= MAX_BYTES || quality === 50) return jpeg;
  }
}

// --- Which pages get one, and keeping them up to date --------------------------------

/** A photo reference ("album/id") as the largest local file of at most 1920px, or its og.jpg. */
async function photoFile(ref) {
  const [album, id] = ref.split('/');
  const entry = (await readManifest(album))[id];
  if (!entry) return null;
  const dir = path.join(OUT_DIR, album, id);
  const widths = [...(entry.widths ?? [])].sort((a, b) => a - b);
  const width = widths.find((x) => x >= 1920) ?? widths.at(-1);
  for (const file of [width && `${width}.webp`, 'og.jpg']) if (file && existsSync(path.join(dir, file))) return path.join(dir, file);
  return null;
}

async function readAlbums() {
  const albums = {};
  for (const f of await readdir(ALBUM_DIR)) {
    if (!f.endsWith('.mdx')) continue;
    const text = await readFile(path.join(ALBUM_DIR, f), 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
    albums[f.replace(/\.mdx$/, '')] = YAML.parse(fm ?? '') ?? {};
  }
  return albums;
}

/**
 * An album's cover as the built site picks it (src/lib/content.ts albumCover): its own;
 * for a collection, its first published album's cover or first photo; its first photo.
 */
function coverOf(id, albums) {
  const a = albums[id];
  if (!a) return null;
  if (a.cover) return a.cover;
  for (const child of a.albums ?? []) {
    const c = albums[child];
    if (!c || c.draft) continue;
    const cover = c.cover ?? c.photos?.[0]?.src;
    if (cover) return cover;
  }
  return a.photos?.[0]?.src ?? null;
}

/**
 * What each picture shows: every album (and collection) with a cover, plus the
 * photography index (the first album on it, "Photography").
 */
export async function sharePages() {
  const albums = await readAlbums();
  const pages = Object.entries(albums)
    .map(([id, a]) => ({ page: id, title: a.title ?? id, cover: coverOf(id, albums), position: a.coverPosition ?? '' }))
    .filter((p) => p.cover);
  const photography = YAML.parse(await readFile(path.join(ROOT, 'src/content/photography.yaml'), 'utf8'))?.[0] ?? {};
  const first = (photography.index ?? []).map((id) => ({ id, cover: coverOf(id, albums) })).find((a) => a.cover);
  if (first) pages.push({ page: INDEX_PAGE, title: 'Photography', cover: first.cover, position: albums[first.id]?.coverPosition ?? '' });
  return pages;
}

export async function readShareData() {
  try {
    return JSON.parse(await readFile(SHARE_DATA, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Draw the missing and out-of-date pictures (all of them with `force`, or only `only`),
 * delete the ones no page uses any more, and update SHARE_DATA.
 * @returns {Promise<{ drawn: string[], removed: string[] }>}
 */
export async function updateShareImages({ only, force = false, onProgress } = {}) {
  const data = await readShareData();
  const pages = await sharePages();
  const wanted = pages.filter((p) => !only || only.includes(p.page));
  const drawn = [];
  await mkdir(SHARE_DIR, { recursive: true });
  for (const [i, p] of wanted.entries()) {
    const key = shareKey(p);
    const file = `${p.page}-${key}.jpg`;
    onProgress?.(i + 1, wanted.length, p.page);
    if (!force && data[p.page]?.key === key && existsSync(path.join(SHARE_DIR, file))) continue;
    const source = await photoFile(p.cover);
    if (!source) continue;
    await writeFile(path.join(SHARE_DIR, file), await drawShareImage({ source, title: p.title, position: p.position }));
    data[p.page] = { key, file };
    drawn.push(p.page);
  }
  // Pages that are gone, and old pictures.
  const live = new Set(pages.map((p) => p.page));
  for (const page of Object.keys(data)) if (!live.has(page)) delete data[page];
  const keep = new Set(Object.values(data).map((d) => d.file));
  const removed = [];
  for (const f of await readdir(SHARE_DIR)) {
    if (f.endsWith('.jpg') && !keep.has(f)) {
      await rm(path.join(SHARE_DIR, f));
      removed.push(f);
    }
  }
  const sorted = Object.fromEntries(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
  const text = `${JSON.stringify(sorted, null, 2)}\n`;
  if (text !== (await readFile(SHARE_DATA, 'utf8').catch(() => ''))) await writeFile(SHARE_DATA, text);
  return { drawn, removed };
}

