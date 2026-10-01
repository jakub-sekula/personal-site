// Shared photo pipeline: resize originals into AVIF/WebP variants, keep a
// per-album manifest of dimensions + blur placeholders, and edit album files.
//
// Layout on disk (mirrors the R2 bucket 1:1):
//   public/photos/<album>/<photoId>/<width>.<avif|webp>
//   public/photos/<album>/<photoId>/og.jpg      (link previews, at most OG_WIDTH wide)
// Manifest (committed):
//   src/data/photos/<album>.json  ->  { [photoId]: { w, h, widths, lqip, original } }
// Settings (committed, edited in the photo editor): photos.config.json

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = path.join(ROOT, 'public/photos');
export const MANIFEST_DIR = path.join(ROOT, 'src/data/photos');
export const ALBUM_DIR = path.join(ROOT, 'src/content/albums');

// --- Settings ------------------------------------------------------------------
// The widths every photo is resized to (each as AVIF and WebP; a photo narrower than
// the largest also gets one at its own width) and the encoding quality. Read on every
// use, so changes in the photo editor apply straight away.

export const CONFIG_FILE = path.join(ROOT, 'photos.config.json');
export const DEFAULT_CONFIG = { widths: [640, 1280, 1920, 2560], avifQuality: 55, webpQuality: 80 };
export const LIMITS = { width: [320, 8192], quality: [30, 100], count: 8 };

export function readConfig() {
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {}
  return { ...DEFAULT_CONFIG, ...saved };
}

/** Check and save new settings (sizes sorted and de-duplicated). */
export async function writeConfig(input) {
  const [minW, maxW] = LIMITS.width;
  const widths = [...new Set((input.widths ?? []).map(Number))].sort((a, b) => a - b);
  if (!widths.length) throw new Error('Keep at least one size');
  if (widths.length > LIMITS.count) throw new Error(`At most ${LIMITS.count} sizes`);
  if (widths.some((w) => !Number.isInteger(w) || w < minW || w > maxW)) throw new Error(`Sizes must be whole numbers from ${minW} to ${maxW}`);
  const quality = (q, name) => {
    const n = Number(q);
    if (!Number.isInteger(n) || n < LIMITS.quality[0] || n > LIMITS.quality[1]) throw new Error(`${name} quality must be ${LIMITS.quality[0]}–${LIMITS.quality[1]}`);
    return n;
  };
  const config = { widths, avifQuality: quality(input.avifQuality, 'AVIF'), webpQuality: quality(input.webpQuality, 'WebP') };
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  return config;
}

// Credit and copyright, written into every file (camera EXIF and GPS are still
// stripped): EXIF Artist/Copyright, plus the XMP fields Google Images shows as
// Creator, Copyright notice and Credit line. (EXIF text is ASCII-only, hence "(c)".)
// Photos processed before these were added had them written in place with exiftool.
export const CREDIT = {
  name: 'Jakub Sekula',
  notice: '© Jakub Sekula. All rights reserved.',
  website: 'https://jakubsekula.com',
};
const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"><dc:creator><rdf:Seq><rdf:li>${CREDIT.name}</rdf:li></rdf:Seq></dc:creator><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${CREDIT.notice}</rdf:li></rdf:Alt></dc:rights><photoshop:Credit>${CREDIT.name}</photoshop:Credit><xmpRights:Marked>True</xmpRights:Marked><xmpRights:WebStatement>${CREDIT.website}</xmpRights:WebStatement></rdf:Description></rdf:RDF></x:xmpmeta>`;
const credit = (img) =>
  img.withExif({ IFD0: { Artist: CREDIT.name, Copyright: CREDIT.notice.replace('©', '(c)') } }).withXmp(XMP);

/** Encoders for the served formats, at the configured quality. */
export function formats(config = readConfig()) {
  return {
    avif: (img) => credit(img).avif({ quality: config.avifQuality, effort: 4 }),
    webp: (img) => credit(img).webp({ quality: config.webpQuality }),
  };
}
export const IMAGE_EXT = /\.(jpe?g|png|webp|tiff?|avif|heic)$/i;

// Link previews (og:image) are JPEG: WebP/AVIF previews aren't reliable across apps.
// Must match OG_WIDTH in src/lib/photos.ts.
export const OG_WIDTH = 1200;
const encodeOg = (img) => credit(img).jpeg({ quality: 82, mozjpeg: true });

export function slugify(str) {
  return str
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The widths a photo `width` px wide gets: the configured ones below it, plus its own if it's smaller than the largest. */
export function variantWidths(width, sizes = readConfig().widths) {
  const widths = sizes.filter((w) => w < width);
  if (width <= sizes.at(-1) || widths.length === 0) widths.push(width);
  return widths;
}

export async function readManifest(album) {
  const file = path.join(MANIFEST_DIR, `${album}.json`);
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
}

export async function writeManifest(album, manifest) {
  await mkdir(MANIFEST_DIR, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path.join(MANIFEST_DIR, `${album}.json`), JSON.stringify(sorted, null, 2) + '\n');
}

/**
 * Process one original into all variants. Idempotent: the photo id includes a
 * content hash, so re-running on the same file skips work, and a re-exported
 * edit gets a new id (and new, immutable URLs). Re-running it on a photo made
 * before the sizes changed brings it up to the current ones (same id and URLs).
 *
 * Camera metadata (EXIF, GPS) is stripped from every variant; only the credit
 * and copyright above are written.
 *
 * `input` is a path, or { file, name } to name the photo after something other
 * than the file on disk (e.g. the original upload name).
 */
export async function processPhoto(input, album, manifest) {
  const { file, name = path.basename(file) } = typeof input === 'string' ? { file: input } : input;
  const buf = await readFile(file);
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 8);
  const id = `${slugify(path.parse(name).name)}-${hash}`;
  const dir = path.join(OUT_DIR, album, id);

  const config = readConfig();
  const existing = manifest[id];
  // An existing photo keeps its data but gets the currently configured sizes.
  let entry = existing && { ...existing, widths: variantWidths(existing.w, config.widths) };
  if (!entry) {
    const meta = await sharp(buf).metadata();
    const rotated = (meta.orientation ?? 1) >= 5;
    const w = rotated ? meta.height : meta.width;
    const tiny = await sharp(buf).rotate().resize({ width: 20 }).webp({ quality: 40 }).toBuffer();
    entry = {
      w,
      h: rotated ? meta.width : meta.height,
      widths: variantWidths(w, config.widths),
      lqip: `data:image/webp;base64,${tiny.toString('base64')}`,
      original: name,
    };
  }

  // Only encode what's missing on disk (e.g. a new output type added later).
  const outputs = [
    ...entry.widths.flatMap((width) =>
      Object.entries(formats(config)).map(([ext, encode]) => ({
        file: `${width}.${ext}`,
        make: () => encode(sharp(buf).rotate().resize({ width })),
      })),
    ),
    { file: 'og.jpg', make: () => encodeOg(sharp(buf).rotate().resize({ width: Math.min(OG_WIDTH, entry.w) })) },
  ];
  const missing = outputs.filter((o) => !existsSync(path.join(dir, o.file)));
  const sameSizes = existing && JSON.stringify(existing.widths) === JSON.stringify(entry.widths);
  if (sameSizes && missing.length === 0) return { id, meta: existing, skipped: true };

  await mkdir(dir, { recursive: true });
  await Promise.all(missing.map((o) => o.make().toFile(path.join(dir, o.file))));
  manifest[id] = entry;
  return { id, meta: entry, skipped: false };
}

/**
 * Create files that can be derived from a photo's existing variants, without
 * the original (currently the og.jpg link preview). Returns what was made.
 */
export async function deriveMissing(album, id, entry) {
  const dir = path.join(OUT_DIR, album, id);
  const og = path.join(dir, 'og.jpg');
  if (existsSync(og)) return [];
  const source = path.join(dir, `${entry.widths.at(-1)}.webp`);
  if (!existsSync(source)) throw new Error(`${album}/${id}: no ${path.basename(source)} to derive from`);
  await encodeOg(sharp(source).resize({ width: Math.min(OG_WIDTH, entry.w) })).toFile(og);
  return ['og.jpg'];
}

/** Process many files with a small concurrency limit (sharp is already multi-threaded). */
export async function processPhotos(files, album, { concurrency = 2, onProgress } = {}) {
  const manifest = await readManifest(album);
  const results = new Array(files.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < files.length) {
        const i = next++;
        results[i] = await processPhoto(files[i], album, manifest);
        onProgress?.(++done, files.length, results[i]);
      }
    }),
  );
  await writeManifest(album, manifest);
  return results;
}

// --- Album files -----------------------------------------------------------
// src/content/albums/<slug>.mdx: YAML frontmatter (edited here, comments and
// captions preserved) + an optional MDX body written by hand.

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export async function readAlbum(slug) {
  const file = path.join(ALBUM_DIR, `${slug}.mdx`);
  if (!existsSync(file)) return null;
  const [, fm, body] = (await readFile(file, 'utf8')).match(FRONTMATTER) ?? [];
  if (fm === undefined) throw new Error(`${file}: missing frontmatter`);
  return { doc: YAML.parseDocument(fm), body };
}

export async function writeAlbum(slug, { doc, body = '' }) {
  await mkdir(ALBUM_DIR, { recursive: true });
  const fm = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  await writeFile(path.join(ALBUM_DIR, `${slug}.mdx`), `---\n${fm}\n---\n${body ? `\n${body.trim()}\n` : ''}`);
}

export function newAlbumDoc(fields) {
  return new YAML.Document(fields);
}

/** List an album inside a parent album (e.g. a country inside Places), or in none (parent ''). */
export async function listInParent(album, parent) {
  if (parent && !(await readAlbum(parent))) throw new Error(`No album "${parent}"`);
  for (const file of (await readdir(ALBUM_DIR)).filter((f) => f.endsWith('.mdx'))) {
    const slug = path.basename(file, '.mdx');
    const other = await readAlbum(slug);
    const children = other.doc.get('albums');
    const listed = children?.items.findIndex((item) => String(item.value ?? item) === album) ?? -1;
    if (slug === parent && listed < 0) {
      if (!children) other.doc.set('albums', other.doc.createNode([album]));
      else children.add(album);
      await writeAlbum(slug, other);
    } else if (slug !== parent && listed >= 0) {
      children.items.splice(listed, 1);
      await writeAlbum(slug, other);
    }
  }
}

/** Append photos to an album, skipping any already listed. Returns how many were added. */
export function appendPhotos(doc, srcs) {
  if (!doc.has('photos')) doc.set('photos', doc.createNode([]));
  const list = doc.get('photos');
  const present = new Set(list.items.map((item) => item.get('src')));
  let added = 0;
  for (const src of srcs) {
    if (present.has(src)) continue;
    list.add(doc.createNode({ src }));
    present.add(src);
    added++;
  }
  return added;
}
