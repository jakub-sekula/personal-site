// Client for the editor's dev API (../../api.mjs, mounted at /dev/api/photos by ../../index.mjs).

export interface Photo {
  src: string;
  id: string;
  name: string;
  w?: number;
  h?: number;
  thumb?: number;
  /** Widths it was resized to (each as AVIF and WebP), and the original file's name. */
  widths?: number[];
  original?: string;
  /** Made before the sizes changed: re-adding its original brings it up to date. */
  outdated?: boolean;
  title: string;
  description: string;
  tags: string[];
  alt: string;
  slug: string;
  href: string;
}

export interface Album {
  id: string;
  title: string;
  description: string;
  date: string;
  draft: boolean;
  hero: 'full' | 'banner';
  coverPosition: string;
  hasLayout: boolean;
  /** Groups other albums (one level: collections aren't nested). */
  isCollection: boolean;
  children: string[];
  /** Its own `cover` (optional for a collection), and that photo as a thumbnail. */
  cover: string;
  coverThumb: { album: string; id: string; thumb?: number } | null;
  parent: string;
  topLevel: boolean;
  coverId?: string;
  photos: Photo[];
}

export interface SyncStatus {
  local: number;
  remote: number;
  added: number;
  changed: number;
  uploaded: number;
}

const API = '/dev/api/photos';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

export async function fetchAlbums(): Promise<Album[]> {
  const { albums } = await json<{ albums: Album[] }>(await fetch(API));
  // The page updates live, but the API only changes when the dev server starts.
  if (albums.length && !Array.isArray(albums[0].children)) {
    throw new Error('The dev server is running an older version of the editor. Restart it (Ctrl+C, then pnpm dev) and reload.');
  }
  return albums;
}

export const post = async <T = unknown>(path: string, body: unknown) =>
  json<T>(await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

/** A photo's generated files with their sizes in bytes. */
export const fetchFiles = async (album: string, id: string) =>
  (await json<{ files: { file: string; bytes: number }[] }>(await fetch(`${API}/files?${new URLSearchParams({ album, id })}`))).files;

export interface PhotoSettings {
  widths: number[];
  avifQuality: number;
  webpQuality: number;
}
export interface SettingsInfo {
  config: PhotoSettings;
  defaults: PhotoSettings;
  limits: { width: [number, number]; quality: [number, number]; count: number };
  photos: number;
  /** Album id -> photos not at the current sizes. */
  outdated: Record<string, number>;
}
export const fetchSettings = async () => json<SettingsInfo>(await fetch(`${API}/settings`));
export const saveSettings = (config: PhotoSettings) => post<SettingsInfo>('/settings', config);

export const syncStatus = async () => json<SyncStatus>(await fetch(`${API}/sync`));
export const syncNow = () => post<SyncStatus>('/sync', {});

/** Add one image to an album (creating the album, titled `title`, if it doesn't exist). */
export async function uploadPhoto(album: string, file: File, title?: string) {
  const params = new URLSearchParams({ album, name: file.name, ...(title && { title }) });
  return json<{ src: string; added: boolean; created: boolean; upgraded: boolean }>(
    await fetch(`${API}/upload?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Photo-Editor': '1' },
      body: file,
    }),
  );
}

/** Upload an image just for an album's cover (not added to its photos) and make it the cover. */
export async function uploadCover(album: string, file: File) {
  const params = new URLSearchParams({ album, name: file.name, cover: '1' });
  return json<{ src: string }>(
    await fetch(`${API}/upload?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Photo-Editor': '1' },
      body: file,
    }),
  );
}

/**
 * Upload files into an album a few at a time, then put the new photos in
 * file-name order after the existing ones (`before`).
 */
export async function uploadMany(
  album: string,
  files: File[],
  { before = [], title, onProgress }: { before?: string[]; title?: string; onProgress?: (done: number, total: number) => void } = {},
) {
  const srcs: (string | undefined)[] = new Array(files.length);
  const errors: string[] = [];
  let upgraded = 0;
  let done = 0;
  let next = 0;
  onProgress?.(0, files.length);
  await Promise.all(
    Array.from({ length: Math.min(3, files.length) }, async () => {
      while (next < files.length) {
        const i = next++;
        try {
          const result = await uploadPhoto(album, files[i], title);
          srcs[i] = result.src;
          if (result.upgraded) upgraded++;
        } catch (error) {
          errors.push(`${files[i].name}: ${(error as Error).message}`);
        }
        onProgress?.(++done, files.length);
      }
    }),
  );
  const added = srcs.filter((s): s is string => !!s && !before.includes(s));
  if (added.length > 1) await post('/order', { album, srcs: [...before, ...added] });
  // Already in the album: brought up to the current sizes (`upgraded`), or unchanged.
  const skipped = files.length - errors.length - added.length - upgraded;
  return { added, errors, skipped, upgraded };
}

// --- Files ---------------------------------------------------------------------

export const IMAGE = /\.(jpe?g|png|webp|tiff?|avif|heic)$/i;

export const images = (files: File[]) =>
  files.filter((f) => IMAGE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

/** Files from a drop, including inside dropped folders. */
export async function droppedFiles(data: DataTransfer): Promise<File[]> {
  const entries = [...data.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...data.files];
  const files: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns at most 100 at a time.
      for (let batch: FileSystemEntry[]; (batch = await new Promise((r, j) => reader.readEntries(r, j))).length; ) {
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const entry of entries) await walk(entry);
  return files;
}

// --- Helpers --------------------------------------------------------------------------

// Thumbnails come from the local copies; fall back to R2 if they aren't on this machine.
const REMOTE = import.meta.env.PUBLIC_PHOTOS_URL || 'https://photos.jakubsekula.com';
export const photoUrl = (album: string, photo: Pick<Photo, 'id' | 'thumb'>, width = photo.thumb ?? 640) => {
  const path = `/${album}/${photo.id}/${width}.webp`;
  return { local: `/photos${path}`, remote: REMOTE + path };
};

/**
 * The thumbnail to show for an album: its cover, else (collections) its first
 * album's, else its first photo.
 */
export function albumThumb(album: Album, albums: Album[]): { album: string; photo: Pick<Photo, 'id' | 'thumb'> } | null {
  if (album.coverThumb) return { album: album.coverThumb.album, photo: album.coverThumb };
  for (const id of album.children) {
    const child = albums.find((a) => a.id === id);
    const thumb = child && albumThumb(child, albums);
    if (thumb) return thumb;
  }
  return album.photos[0] ? { album: album.id, photo: album.photos[0] } : null;
}

/** How posts refer to a photo: "album/name", or the full id if two share a name. */
export function refFor(album: Album, photo: Photo) {
  const shared = album.photos.filter((p) => p.name === photo.name).length > 1;
  return `${album.id}/${shared ? photo.id : photo.name}`;
}

export const slugify = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Where an album shows up on the site, for a "Listed" control: '', 'top' or 'in:<parent>'. */
export const listingOf = (album: Pick<Album, 'parent' | 'topLevel'>) => (album.parent ? `in:${album.parent}` : album.topLevel ? 'top' : '');
export const listingFields = (value: string) => ({ parent: value.startsWith('in:') ? value.slice(3) : '', topLevel: value === 'top' });
