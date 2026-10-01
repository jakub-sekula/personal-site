import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FolderOpen, ImagePlus } from 'lucide-react';
import { type Album, droppedFiles, images, listingFields, plural, post, slugify, uploadMany } from '@editor/lib/api';
import { Button } from '@editor/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@editor/components/ui/dialog';
import { Input } from '@editor/components/ui/input';
import { Progress } from '@editor/components/ui/progress';
import { Switch } from '@editor/components/ui/switch';
import { Textarea } from '@editor/components/ui/textarea';
import { cn } from '@editor/lib/utils';
import { Field, ListingSelect } from './shared';

export function NewAlbumDialog({
  albums,
  open,
  onOpenChange,
  onCreated,
}: {
  albums: Album[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [listing, setListing] = useState('');
  const [draft, setDraft] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState(false);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const pickFiles = useRef<HTMLInputElement>(null);
  const pickFolder = useRef<HTMLInputElement>(null);
  const creating = progress !== null;

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSlug('');
    setSlugEdited(false);
    setDescription('');
    setListing('top');
    setDraft(false);
    setFiles([]);
    setRejected(false);
    setProgress(null);
    setError('');
  }, [open]);

  const pick = (list: File[]) => {
    const found = images(list);
    setFiles(found);
    setRejected(list.length > 0 && found.length === 0);
  };

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (creating || !files.length) return;
    setError('');
    if (albums.some((a) => a.id === slug)) {
      setError(`There's already an album at /photography/${slug}. To add photos to it, drop them on it.`);
      return;
    }
    setProgress({ done: 0, total: files.length });
    try {
      const { added, errors } = await uploadMany(slug, files, {
        title: title.trim(),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (!added.length) throw new Error(errors.join('; ') || 'No photos were added');
      await post('/album', {
        album: slug,
        fields: { title, description, date: new Date().toISOString().slice(0, 10), draft, ...listingFields(listing) },
      });
      await onCreated(slug);
      toast.success(`Created ${title}`, {
        description: errors.length ? `${plural(errors.length, 'photo')} failed: ${errors.join('; ')}` : plural(added.length, 'photo'),
      });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  }

  return (
    // While photos are processing, it can't be closed (the upload would be left half done).
    <Dialog open={open} onOpenChange={(next) => (creating ? null : onOpenChange(next))}>
      <DialogContent className="sm:max-w-xl" showCloseButton={!creating}>
        <form onSubmit={create} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>New album</DialogTitle>
            <DialogDescription>Photos are resized and saved locally; upload them to R2 when you're done.</DialogDescription>
          </DialogHeader>
          <fieldset disabled={creating} className="grid gap-4">
            <Field label="Title">
              <Input
                required
                autoFocus
                value={title}
                placeholder="🇵🇹 Portugal"
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugEdited) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field label="Address">
              <div className="flex items-center gap-1 text-sm">
                <span className="text-muted-foreground">/photography/</span>
                <Input
                  required
                  pattern="[a-z0-9\-]+"
                  title="a–z, 0–9 and hyphens"
                  value={slug}
                  placeholder="portugal"
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugEdited(true);
                  }}
                />
              </div>
            </Field>
            <Field label="Description" hint="Shown over the cover photo">
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Listed">
              <ListingSelect albums={albums} value={listing} onChange={setListing} />
            </Field>
            <div className="flex items-center gap-3">
              <Switch id="new-draft" checked={draft} onCheckedChange={setDraft} />
              <label htmlFor="new-draft" className="text-sm">
                Draft <span className="text-muted-foreground">(only visible in dev until you turn it off)</span>
              </label>
            </div>
            <div
              className={cn(
                'flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center text-sm transition-colors',
                over && 'border-primary bg-primary/5',
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setOver(false);
                pick(await droppedFiles(e.dataTransfer));
              }}
            >
              <p>Drop photos or a folder here</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => pickFiles.current?.click()}>
                  <ImagePlus /> Choose photos
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => pickFolder.current?.click()}>
                  <FolderOpen /> Choose a folder
                </Button>
              </div>
              <input ref={pickFiles} type="file" accept="image/*,.heic" multiple hidden onChange={(e) => pick([...(e.target.files ?? [])])} />
              <input
                ref={(el) => {
                  pickFolder.current = el;
                  el?.setAttribute('webkitdirectory', '');
                }}
                type="file"
                hidden
                onChange={(e) => pick([...(e.target.files ?? [])])}
              />
              <p className="text-xs text-muted-foreground" data-picked>
                {files.length
                  ? `${plural(files.length, 'photo')}: ${files
                      .slice(0, 3)
                      .map((f) => f.name)
                      .join(', ')}${files.length > 3 ? '…' : ''}`
                  : rejected
                    ? 'No photos in that (JPEG, PNG, WebP, TIFF, AVIF or HEIC)'
                    : 'No photos yet'}
              </p>
            </div>
          </fieldset>
          {progress && (
            <div className="flex flex-col gap-1.5">
              <Progress value={(progress.done / progress.total) * 100} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                Processing {progress.done} of {progress.total}…
              </p>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={creating} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating || !files.length}>
              {creating ? 'Creating…' : 'Create album'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
