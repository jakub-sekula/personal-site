import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImageIcon, RotateCcw, Upload } from 'lucide-react';
import { type Album, albumThumb, listingFields, listingOf, post, uploadCover } from '@editor/lib/api';
import { Button } from '@editor/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@editor/components/ui/dialog';
import { Input } from '@editor/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@editor/components/ui/select';
import { Switch } from '@editor/components/ui/switch';
import { Textarea } from '@editor/components/ui/textarea';
import { Field, ListingSelect, Thumb } from './shared';
import { PhotoPicker } from './PhotoPicker';

const formOf = (album: Album) => ({
  title: album.title,
  date: album.date,
  description: album.description,
  listing: listingOf(album),
  hero: album.hero,
  coverPosition: album.coverPosition,
  draft: album.draft,
  cover: album.cover,
});

/** The thumbnail of a cover ("album/photo"): the saved one as the server resolved it, else as picked. */
function coverPreview(ref: string, album: Album, albums: Album[]) {
  if (!ref) {
    // Automatic: what the site uses without a cover of its own.
    const auto = albumThumb({ ...album, cover: '', coverThumb: null }, albums);
    return auto && { ...auto, automatic: true };
  }
  if (ref === album.cover && album.coverThumb) return { album: album.coverThumb.album, photo: album.coverThumb, automatic: false };
  // Picked: "album/name" or "album/full-id".
  const [coverAlbum, name] = ref.split('/');
  const photo = albums.find((a) => a.id === coverAlbum)?.photos.find((p) => p.id === name || p.name === name);
  return photo ? { album: coverAlbum, photo, automatic: false } : null;
}

export function AlbumSettingsDialog({
  album,
  albums,
  open,
  onOpenChange,
  reload,
}: {
  album: Album;
  albums: Album[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reload: () => Promise<void>;
}) {
  const [form, setForm] = useState(() => formOf(album));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  // Filled in when it opens (not on every reload: an uploaded cover reloads the albums
  // while the other fields may have unsaved edits).
  useEffect(() => {
    if (open) {
      setForm(formOf(album));
      setError('');
    }
  }, [open, album.id]);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { listing, cover, ...fields } = form;
      await post('/album', {
        album: album.id,
        fields: { ...fields, ...listingFields(listing), cover },
      });
      await reload();
      toast.success(`${form.title} saved`);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={save} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{album.isCollection ? 'Collection settings' : 'Album settings'}</DialogTitle>
            <DialogDescription>
              Saved into src/content/albums/{album.id}.mdx
              {album.hasLayout && '. This album also has a custom layout: edit the text below the photo list in that file.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2">
              <Input required value={form.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Description" hint="Shown over the cover photo" className="sm:col-span-2">
              <Textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Field label="Listed" className="sm:col-span-2">
              <ListingSelect albums={albums} self={album.id} value={form.listing} onChange={(v) => set('listing', v)} topOnly={album.isCollection} />
            </Field>
            {/* A group, not a <label> (Field): it holds several buttons. */}
            <div role="group" aria-labelledby="cover-label" className="flex flex-col gap-1.5 text-sm sm:col-span-2">
              <span id="cover-label" className="font-medium">
                Cover
              </span>
              <div className="flex items-center gap-3">
                <span className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md border bg-muted">
                  {(() => {
                    const p = coverPreview(form.cover, album, albums);
                    return p && <Thumb key={`${p.album}/${p.photo.id}`} album={p.album} photo={p.photo} className="size-full object-cover" />;
                  })()}
                </span>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {form.cover ? (
                    <span className="block truncate font-mono">{form.cover}</span>
                  ) : (
                    <>Automatic: {album.isCollection ? "the first album's cover" : 'the first photo'}</>
                  )}
                </span>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={() => setPicking(true)}>
                    <ImageIcon /> Choose
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => coverInput.current?.click()}>
                    <Upload /> {uploading ? 'Uploading…' : 'Upload'}
                  </Button>
                  {form.cover && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => set('cover', '')} aria-label="Automatic cover" title="Back to automatic">
                      <RotateCcw />
                    </Button>
                  )}
                </div>
                <input
                  ref={coverInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setUploading(true);
                    try {
                      // Processed like any photo and set as the cover straight away.
                      const { src } = await uploadCover(album.id, file);
                      set('cover', src);
                      await reload();
                      toast.success('Cover uploaded and set', { description: 'Upload to R2 or Publish to put it live.' });
                    } catch (err) {
                      toast.error((err as Error).message);
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                Any photo in the library, or one uploaded just for the cover (it isn't added to the {album.isCollection ? 'collection' : "album's photos"}).
              </span>
            </div>
            <Field label="Date" hint="Also the year in the photos' © line">
              <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            <Field label="Header">
              <Select value={form.hero} onValueChange={(v) => set('hero', v as Album['hero'])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Cover photo, full screen</SelectItem>
                  <SelectItem value="banner">Banner</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Cover crop" hint="Which part stays in view, e.g. 30% 50% for the left third">
              <Input value={form.coverPosition} placeholder="Centre" onChange={(e) => set('coverPosition', e.target.value)} />
            </Field>
            <div className="flex items-center gap-3 self-start pt-7">
              <Switch id="draft" checked={form.draft} onCheckedChange={(v) => set('draft', v)} />
              <label htmlFor="draft" className="text-sm">
                Draft <span className="text-muted-foreground">(only visible in dev)</span>
              </label>
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <PhotoPicker
        albums={albums}
        open={picking}
        onOpenChange={setPicking}
        title={`Choose the cover of ${album.title}`}
        description="Any photo from any album."
        max={1}
        confirm="Use as cover"
        onPick={([ref]) => ref && set('cover', ref)}
      />
    </Dialog>
  );
}
