import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { type Album, listingFields, listingOf, post } from '@editor/lib/api';
import { Button } from '@editor/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@editor/components/ui/dialog';
import { Input } from '@editor/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@editor/components/ui/select';
import { Switch } from '@editor/components/ui/switch';
import { Textarea } from '@editor/components/ui/textarea';
import { Field, ListingSelect } from './shared';

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

// For a collection: which of its albums' covers to use (or the first album's, automatically).
function coverChoices(album: Album, albums: Album[]) {
  return album.children
    .map((id) => albums.find((a) => a.id === id))
    .flatMap((child) => {
      const ref = child?.cover || (child?.photos[0] && `${child.id}/${child.photos[0].id}`);
      return child && ref ? [{ ref, label: `${child.title}'s cover` }] : [];
    });
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
  useEffect(() => {
    if (open) {
      setForm(formOf(album));
      setError('');
    }
  }, [open, album]);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { listing, cover, ...fields } = form;
      await post('/album', {
        album: album.id,
        fields: { ...fields, ...listingFields(listing), ...(album.isCollection && { cover }) },
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
            {album.isCollection && (
              <Field label="Cover" className="sm:col-span-2">
                <Select value={form.cover || 'auto'} onValueChange={(v) => set('cover', v === 'auto' ? '' : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automatic (the first album's cover)</SelectItem>
                    {coverChoices(album, albums).map((c) => (
                      <SelectItem key={c.ref} value={c.ref}>
                        {c.label}
                      </SelectItem>
                    ))}
                    {form.cover && !coverChoices(album, albums).some((c) => c.ref === form.cover) && (
                      <SelectItem value={form.cover}>Current ({form.cover})</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </Field>
            )}
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
    </Dialog>
  );
}
