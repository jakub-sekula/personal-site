// Dev-only API behind /dev/photos: reads album files + manifests and writes
// back into src/content/albums/<album>.mdx and src/content/photography.yaml
// (formatting and comments preserved, via the same helpers as `pnpm photos`).
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import YAML from 'yaml';
import {
  ALBUM_DIR,
  DEFAULT_CONFIG,
  IMAGE_EXT,
  LIMITS,
  OUT_DIR,
  ROOT,
  appendPhotos,
  listInParent,
  newAlbumDoc,
  processPhoto,
  readAlbum,
  readConfig,
  readManifest,
  slugify,
  variantWidths,
  writeAlbum,
  writeConfig,
  writeManifest,
} from '../../scripts/lib/photos.mjs';
import { syncPhotos } from '../../scripts/lib/sync.mjs';

const SLUG = /^[a-z0-9-]+$/;
const photoName = (id) => id.replace(/-[0-9a-f]{8}$/, '');
const MAX_UPLOAD = 300 * 1024 * 1024;

// Album files and manifests are read-modify-written; one change at a time.
let queue = Promise.resolve();
const exclusive = (fn) => (queue = queue.then(fn, fn));

/** Resolve "<album>/<id or short name>" against the manifest; mirrors src/lib/photos.ts. */
function resolveId(manifest, ref) {
  if (manifest[ref]) return ref;
  const matches = Object.keys(manifest).filter((key) => photoName(key) === ref);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Page slugs for an album's photos; mirrors albumPhotos() in src/lib/content.ts. */
function slugsFor(photos) {
  const count = new Map();
  photos.forEach((p) => count.set(p.name, (count.get(p.name) ?? 0) + 1));
  return photos.map((p) => p.slug ?? (count.get(p.name) > 1 ? p.id : p.name));
}

// --- The photography page's lists (src/content/photography.yaml) -------------

const PHOTOGRAPHY = path.join(ROOT, 'src/content/photography.yaml');

async function readPhotography() {
  const doc = YAML.parseDocument(await readFile(PHOTOGRAPHY, 'utf8'));
  return { doc, entry: doc.contents.items[0] };
}
const listed = (entry, key, album) => entry.get(key)?.items.some((i) => String(i.value ?? i) === album) ?? false;

/** Show or hide an album in the photography sidebar and on the photography page. */
async function setTopLevel(album, show) {
  const { doc, entry } = await readPhotography();
  let changed = false;
  for (const key of ['sidebar', 'index']) {
    const list = entry.get(key);
    const at = list.items.findIndex((i) => String(i.value ?? i) === album);
    if (show && at < 0) list.add(album);
    else if (!show && at >= 0) list.items.splice(at, 1);
    else continue;
    changed = true;
  }
  if (changed) await writeFile(PHOTOGRAPHY, doc.toString({ lineWidth: 0, flowCollectionPadding: false }));
}

// --- Reading -------------------------------------------------------------------

export async function listAlbums() {
  const files = (await readdir(ALBUM_DIR)).filter((f) => f.endsWith('.mdx')).sort();
  const raw = await Promise.all(files.map(async (f) => [path.basename(f, '.mdx'), await readAlbum(path.basename(f, '.mdx'))]));
  const parentOf = new Map();
  for (const [id, album] of raw) for (const child of album.doc.toJS().albums ?? []) parentOf.set(child, id);
  const { entry } = await readPhotography();

  const sizes = readConfig().widths;
  const albums = [];
  for (const [id, album] of raw) {
    const data = album.doc.toJS();
    const manifest = await readManifest(id);
    const photos = (data.photos ?? []).map((item) => {
      const [, ref] = item.src.split('/');
      const photoId = resolveId(manifest, ref) ?? ref;
      const meta = manifest[photoId] ?? {};
      return {
        src: item.src,
        id: photoId,
        name: photoName(photoId),
        w: meta.w,
        h: meta.h,
        thumb: meta.widths?.[0],
        widths: meta.widths ?? [],
        original: meta.original ?? '',
        // Made before the sizes changed: re-adding its original brings it up to date.
        outdated: !!meta.w && JSON.stringify(meta.widths) !== JSON.stringify(variantWidths(meta.w, sizes)),
        title: item.title ?? '',
        description: item.description ?? '',
        tags: item.tags ?? [],
        alt: item.alt ?? '',
        slug: item.slug,
      };
    });
    slugsFor(photos).forEach((slug, i) => (photos[i].href = `/photography/${id}/${slug}`));
    const coverId = data.cover ? resolveId(manifest, data.cover.split('/')[1]) : undefined;
    // The cover as a thumbnail: it can come from another album's files (collections).
    let coverThumb = null;
    if (data.cover) {
      const [coverAlbum, ref] = data.cover.split('/');
      const coverManifest = coverAlbum === id ? manifest : await readManifest(coverAlbum);
      const coverPhotoId = resolveId(coverManifest, ref);
      if (coverPhotoId) coverThumb = { album: coverAlbum, id: coverPhotoId, thumb: coverManifest[coverPhotoId].widths?.[0] };
    }
    albums.push({
      id,
      title: data.title,
      description: data.description ?? '',
      date: data.date instanceof Date ? data.date.toISOString().slice(0, 10) : String(data.date ?? ''),
      draft: !!data.draft,
      hero: data.hero ?? 'full',
      coverPosition: data.coverPosition ?? '',
      hasLayout: !!album.body?.trim(),
      // A collection groups albums (its file has an `albums` list, even an empty one).
      isCollection: album.doc.has('albums'),
      children: data.albums ?? [],
      cover: data.cover ?? '',
      coverThumb,
      parent: parentOf.get(id) ?? '',
      topLevel: listed(entry, 'sidebar', id) || listed(entry, 'index', id),
      coverId,
      photos: photos.map(({ slug, ...p }) => ({ ...p, slug: slug ?? '' })),
    });
  }
  return albums;
}

// --- Photos ----------------------------------------------------------------------

/** A photo's generated files (public/photos/<album>/<id>/) with their sizes in bytes. */
export async function photoFiles({ album, id }) {
  if (!SLUG.test(album ?? '') || !/^[a-z0-9-]+$/.test(id ?? '')) throw new Error('Bad photo');
  const dir = path.join(OUT_DIR, album, id);
  const names = await readdir(dir).catch(() => []);
  const files = await Promise.all(names.map(async (file) => ({ file, bytes: (await stat(path.join(dir, file))).size })));
  return { files: files.sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true })) };
}

/** Find a photo's entry in an album file by src (full id or short name). */
async function findEntry(albumId, src) {
  if (!SLUG.test(albumId)) throw new Error(`Bad album "${albumId}"`);
  const album = await readAlbum(albumId);
  if (!album) throw new Error(`No album "${albumId}"`);
  const manifest = await readManifest(albumId);
  const target = resolveId(manifest, src.split('/')[1]);
  const item = album.doc.get('photos')?.items.find((i) => resolveId(manifest, String(i.get('src')).split('/')[1]) === target);
  if (!target || !item) throw new Error(`No photo "${src}" in album "${albumId}"`);
  return { album, item, manifest };
}

export const updatePhoto = ({ album: albumId, src, fields }) =>
  exclusive(async () => {
    const { album, item, manifest } = await findEntry(albumId, src);
    const clean = {
      title: String(fields.title ?? '').trim(),
      description: String(fields.description ?? '').trim(),
      tags: [...new Set((fields.tags ?? []).map((t) => String(t).trim()).filter(Boolean))],
      alt: String(fields.alt ?? '').trim(),
      slug: String(fields.slug ?? '').trim(),
    };
    if (clean.slug && !SLUG.test(clean.slug)) throw new Error('Address can only use a–z, 0–9 and hyphens');
    if (clean.slug) {
      // The page address must stay unique within the album.
      const others = album.doc.get('photos').items.filter((i) => i !== item);
      const taken = others.map((i) => i.get('slug') ?? photoName(resolveId(manifest, String(i.get('src')).split('/')[1]) ?? ''));
      if (taken.includes(clean.slug)) throw new Error(`Another photo in this album already uses "${clean.slug}"`);
    }

    for (const [key, value] of Object.entries(clean)) {
      const empty = Array.isArray(value) ? value.length === 0 : value === '';
      if (empty) {
        item.delete(key);
      } else {
        const node = album.doc.createNode(value);
        if (Array.isArray(value)) node.flow = true;
        item.set(key, node);
      }
    }
    await writeAlbum(albumId, album);
    return clean;
  });

export const setCover = ({ album: albumId, src }) =>
  exclusive(async () => {
    const { album } = await findEntry(albumId, src);
    album.doc.set('cover', src);
    await writeAlbum(albumId, album);
  });

/** Put an album's photos in the given order (every photo, by src). */
export const reorderPhotos = ({ album: albumId, srcs }) =>
  exclusive(async () => {
    const { album, manifest } = await findEntry(albumId, srcs[0] ?? `${albumId}/-`);
    const list = album.doc.get('photos');
    const key = (src) => resolveId(manifest, String(src).split('/')[1]);
    const byId = new Map(list.items.map((item) => [key(item.get('src')), item]));
    const order = srcs.map(key);
    if (order.length !== byId.size || order.some((id) => !byId.has(id))) throw new Error('The album changed; reload the page');
    list.items = order.map((id) => byId.get(id));
    await writeAlbum(albumId, album);
  });

/** Take a photo out of an album (its files stay, locally and in R2). */
export const removePhoto = ({ album: albumId, src }) =>
  exclusive(async () => {
    const { album, item, manifest } = await findEntry(albumId, src);
    const list = album.doc.get('photos');
    if (list.items.length === 1) throw new Error("An album needs at least one photo");
    list.items.splice(list.items.indexOf(item), 1);
    // The cover can't point at a photo that's no longer in the album.
    const removed = resolveId(manifest, src.split('/')[1]);
    if (resolveId(manifest, String(album.doc.get('cover')).split('/')[1]) === removed) {
      album.doc.set('cover', String(list.items[0].get('src')));
    }
    await writeAlbum(albumId, album);
  });

/**
 * Add one uploaded image (the request body) to an album, creating the album if
 * it doesn't exist yet (titled `title`, cover = this photo). Same pipeline as
 * `pnpm photos add`.
 */
export async function uploadPhoto(req, { album: albumArg, name, title, cover }) {
  const albumId = slugify(albumArg ?? '');
  if (!albumId) throw new Error('Pick an album');
  // `cover=1`: an image just for the album's cover: processed like any photo (sizes,
  // credit, R2), but not added to the album's photos.
  const coverOnly = cover === '1';
  if (coverOnly && !(await readAlbum(albumId))) throw new Error(`No album "${albumId}"`);
  if (!name || !IMAGE_EXT.test(name)) throw new Error(`${name || 'File'}: not a supported image (JPEG, PNG, WebP, TIFF, AVIF, HEIC)`);
  if (Number(req.headers['content-length']) > MAX_UPLOAD) throw new Error(`${name}: larger than 300 MB`);

  const dir = path.join(os.tmpdir(), 'photo-editor', randomUUID());
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, path.basename(name));
  try {
    await pipeline(req, createWriteStream(file));
    // Encode outside the lock (it's the slow part), then record it.
    const { id, meta } = await processPhoto(file, albumId, {});
    return await exclusive(async () => {
      const manifest = await readManifest(albumId);
      // A photo added again (same file) is brought up to the current sizes.
      const upgraded = !!manifest[id] && JSON.stringify(manifest[id].widths) !== JSON.stringify(meta.widths);
      manifest[id] = { ...manifest[id], ...meta };
      await writeManifest(albumId, manifest);

      const src = `${albumId}/${id}`;
      const existing = await readAlbum(albumId);
      const albumFile = existing ?? {
        doc: newAlbumDoc({ title: title?.trim() || albumArg, cover: src, date: new Date().toISOString().slice(0, 10), photos: [] }),
        body: '',
      };
      const added = !coverOnly && appendPhotos(albumFile.doc, [src]) > 0;
      if (coverOnly) albumFile.doc.set('cover', src);
      await writeAlbum(albumId, albumFile);
      return { album: albumId, created: !existing, src, added, upgraded };
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// --- Albums ------------------------------------------------------------------------

/**
 * Album settings: title, description, date, draft, header style, cover crop,
 * and where it's listed (`parent` album, or `topLevel`: the photography sidebar
 * and page).
 */
export const updateAlbum = ({ album: albumId, fields }) =>
  exclusive(async () => {
    if (!SLUG.test(albumId ?? '')) throw new Error(`Bad album "${albumId}"`);
    const album = await readAlbum(albumId);
    if (!album) throw new Error(`No album "${albumId}"`);
    const { doc } = album;

    const title = String(fields.title ?? '').trim();
    if (!title) throw new Error('An album needs a title');
    doc.set('title', title);
    const date = String(fields.date ?? '').trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date should look like 2024-01-31');
    // Optional fields: set, or remove when empty/default (keeps the files tidy).
    const optional = {
      description: String(fields.description ?? '').trim(),
      date,
      hero: fields.hero === 'banner' ? 'banner' : '',
      coverPosition: String(fields.coverPosition ?? '').trim(),
      draft: fields.draft ? true : '',
    };
    for (const [key, value] of Object.entries(optional)) {
      if (value === '') {
        if (key !== 'date') doc.delete(key);
      } else {
        doc.set(key, value);
      }
    }
    // The cover: any photo in the library ("album/photo", e.g. one uploaded just for the
    // cover), or none: the album's first photo (a collection's first album's cover).
    if ('cover' in fields) {
      const cover = String(fields.cover ?? '').trim();
      if (!cover) doc.delete('cover');
      else if (cover !== doc.get('cover')) {
        const [coverAlbum, ref] = cover.split('/');
        if (!SLUG.test(coverAlbum ?? '') || !ref || !resolveId(await readManifest(coverAlbum), ref)) throw new Error(`No photo "${cover}" for the cover`);
        doc.set('cover', cover);
      }
    }
    await writeAlbum(albumId, album);

    const parent = String(fields.parent ?? '');
    if (parent) {
      // One level: albums go in collections, collections don't go in anything.
      if (parent === albumId) throw new Error("An album can't be inside itself");
      if (doc.has('albums')) throw new Error("A collection can't be inside another collection");
      if (!(await readAlbum(parent))?.doc.has('albums')) throw new Error(`"${parent}" isn't a collection`);
    }
    await listInParent(albumId, parent);
    await setTopLevel(albumId, !parent && !!fields.topLevel);
  });

// --- Collections ------------------------------------------------------------------

/** A new, empty collection (add albums to it afterwards). */
export const createCollection = ({ album: albumId, fields }) =>
  exclusive(async () => {
    if (!SLUG.test(albumId ?? '')) throw new Error('The address can only use a–z, 0–9 and hyphens');
    if (await readAlbum(albumId)) throw new Error(`There's already an album at /photography/${albumId}`);
    const title = String(fields.title ?? '').trim();
    if (!title) throw new Error('A collection needs a title');
    const description = String(fields.description ?? '').trim();
    const doc = newAlbumDoc({
      title,
      ...(description && { description }),
      date: new Date().toISOString().slice(0, 10),
      ...(fields.draft && { draft: true }),
      albums: [],
      photos: [],
    });
    await writeAlbum(albumId, { doc, body: '' });
    await setTopLevel(albumId, !!fields.topLevel);
  });

/**
 * Set which albums a collection groups, in order. Albums added here leave any other
 * collection and the top-level lists; albums taken out end up not listed.
 */
export const setCollectionAlbums = ({ album: albumId, children }) =>
  exclusive(async () => {
    const album = await readAlbum(albumId);
    if (!album?.doc.has('albums')) throw new Error(`"${albumId}" isn't a collection`);
    const ids = [...new Set(children.map(String))];
    for (const id of ids) {
      if (id === albumId) throw new Error("A collection can't contain itself");
      const child = await readAlbum(id);
      if (!child) throw new Error(`No album "${id}"`);
      if (child.doc.has('albums')) throw new Error(`"${id}" is a collection: collections can't be nested`);
    }
    for (const id of ids) {
      await listInParent(id, albumId);
      await setTopLevel(id, false);
    }
    // Now set the exact list and order (listInParent only appends).
    const fresh = await readAlbum(albumId);
    fresh.doc.set('albums', fresh.doc.createNode(ids));
    await writeAlbum(albumId, fresh);
  });

/** Delete a collection's file; its albums stay (not listed until you list them again). */
export const deleteCollection = ({ album: albumId }) =>
  exclusive(async () => {
    const album = await readAlbum(albumId);
    if (!album?.doc.has('albums')) throw new Error(`"${albumId}" isn't a collection`);
    if (album.doc.get('photos')?.items.length) throw new Error('This collection also has photos of its own; remove them first');
    await setTopLevel(albumId, false);
    await rm(path.join(ALBUM_DIR, `${albumId}.mdx`));
  });

// --- Settings ---------------------------------------------------------------------

/** The photo settings, and how many existing photos aren't at the current sizes (per album). */
export async function getSettings() {
  const config = readConfig();
  const outdated = {};
  let photos = 0;
  for (const file of (await readdir(ALBUM_DIR)).filter((f) => f.endsWith('.mdx'))) {
    const id = path.basename(file, '.mdx');
    for (const meta of Object.values(await readManifest(id))) {
      photos++;
      if (meta.w && JSON.stringify(meta.widths) !== JSON.stringify(variantWidths(meta.w, config.widths))) outdated[id] = (outdated[id] ?? 0) + 1;
    }
  }
  return { config, defaults: DEFAULT_CONFIG, limits: LIMITS, photos, outdated };
}

export const saveSettings = async (input) => {
  await writeConfig(input);
  return getSettings();
};

// --- R2 -----------------------------------------------------------------------------

export const syncStatus = () => syncPhotos({ dryRun: true });
export const syncNow = () => syncPhotos();

