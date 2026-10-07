import { getCollection, getEntries, type CollectionEntry } from 'astro:content';
import { marked } from 'marked';
import { getPhoto, type Photo } from './photos';

// Drafts show up in `astro dev` so you can preview them, never in a build.
export const isVisible = ({ data }: { data: { draft: boolean } }) => import.meta.env.DEV || !data.draft;

export async function getPosts() {
  return (await getCollection('blog', isVisible)).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** Every visible project (hidden categories too: their pages still exist), in page order. */
export async function getProjects() {
  return (await getCollection('projects', isVisible)).sort((a, b) => a.data.order - b.data.order);
}

/** The project categories, in their order. */
export const getProjectCategories = () => getCollection('projectCategories');

/** The projects to list on the site: those in hidden categories are left out. */
export async function getListedProjects() {
  const hidden = new Set((await getProjectCategories()).filter((c) => c.data.hidden).map((c) => c.id));
  return (await getProjects()).filter((p) => !hidden.has(p.data.category.id));
}

/** Whether a project is listed (its category isn't hidden). */
export async function isListed(project: CollectionEntry<'projects'>) {
  return !(await getProjectCategories()).find((c) => c.id === project.data.category.id)?.data.hidden;
}

/** A project category's name, e.g. "Software". */
export async function categoryLabel(project: CollectionEntry<'projects'>) {
  return (await getProjectCategories()).find((c) => c.id === project.data.category.id)?.data.label ?? project.data.category.id;
}

// --- Albums ------------------------------------------------------------------

type Album = CollectionEntry<'albums'>;

/** Visible albums with something to show (a new, empty collection has nothing yet). */
export async function getAlbums() {
  const albums = await getCollection('albums', isVisible);
  const covers = await Promise.all(albums.map(albumCover));
  return albums.filter((_, i) => covers[i]);
}

/**
 * An album's cover photo: its own `cover`; for a collection without one, the
 * cover of its first album; otherwise its first photo. Undefined when empty.
 */
export async function albumCover(album: Album): Promise<string | undefined> {
  if (album.data.cover) return album.data.cover;
  for (const child of await getChildAlbums(album)) {
    const cover = child.data.cover ?? child.data.photos[0]?.src;
    if (cover) return cover;
  }
  return album.data.photos[0]?.src;
}

/** Albums paired with their cover, leaving out empty ones. */
export async function withCovers(albums: Album[]) {
  const covers = await Promise.all(albums.map(albumCover));
  return albums.flatMap((album, i) => (covers[i] ? [{ album, cover: covers[i] }] : []));
}

export async function getParentAlbum(album: Album) {
  return (await getAlbums()).find((a) => a.data.albums.some((r) => r.id === album.id));
}

/** Visible child albums of a grouping album, in the order it lists them. */
export async function getChildAlbums(album: Album) {
  return (await getEntries(album.data.albums)).filter(isVisible);
}

/**
 * Album title without its leading flag ("🇮🇸 Iceland" → "Iceland"), for page titles. Covers
 * country flags (two regional letters) and the England/Scotland/Wales ones (🏴 + tags).
 */
export const albumName = (album: Album) => album.data.title.replace(/^[\p{Extended_Pictographic}\p{Regional_Indicator}\u{E0020}-\u{E007F}\u{FE0F}\u{200D}\s]+/u, '');

// --- Photos ------------------------------------------------------------------
// A photo's files come from its manifest (src/lib/photos.ts); its title,
// description and tags from its entry in the album file. Every photo listed in
// an album gets a page at /photography/<album>/<slug>.

export interface AlbumPhoto {
  album: Album;
  /** Position in the album, from 0. */
  index: number;
  photo: Photo;
  slug: string;
  href: string;
  title?: string;
  /** Markdown source and rendered HTML. */
  description?: string;
  descriptionHtml?: string;
  tags: string[];
  alt: string;
  newSection: boolean;
}

export function albumPhotos(album: Album): AlbumPhoto[] {
  const entries = album.data.photos.map((entry) => ({ entry, photo: getPhoto(entry.src) }));
  // A photo's page is named after its file; the hash is only added if two files share a name.
  const nameCount = new Map<string, number>();
  entries.forEach(({ photo }) => nameCount.set(photo.name, (nameCount.get(photo.name) ?? 0) + 1));
  const taken = new Set<string>();

  return entries.map(({ entry, photo }, index) => {
    const slug = entry.slug ?? (nameCount.get(photo.name)! > 1 ? photo.id : photo.name);
    if (taken.has(slug)) {
      throw new Error(`Two photos in album "${album.id}" would both live at /photography/${album.id}/${slug}. Give one a \`slug\`.`);
    }
    taken.add(slug);
    return {
      album,
      index,
      photo,
      slug,
      href: `/photography/${album.id}/${slug}`,
      title: entry.title,
      description: entry.description,
      descriptionHtml: entry.description ? block(entry.description) : undefined,
      tags: entry.tags,
      alt: entry.alt ?? entry.title ?? albumName(album),
      newSection: !!entry.newSection,
    };
  });
}

/** Tab title for a photo's page: its title, or "<Album> <n>" if it has none. */
export const photoPageTitle = (p: AlbumPhoto) => `${p.title ?? `${albumName(p.album)} ${p.index + 1}`} - Jakub Sekula`;

/** Every photo in every visible album. */
export async function getAllPhotos() {
  return (await getAlbums()).flatMap(albumPhotos);
}

/** The album entry for a photo reference, if the photo is listed in an album. */
export async function findPhoto(src: string) {
  const canonical = getPhoto(src).src;
  return (await getAllPhotos()).find((p) => p.photo.src === canonical);
}

/** Every photo tag, with its photos. Kept separate from project/post tags. */
export async function getPhotoTags() {
  const tags = new Map<string, { name: string; photos: AlbumPhoto[] }>();
  for (const photo of await getAllPhotos()) {
    for (const name of photo.tags) {
      const slug = tagSlug(name);
      if (!tags.has(slug)) tags.set(slug, { name, photos: [] });
      tags.get(slug)!.photos.push(photo);
    }
  }
  return tags;
}

// --- Tags --------------------------------------------------------------------

export function tagSlug(tag: string) {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Every tag used by posts or projects, with what it's attached to. */
export async function getTags() {
  const [posts, projects] = await Promise.all([getPosts(), getListedProjects()]);
  const tags = new Map<string, { name: string; posts: typeof posts; projects: typeof projects }>();
  const entry = (name: string) => {
    const slug = tagSlug(name);
    if (!tags.has(slug)) tags.set(slug, { name, posts: [], projects: [] });
    return tags.get(slug)!;
  };
  posts.forEach((p) => p.data.tags.forEach((t) => entry(t).posts.push(p)));
  projects.forEach((p) => p.data.tags.forEach((t) => entry(t).projects.push(p)));
  return tags;
}

// --- Markdown ----------------------------------------------------------------

/** Render a short Markdown string (caption) to inline HTML. Content is our own. */
export function inline(md: string) {
  return marked.parseInline(md, { async: false });
}

/** Render Markdown (a few paragraphs) to HTML. Content is our own. */
export function block(md: string) {
  return marked.parse(md, { async: false });
}

/** Markdown as plain text, for meta descriptions. */
export function plainText(md: string) {
  return block(md)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e as string]!)
    .replace(/\s+/g, ' ')
    .trim();
}
