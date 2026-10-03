// Client for the Posts, Projects, CV and Header dev API (../../content-api.mjs, at /dev/api/content).

/** Posts are "blog", projects "projects": a project is a post with a few extras. */
export type Kind = 'blog' | 'projects';
export const KINDS: Record<Kind, { noun: string; url: string; dir: string }> = {
  blog: { noun: 'post', url: '/blog', dir: 'src/content/blog' },
  projects: { noun: 'project', url: '/projects', dir: 'src/content/projects' },
};

export interface PostSummary {
  slug: string;
  file: string;
  mdx: boolean;
  title: string;
  description: string;
  date: string;
  tags: string[];
  cover: string;
  /** The cover image file (the small one for projects that have it), as served in dev. */
  coverUrl: string;
  coverPhoto: string;
  format: 'post' | 'story';
  draft: boolean;
  // Projects only.
  category?: string;
  color?: Accent;
  featured?: boolean;
  order?: number;
  coverSmall?: string;
  github?: string;
  demo?: string;
  tools?: string[];
  posts?: string[];
}

export interface Post extends PostSummary {
  body: string;
  /** Image files next to the post (for ./name.jpg references). */
  images: string[];
}

export interface Category {
  id: string;
  label: string;
  hidden: boolean;
}

export interface Tool {
  id: string;
  name: string;
}

export type CvEntry =
  | { kind: 'role'; title: string; place?: string; years?: string; logo?: string; bullets?: string[]; hidden?: boolean }
  | { kind: 'list'; title: string; items: string[]; hidden?: boolean }
  | { kind: 'bullets'; bullets: string[]; hidden?: boolean };

export interface CvSection {
  title: string;
  accent?: 'green' | 'yellow' | 'blue' | 'red';
  entries: CvEntry[];
}

export interface Cv {
  pdf?: string;
  linkedin?: string;
  sections: CvSection[];
}

export type Accent = 'green' | 'yellow' | 'blue' | 'red';
export type HeaderMenu = 'projects' | 'photography' | 'blog';

/** One item of the site header (src/content/header.yaml). */
export interface HeaderItem {
  label: string;
  href: string;
  accent?: Accent;
  /** What its drop-down shows; none: a plain link. */
  menu?: HeaderMenu;
  heading?: string;
  subheading?: string;
  allLabel?: string;
  /** Project, album or post ids, in order; empty: the automatic list. */
  pick?: string[];
  limit?: number;
  badge?: string;
  /** Blog menus: "New" while the latest post is under six weeks old (default on). */
  newBadge?: boolean;
  hidden?: boolean;
}

export interface ProjectSummary {
  id: string;
  title: string;
  type: string;
  featured: boolean;
  draft: boolean;
  /** Its category isn't hidden. */
  listed: boolean;
  cover: string;
}

export interface HeaderData {
  header: { items: HeaderItem[] };
  projects: ProjectSummary[];
  /** The photography sidebar's albums: what a photography menu shows by default. */
  sidebar: string[];
}

const API = '/dev/api/content';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}
const post = async <T>(path: string, body: unknown) =>
  json<T>(await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const upload = async <T>(path: string, params: Record<string, string>, file: File) =>
  json<T>(
    await fetch(`${API}${path}?${new URLSearchParams(params)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Photo-Editor': '1' },
      body: file,
    }),
  );

export const fetchPosts = async (kind: Kind = 'blog') => (await json<{ posts: PostSummary[] }>(await fetch(`${API}/posts?${new URLSearchParams({ kind })}`))).posts;
export const fetchPost = async (kind: Kind, slug: string) => json<Post>(await fetch(`${API}/post?${new URLSearchParams({ kind, slug })}`));
export const savePost = (kind: Kind, slug: string, fields: Omit<PostSummary, 'slug' | 'file' | 'mdx' | 'coverUrl'>, body: string) =>
  post<Post>('/post', { kind, slug, fields, body });
export const createPost = (kind: Kind, title: string, slug: string) => post<{ slug: string }>('/post/create', { kind, title, slug });
export const deletePost = (kind: Kind, slug: string) => post('/post/delete', { kind, slug });
export const uploadPostImage = (kind: Kind, slug: string, file: File) => upload<{ path: string }>('/post/image', { kind, slug, name: file.name }, file);

export const fetchCategories = async () => (await json<{ categories: Category[] }>(await fetch(`${API}/categories`))).categories;
export const saveCategories = async (categories: Category[]) => (await post<{ categories: Category[] }>('/categories', { categories })).categories;
export const saveProjectOrder = async (slugs: string[]) => (await post<{ projects: PostSummary[] }>('/projects/order', { slugs })).projects;
export const fetchTools = async () => (await json<{ tools: Tool[] }>(await fetch(`${API}/tools`))).tools;

export const fetchCv = async () => json<{ cv: Cv; logos: string[] }>(await fetch(`${API}/cv`));
export const saveCv = (cv: Cv) => post<{ cv: Cv; logos: string[] }>('/cv', { cv });
export const uploadCvLogo = (file: File) => upload<{ logo: string; file: string }>('/cv/logo', { name: file.name }, file);

export const fetchHeader = async () => json<HeaderData>(await fetch(`${API}/header`));
export const saveHeader = (header: HeaderData['header']) => post<HeaderData>('/header', { header });
