import { getCollection, getEntries, type CollectionEntry } from 'astro:content';
import { marked } from 'marked';

// Drafts show up in `astro dev` so you can preview them, never in a build.
export const isVisible = ({ data }: { data: { draft: boolean } }) => import.meta.env.DEV || !data.draft;

export async function getPosts() {
  return (await getCollection('blog', isVisible)).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** In the order they had on the old projects page. */
export async function getProjects() {
  return (await getCollection('projects', isVisible)).sort((a, b) => a.data.order - b.data.order);
}

// --- Albums ------------------------------------------------------------------

type Album = CollectionEntry<'albums'>;

export async function getAlbums() {
  return getCollection('albums', isVisible);
}

export async function getParentAlbum(album: Album) {
  return (await getAlbums()).find((a) => a.data.albums.some((r) => r.id === album.id));
}

/** Visible child albums of a grouping album, in the order it lists them. */
export async function getChildAlbums(album: Album) {
  return (await getEntries(album.data.albums)).filter(isVisible);
}

// --- Tags --------------------------------------------------------------------

export function tagSlug(tag: string) {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Every tag used by posts or projects, with what it's attached to. */
export async function getTags() {
  const [posts, projects] = await Promise.all([getPosts(), getProjects()]);
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
