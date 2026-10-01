import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';
import { Check, ChevronLeft, ChevronRight, CircleAlert, Copy, ExternalLink, ImageIcon, LoaderCircle, Maximize2, Trash2 } from 'lucide-react';
import { type Album, type Photo, fetchFiles, photoUrl, post, refFor } from '@editor/lib/api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@editor/components/ui/alert-dialog';
import { Badge } from '@editor/components/ui/badge';
import { Button } from '@editor/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@editor/components/ui/dialog';
import { Input } from '@editor/components/ui/input';
import { Textarea } from '@editor/components/ui/textarea';
import { Field, Thumb, copy } from './shared';

type Fields = Pick<Photo, 'title' | 'description' | 'alt' | 'slug'> & { tags: string };
const fieldsOf = (p: Photo): Fields => ({ title: p.title, description: p.description, tags: p.tags.join(', '), alt: p.alt, slug: p.slug });

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

/**
 * Open the album in a full-size, zoomable lightbox at `index`, over the dialog (local
 * copies, or R2 when they aren't on this machine). It zooms out of the dialog's photo
 * and back into it; `onChange` keeps the dialog on the photo the lightbox shows.
 */
async function openLightbox(album: Album, index: number, { onChange, onClose }: { onChange: (src: string) => void; onClose: () => void }) {
  const first = album.photos[index];
  const local = await fetch(photoUrl(album.id, first).local, { method: 'HEAD' }).then((r) => r.ok, () => false);
  const url = (p: Photo, width: number) => photoUrl(album.id, p, width)[local ? 'local' : 'remote'];
  const pswp = new PhotoSwipe({
    dataSource: album.photos.map((p) => {
      const widths = p.widths?.length ? p.widths : [p.thumb ?? 640];
      return {
        msrc: url(p, widths[0]),
        src: url(p, widths.at(-1)!),
        srcset: widths.map((w) => `${url(p, w)} ${w}w`).join(', '),
        width: p.w,
        height: p.h,
        alt: p.title || p.name,
      };
    }),
    index,
    bgOpacity: 0.95,
    showHideAnimationType: 'zoom',
    // The dialog keeps focus (it's modal); the lightbox's keys work regardless.
    trapFocus: false,
    returnFocus: false,
  });
  // Zoom from and back into the photo shown in the dialog (it follows the lightbox).
  pswp.addFilter('thumbEl', (el) => (document.querySelector<HTMLElement>('[data-dialog-photo] img') ?? el) as HTMLElement);
  pswp.on('change', () => onChange(album.photos[pswp.currIndex].src));
  pswp.on('destroy', onClose);
  pswp.init();
}

/** Edit one photo: details save into the album file when a field loses focus. */
export function PhotoDialog({
  album,
  src,
  onClose,
  onNavigate,
  reload,
}: {
  album?: Album;
  src?: string;
  onClose: () => void;
  onNavigate: (src: string) => void;
  reload: () => Promise<void>;
}) {
  const index = album?.photos.findIndex((p) => p.src === src) ?? -1;
  const photo = index >= 0 ? album!.photos[index] : undefined;
  const [fields, setFields] = useState<Fields | null>(null);
  const [saved, setSaved] = useState<Fields | null>(null);
  // Shown in the header: saving, just saved (fades to idle), or an error.
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' });
  const [files, setFiles] = useState<{ file: string; bytes: number }[] | null>(null);
  const [zoomed, setZoomed] = useState(false);
  // Read synchronously by the dialog's outside-click/Escape handlers.
  const zoomedRef = useRef(false);

  // Load the photo's fields and files when another photo is opened (not when the albums reload).
  useEffect(() => {
    if (!photo || !album) return;
    setFields(fieldsOf(photo));
    setSaved(fieldsOf(photo));
    setStatus({ kind: 'idle' });
    setFiles(null);
    fetchFiles(album.id, photo.id).then(setFiles, () => setFiles([]));
  }, [photo?.src]);

  async function save() {
    if (!album || !photo || !fields || JSON.stringify(fields) === JSON.stringify(saved)) return;
    setStatus({ kind: 'saving' });
    const sent = fields;
    try {
      const { saved: clean } = await post<{ saved: Omit<Fields, 'tags'> & { tags: string[] } }>('/photo', {
        album: album.id,
        src: photo.src,
        fields: { ...sent, tags: sent.tags.split(',') },
      });
      const next = { ...clean, tags: clean.tags.join(', ') };
      // Show the tidied values (trimmed, tags de-duplicated), unless you've typed
      // more since this save started: that will be saved when you leave the field.
      setFields((current) => (JSON.stringify(current) === JSON.stringify(sent) ? next : current));
      setSaved(next);
      setStatus({ kind: 'saved' });
      reload();
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message });
    }
  }

  // "Saved ✓" for a moment, then the quiet "All changes saved".
  useEffect(() => {
    if (status.kind !== 'saved') return;
    const timer = setTimeout(() => setStatus((s) => (s.kind === 'saved' ? { kind: 'idle' } : s)), 2500);
    return () => clearTimeout(timer);
  }, [status]);
  const dirty = !!fields && !!saved && JSON.stringify(fields) !== JSON.stringify(saved);

  const go = (step: number) => {
    const next = album?.photos[index + step];
    if (next) onNavigate(next.src);
  };
  // ← / → step through the album (not while typing, or in the lightbox).
  useEffect(() => {
    if (!photo || zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const zoom = () => {
    if (!album) return;
    const done = () => {
      zoomedRef.current = false;
      setZoomed(false);
    };
    zoomedRef.current = true;
    setZoomed(true);
    openLightbox(album, index, { onChange: onNavigate, onClose: done }).catch(done);
  };
  // While the lightbox is open over the dialog, clicks on it and Escape belong to it.
  const keepOpen = (e: Event) => zoomedRef.current && e.preventDefault();

  const ref = album && photo ? refFor(album, photo) : '';
  const field = (key: keyof Fields) => ({
    value: fields?.[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((f) => f && { ...f, [key]: e.target.value }),
    onBlur: save,
  });

  return (
    // Closing (Escape, ×, outside click) saves anything still unsaved first.
    <Dialog
      open={!!photo}
      onOpenChange={(open) => {
        if (open || zoomedRef.current) return;
        save();
        onClose();
      }}
    >
      <DialogContent
        onPointerDownOutside={keepOpen}
        onInteractOutside={keepOpen}
        onFocusOutside={keepOpen}
        onEscapeKeyDown={keepOpen}
        className="grid max-h-[calc(100svh-2rem)] w-[min(76rem,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-none">
        {album && photo && fields && (
          <>
            <DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3 pr-12 text-left">
              <div className="flex min-w-0 flex-col gap-0.5">
                <DialogTitle className="flex items-center gap-2">
                  <span className="truncate">{photo.title || 'Untitled'}</span>
                  {album.coverId === photo.id && <Badge>Cover</Badge>}
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  {ref} · {index + 1} of {album.photos.length} in {album.title}
                </DialogDescription>
              </div>
              <SaveStatus status={status} dirty={dirty} />
              <div className="flex gap-1">
                <Button size="icon" variant="outline" className="size-8" disabled={index === 0} onClick={() => go(-1)} aria-label="Previous photo" title="Previous (←)">
                  <ChevronLeft />
                </Button>
                <Button size="icon" variant="outline" className="size-8" disabled={index === album.photos.length - 1} onClick={() => go(1)} aria-label="Next photo" title="Next (→)">
                  <ChevronRight />
                </Button>
              </div>
            </DialogHeader>

            <div className="grid min-h-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              {/* The photo and its files */}
              <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-b p-5 md:border-r md:border-b-0">
                <div className="flex justify-center rounded-lg bg-muted">
                  {/* The image box is exactly the photo (no letterboxing), so the lightbox zooms out of it precisely. */}
                  <button
                    type="button"
                    onClick={zoom}
                    data-dialog-photo
                    className={`group relative cursor-zoom-in overflow-hidden rounded-lg ${zoomed ? 'invisible' : ''}`}
                    aria-label="View full size"
                    title="View full size (zoomable)"
                  >
                    <Thumb
                      key={photo.src}
                      album={album.id}
                      photo={photo}
                      width={photo.widths?.find((w) => w >= 1280) ?? photo.widths?.at(-1)}
                      className="block h-auto max-h-[48svh] w-auto max-w-full"
                    />
                    <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <Maximize2 className="size-3" /> Full size
                    </span>
                  </button>
                </div>
                <FileList album={album} photo={photo} files={files} />
              </div>

              {/* Details */}
              <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto p-5">
                <Field label="Title">
                  <Input {...field('title')} placeholder="Untitled" />
                </Field>
                <Field label="Description" hint="Markdown: **bold**, *italic*, [links](https://…)">
                  <Textarea {...field('description')} rows={3} />
                </Field>
                <Field label="Tags" hint="Comma separated; each tag gets a page listing its photos">
                  <Input {...field('tags')} placeholder="e.g. fog, churches" />
                </Field>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field label="Alt text" hint="For screen readers; defaults to the title">
                    <Input {...field('alt')} />
                  </Field>
                  <Field label="Address" hint={`…/${album.id}/${fields.slug || photo.name}`}>
                    <Input {...field('slug')} placeholder={photo.name} />
                  </Field>
                </div>

                <div className="mt-auto flex flex-wrap gap-2 border-t pt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={album.coverId === photo.id}
                    onClick={async () => {
                      try {
                        await post('/cover', { album: album.id, src: `${album.id}/${photo.id}` });
                        await reload();
                        toast.success(`Cover of ${album.title} set`);
                      } catch (error) {
                        toast.error((error as Error).message);
                      }
                    }}
                  >
                    <ImageIcon /> Set as cover
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => copy(`<Photo src="${ref}" />`)}>
                    <Copy /> Copy &lt;Photo&gt;
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => copy(ref)}>
                    <Copy /> Copy name
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={photo.href} target="_blank">
                      <ExternalLink /> Page
                    </a>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
                        <Trash2 /> Remove
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Take this photo out of {album.title}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Its title, description and tags are removed with it. The image files stay, locally and in R2, so you can add it again.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={async () => {
                            try {
                              await post('/remove', { album: album.id, src: photo.src });
                              onClose();
                              await reload();
                              toast.success(`Removed ${ref}`);
                            } catch (error) {
                              toast.error((error as Error).message);
                            }
                          }}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Where the photo's details stand: unsaved, saving, saved, or a failed save. */
function SaveStatus({ status, dirty }: { status: { kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }; dirty: boolean }) {
  const base = 'ml-auto flex min-w-0 items-center gap-1.5 text-xs';
  if (status.kind === 'saving')
    return (
      <span className={`${base} text-muted-foreground`} role="status">
        <LoaderCircle className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  if (status.kind === 'error')
    return (
      <span className={`${base} text-destructive`} role="alert" title={status.text}>
        <CircleAlert className="size-3.5 shrink-0" /> <span className="truncate">Not saved: {status.text}</span>
      </span>
    );
  if (dirty)
    return (
      <span className={`${base} text-amber-500`} role="status">
        <span className="size-2 rounded-full bg-amber-500" /> Unsaved: saves when you leave the field
      </span>
    );
  if (status.kind === 'saved')
    return (
      <span className={`${base} font-medium text-emerald-500`} role="status">
        <Check className="size-3.5" /> Saved
      </span>
    );
  return (
    <span className={`${base} text-muted-foreground`} role="status">
      <Check className="size-3.5" /> All changes saved
    </span>
  );
}

/** The original's size, and every resized file the site serves, with dimensions and file sizes. */
function FileList({ album, photo, files }: { album: Album; photo: Photo; files: { file: string; bytes: number }[] | null }) {
  const widths = photo.widths ?? [];
  const size = (name: string) => files?.find((f) => f.file === name)?.bytes;
  const height = (w: number) => (photo.w && photo.h ? Math.round((photo.h * w) / photo.w) : undefined);
  const total = files?.reduce((sum, f) => sum + f.bytes, 0) ?? 0;
  const link = (name: string) => {
    const bytes = size(name);
    if (bytes === undefined) return <span className="text-muted-foreground">{files ? 'missing' : '…'}</span>;
    return (
      <a href={`/photos/${album.id}/${photo.id}/${name}`} target="_blank" className="tabular-nums underline-offset-2 hover:underline">
        {kb(bytes)}
      </a>
    );
  };
  const ogWidth = photo.w ? Math.min(1200, photo.w) : 1200;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <h3 className="font-medium">Original</h3>
        <p className="text-muted-foreground">
          {photo.original || photo.name}
          {photo.w && photo.h ? ` · ${photo.w} × ${photo.h} px` : ''}
          <span className="block text-xs">Not stored: only the resized files below are kept and uploaded.</span>
        </p>
      </div>
      <div>
        <h3 className="mb-1.5 font-medium">Files served</h3>
        <table className="w-full text-left">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-1 font-normal">Size (px)</th>
              <th className="py-1 font-normal">AVIF</th>
              <th className="py-1 font-normal">WebP</th>
            </tr>
          </thead>
          <tbody>
            {widths.map((w) => (
              <tr key={w} className="border-b border-border/50">
                <td className="py-1 tabular-nums">
                  {w} × {height(w) ?? '?'}
                </td>
                <td className="py-1">{link(`${w}.avif`)}</td>
                <td className="py-1">{link(`${w}.webp`)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1 tabular-nums">
                {ogWidth} × {height(ogWidth) ?? '?'}
              </td>
              <td className="py-1" colSpan={2}>
                {link('og.jpg')} <span className="text-muted-foreground">JPEG, for link previews</span>
              </td>
            </tr>
          </tbody>
        </table>
        {files && files.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{files.length} files, {kb(total)} in all</p>}
        {files && files.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Not on this machine (thumbnails come from R2).</p>}
        {photo.outdated && (
          <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            Made before the photo settings changed. Drop its original file ({photo.original || photo.name}) on the album to remake it at the current sizes: same photo,
            same address.
          </p>
        )}
      </div>
      <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
        <li>Album grids, posts and photo pages: AVIF where the browser supports it (most do), otherwise WebP, at whichever width the layout needs on that screen.</li>
        <li>Lightbox: WebP, up to {widths.at(-1) ?? '?'} px wide.</li>
        <li>Link previews (social media, chat apps): the JPEG.</li>
      </ul>
    </div>
  );
}
