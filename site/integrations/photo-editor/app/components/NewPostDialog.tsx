import { useEffect, useState } from 'react';
import { slugify } from '@editor/lib/api';
import { type Kind, KINDS, createPost } from '@editor/lib/content';
import { Button } from '@editor/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@editor/components/ui/dialog';
import { Input } from '@editor/components/ui/input';
import { Field } from './shared';

/** A new post or project starts as a draft .mdx in its own folder (so it can hold images). */
export function NewPostDialog({
  kind = 'blog',
  open,
  onOpenChange,
  onCreated,
}: {
  kind?: Kind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (slug: string) => Promise<void>;
}) {
  const { noun, url, dir } = KINDS[kind];
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setSlug('');
    setEdited(false);
    setError('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="flex flex-col gap-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            setError('');
            try {
              const { slug: created } = await createPost(kind, title, slug);
              await onCreated(created);
              onOpenChange(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>New {noun}</DialogTitle>
            <DialogDescription>
              It starts as a draft (only visible in dev), in {dir}/{slug || '…'}/index.mdx.
              {kind === 'projects' && ' It goes last on the projects page, in the first category: change both in its details.'}
            </DialogDescription>
          </DialogHeader>
          <Field label="Title">
            <Input
              required
              autoFocus
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!edited) setSlug(slugify(e.target.value));
              }}
            />
          </Field>
          <Field label="Address">
            <div className="flex items-center gap-1 text-sm">
              <span className="text-muted-foreground">{url}/</span>
              <Input
                required
                pattern="[a-z0-9\-]+"
                title="a–z, 0–9 and hyphens"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setEdited(true);
                }}
              />
            </div>
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating…' : `Create ${noun}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
