import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { type Album, plural, refFor } from '@editor/lib/api';
import { Button } from '@editor/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@editor/components/ui/dialog';
import { Input } from '@editor/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@editor/components/ui/select';
import { cn } from '@editor/lib/utils';
import { Thumb } from './shared';

/**
 * Choose photos from the library (in the order you click them). Returns their
 * references ("album/name"), as posts use them.
 */
export function PhotoPicker({
  albums,
  open,
  onOpenChange,
  title,
  description,
  min = 1,
  max = Infinity,
  confirm = 'Insert',
  onPick,
}: {
  albums: Album[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  min?: number;
  max?: number;
  confirm?: string;
  onPick: (refs: string[]) => void;
}) {
  const withPhotos = albums.filter((a) => a.photos.length);
  const [albumId, setAlbumId] = useState(withPhotos[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setPicked([]);
      setQuery('');
    }
  }, [open]);

  const album = albums.find((a) => a.id === albumId);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Searching looks across every album; otherwise the chosen one.
    const pool = q ? withPhotos.flatMap((a) => a.photos.map((p) => ({ album: a, photo: p }))) : (album?.photos ?? []).map((p) => ({ album: album!, photo: p }));
    return q ? pool.filter(({ photo, album: a }) => [photo.name, photo.title, ...photo.tags, a.title].join(' ').toLowerCase().includes(q)) : pool;
  }, [albumId, query, albums]);

  const toggle = (ref: string) =>
    setPicked((p) => (p.includes(ref) ? p.filter((r) => r !== ref) : max === 1 ? [ref] : p.length < max ? [...p, ref] : p));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Select value={albumId} onValueChange={setAlbumId} disabled={!!query.trim()}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {withPhotos.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all albums by name, title or tag" className="pl-8" />
          </div>
        </div>
        <div className="-mx-1 grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] content-start gap-2 overflow-y-auto p-1">
          {shown.map(({ album: a, photo }) => {
            const ref = refFor(a, photo);
            const at = picked.indexOf(ref);
            return (
              <button
                key={photo.src}
                type="button"
                onClick={() => toggle(ref)}
                onDoubleClick={() => max === 1 && (onPick([ref]), onOpenChange(false))}
                className={cn('relative aspect-3/2 overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring', at >= 0 && 'ring-2 ring-primary')}
                title={`${photo.title || photo.name} (${ref})`}
              >
                <Thumb album={a.id} photo={photo} className="size-full object-cover" />
                {at >= 0 && (
                  <span className="absolute top-1 left-1 flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {max === 1 ? '✓' : at + 1}
                  </span>
                )}
              </button>
            );
          })}
          {shown.length === 0 && <p className="col-span-full p-6 text-center text-sm text-muted-foreground">No photos match.</p>}
        </div>
        <DialogFooter className="items-center">
          <span className="mr-auto truncate text-xs text-muted-foreground">{picked.length ? picked.join(', ') : 'Click photos to choose them'}</span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={picked.length < min}
            onClick={() => {
              onPick(picked);
              onOpenChange(false);
            }}
          >
            {confirm}
            {max > 1 && picked.length ? ` ${plural(picked.length, 'photo')}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
