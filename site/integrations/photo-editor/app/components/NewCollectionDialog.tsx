import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { type Album, albumThumb, plural, post, slugify } from '@editor/lib/api';
import { Button } from '@editor/components/ui/button';
import { Checkbox } from '@editor/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@editor/components/ui/dialog';
import { Input } from '@editor/components/ui/input';
import { Switch } from '@editor/components/ui/switch';
import { Textarea } from '@editor/components/ui/textarea';
import { Field, ListingSelect, Thumb } from './shared';

/** A collection groups albums under a name of your choosing (like Places). */
export function NewCollectionDialog({
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
  const [listing, setListing] = useState('top');
  const [draft, setDraft] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSlug('');
    setSlugEdited(false);
    setDescription('');
    setListing('top');
    setDraft(false);
    setPicked([]);
    setError('');
  }, [open]);

  const candidates = albums.filter((a) => !a.isCollection);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await post('/collection', { album: slug, fields: { title, description, draft, topLevel: listing === 'top' } });
      if (picked.length) await post('/collection/albums', { album: slug, children: picked });
      await onCreated(slug);
      toast.success(`Created the ${title} collection`, { description: picked.length ? plural(picked.length, 'album') : 'Add albums to it next' });
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
        <form onSubmit={create} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
            <DialogDescription>Groups albums under one name, like Places. It has its own page with the albums as tiles, and nests them in the sidebar.</DialogDescription>
          </DialogHeader>
          <fieldset disabled={saving} className="grid gap-4">
            <Field label="Title">
              <Input
                required
                autoFocus
                value={title}
                placeholder="e.g. Road trips"
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
              <ListingSelect albums={albums} value={listing} onChange={setListing} topOnly />
            </Field>
            <div className="flex items-center gap-3">
              <Switch id="collection-draft" checked={draft} onCheckedChange={setDraft} />
              <label htmlFor="collection-draft" className="text-sm">
                Draft <span className="text-muted-foreground">(only visible in dev)</span>
              </label>
            </div>
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Albums</span>
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border p-1">
                {candidates.map((a) => {
                  const thumb = albumThumb(a, albums);
                  return (
                    <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-md p-1.5 hover:bg-muted">
                      <Checkbox
                        checked={picked.includes(a.id)}
                        onCheckedChange={(on) => setPicked((p) => (on ? [...p, a.id] : p.filter((x) => x !== a.id)))}
                      />
                      <span className="size-8 shrink-0 overflow-hidden rounded bg-muted">
                        {thumb && <Thumb album={thumb.album} photo={thumb.photo} className="size-full object-cover" />}
                      </span>
                      <span className="truncate">{a.title}</span>
                      {a.parent && <span className="ml-auto shrink-0 text-xs text-muted-foreground">in {albums.find((p) => p.id === a.parent)?.title}</span>}
                    </label>
                  );
                })}
              </div>
              <span className="text-xs text-muted-foreground">Optional: you can add albums later. Albums move here from wherever they're listed now.</span>
            </div>
          </fieldset>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create collection'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
