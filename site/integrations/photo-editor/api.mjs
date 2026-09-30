// Dev-only API behind /dev/photos: reads album files + manifests and writes
// photo metadata back into src/content/albums/<album>.mdx (formatting and
// comments preserved, via the same helpers as `pnpm photos`).
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { ALBUM_DIR, readAlbum, readManifest, writeAlbum } from '../../scripts/lib/photos.mjs';

const SLUG = /^[a-z0-9-]+$/;
const photoName = (id) => id.replace(/-[0-9a-f]{8}$/, '');

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

export async function listAlbums() {
  const albums = [];
  for (const file of (await readdir(ALBUM_DIR)).filter((f) => f.endsWith('.mdx')).sort()) {
    const id = path.basename(file, '.mdx');
    const album = await readAlbum(id);
    const data = album.doc.toJS();
    const manifest = await readManifest(id);
    const photos = (data.photos ?? []).map((entry) => {
      const [, ref] = entry.src.split('/');
      const photoId = resolveId(manifest, ref) ?? ref;
      const meta = manifest[photoId] ?? {};
      return {
        src: entry.src,
        id: photoId,
        name: photoName(photoId),
        w: meta.w,
        h: meta.h,
        thumb: meta.widths?.[0],
        title: entry.title ?? '',
        description: entry.description ?? '',
        tags: entry.tags ?? [],
        alt: entry.alt ?? '',
        slug: entry.slug,
      };
    });
    slugsFor(photos).forEach((slug, i) => (photos[i].href = `/photography/${id}/${slug}`));
    const coverId = data.cover ? resolveId(manifest, data.cover.split('/')[1]) : undefined;
    albums.push({ id, title: data.title, draft: !!data.draft, coverId, photos: photos.map(({ slug, ...p }) => ({ ...p, slug: slug ?? '' })) });
  }
  return albums;
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

export async function updatePhoto({ album: albumId, src, fields }) {
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
}

export async function setCover({ album: albumId, src }) {
  const { album } = await findEntry(albumId, src);
  album.doc.set('cover', src);
  await writeAlbum(albumId, album);
}
