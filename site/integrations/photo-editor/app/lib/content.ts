// Client for the Posts and CV dev API (../../content-api.mjs, at /dev/api/content).

export interface PostSummary {
  slug: string;
  file: string;
  mdx: boolean;
  title: string;
  description: string;
  date: string;
  tags: string[];
  cover: string;
  coverPhoto: string;
  format: 'post' | 'story';
  draft: boolean;
}

export interface Post extends PostSummary {
  body: string;
  /** Image files next to the post (for ./name.jpg references). */
  images: string[];
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

export const fetchPosts = async () => (await json<{ posts: PostSummary[] }>(await fetch(`${API}/posts`))).posts;
export const fetchPost = async (slug: string) => json<Post>(await fetch(`${API}/post?${new URLSearchParams({ slug })}`));
export const savePost = (slug: string, fields: Omit<PostSummary, 'slug' | 'file' | 'mdx'>, body: string) => post<Post>('/post', { slug, fields, body });
export const createPost = (title: string, slug: string) => post<{ slug: string }>('/post/create', { title, slug });
export const deletePost = (slug: string) => post('/post/delete', { slug });
export const uploadPostImage = (slug: string, file: File) => upload<{ path: string }>('/post/image', { slug, name: file.name }, file);

export const fetchCv = async () => json<{ cv: Cv; logos: string[] }>(await fetch(`${API}/cv`));
export const saveCv = (cv: Cv) => post<{ cv: Cv; logos: string[] }>('/cv', { cv });
export const uploadCvLogo = (file: File) => upload<{ logo: string; file: string }>('/cv/logo', { name: file.name }, file);
