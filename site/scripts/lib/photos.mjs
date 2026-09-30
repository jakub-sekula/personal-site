// Shared photo pipeline: resize originals into AVIF/WebP variants, keep a
// per-album manifest of dimensions + blur placeholders, and edit album files.
//
// Layout on disk (mirrors the R2 bucket 1:1):
//   public/photos/<album>/<photoId>/<width>.<avif|webp>
//   public/photos/<album>/<photoId>/og.jpg      (link previews, at most OG_WIDTH wide)
// Manifest (committed):
//   src/data/photos/<album>.json  ->  { [photoId]: { w, h, widths, lqip, original } }

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = path.join(ROOT, 'public/photos');
export const MANIFEST_DIR = path.join(ROOT, 'src/data/photos');
export const ALBUM_DIR = path.join(ROOT, 'src/content/albums');

export const WIDTHS = [640, 1280, 1920, 2560];
export const FORMATS = {
  avif: (img) => img.avif({ quality: 55, effort: 4 }),
  webp: (img) => img.webp({ quality: 80 }),
};
export const IMAGE_EXT = /\.(jpe?g|png|webp|tiff?|avif|heic)$/i;

// Link previews (og:image) are JPEG: WebP/AVIF previews aren't reliable across apps.
// Must match OG_WIDTH in src/lib/photos.ts.
export const OG_WIDTH = 1200;
const encodeOg = (img) => img.jpeg({ quality: 82, mozjpeg: true });

export function slugify(str) {
  return str
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function variantWidths(width) {
  const widths = WIDTHS.filter((w) => w < width);
  if (width <= WIDTHS.at(-1) || widths.length === 0) widths.push(width);
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
 * edit gets a new id (and new, immutable URLs).
 *
 * Metadata (EXIF, GPS) is stripped from every variant.
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

  const existing = manifest[id];
  let entry = existing;
  if (!entry) {
    const meta = await sharp(buf).metadata();
    const rotated = (meta.orientation ?? 1) >= 5;
    const w = rotated ? meta.height : meta.width;
    const tiny = await sharp(buf).rotate().resize({ width: 20 }).webp({ quality: 40 }).toBuffer();
    entry = {
      w,
      h: rotated ? meta.width : meta.height,
      widths: variantWidths(w),
      lqip: `data:image/webp;base64,${tiny.toString('base64')}`,
      original: name,
    };
  }

  // Only encode what's missing on disk (e.g. a new output type added later).
  const outputs = [
    ...entry.widths.flatMap((width) =>
      Object.entries(FORMATS).map(([ext, encode]) => ({
        file: `${width}.${ext}`,
        make: () => encode(sharp(buf).rotate().resize({ width })),
      })),
    ),
    { file: 'og.jpg', make: () => encodeOg(sharp(buf).rotate().resize({ width: Math.min(OG_WIDTH, entry.w) })) },
  ];
  const missing = outputs.filter((o) => !existsSync(path.join(dir, o.file)));
  if (existing && missing.length === 0) return { id, meta: existing, skipped: true };

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
  const fm = doc.toString({ lineWidth: 0 }).trimEnd();
  await writeFile(path.join(ALBUM_DIR, `${slug}.mdx`), `---\n${fm}\n---\n${body ? `\n${body.trim()}\n` : ''}`);
}

export function newAlbumDoc(fields) {
  return new YAML.Document(fields);
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
