import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ExternalLink, ImagePlus, Search, Settings2, Upload } from 'lucide-react';
import { type Album, type Photo, droppedFiles, images, plural, post, refFor, uploadMany } from '@editor/lib/api';
import { Badge } from '@editor/components/ui/badge';
import { Button } from '@editor/components/ui/button';
import { Checkbox } from '@editor/components/ui/checkbox';
import { Input } from '@editor/components/ui/input';
import { Label } from '@editor/components/ui/label';
import { Progress } from '@editor/components/ui/progress';
import { Switch } from '@editor/components/ui/switch';
import { SidebarTrigger } from '@editor/components/ui/sidebar';
import { Separator } from '@editor/components/ui/separator';
import { cn } from '@editor/lib/utils';
import { Thumb } from './shared';
import { AlbumSettingsDialog } from './AlbumSettingsDialog';

interface Props {
  album: Album;
  albums: Album[];
  reload: () => Promise<void>;
  openPhoto: (src: string) => void;
  selection: string[];
  toggleSelected: (ref: string) => void;
  onUploaded: () => void;
}

export function AlbumView({ album, albums, reload, openPhoto, selection, toggleSelected, onUploaded }: Props) {
  const [order, setOrder] = useState(album.photos);
  const [query, setQuery] = useState('');
  const [untitled, setUntitled] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; message?: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setOrder(album.photos);
  }, [album]);
  useEffect(() => {
    setQuery('');
    setUntitled(false);
    setProgress(null);
  }, [album.id]);

  const filtering = !!query.trim() || untitled;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return order.filter(
      (p) => (!q || [p.name, p.title, ...p.tags].join(' ').toLowerCase().includes(q)) && (!untitled || !p.title),
    );
  }, [order, query, untitled]);

  const sensors = useSensors(
    // A small movement before a drag starts, so clicks still open the photo.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Space picks a photo up with the keyboard (Enter opens it).
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = order.findIndex((p) => p.src === active.id);
    const to = order.findIndex((p) => p.src === over.id);
    const next = arrayMove(order, from, to);
    setOrder(next);
    try {
      await post('/order', { album: album.id, srcs: next.map((p) => p.src) });
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
      setOrder(album.photos);
    }
  }

  async function add(files: File[]) {
    const list = images(files);
    if (!list.length) return toast.error('No photos in that', { description: 'JPEG, PNG, WebP, TIFF, AVIF or HEIC' });
    const { added, errors, skipped, upgraded } = await uploadMany(album.id, list, {
      before: album.photos.map((p) => p.src),
      onProgress: (done, total) => setProgress({ done, total }),
    });
    await reload();
    setProgress({
      done: list.length,
      total: list.length,
      message:
        `Added ${plural(added.length, 'photo')}` +
        (upgraded > 0 ? `, remade ${plural(upgraded, 'photo')} at the current sizes` : '') +
        (skipped > 0 ? ` (${skipped} already in the album, unchanged)` : '') +
        (errors.length ? `. Failed: ${errors.join('; ')}` : '.'),
    });
    if (added.length || upgraded) onUploaded();
  }

  const listing = album.parent
    ? `Inside ${albums.find((a) => a.id === album.parent)?.title ?? album.parent}`
    : album.topLevel
      ? 'In the sidebar'
      : 'Not listed';

  return (
    <div
      className="relative flex min-h-svh flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragOver(false)}
      onDrop={async (e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragOver(false);
        add(await droppedFiles(e.dataTransfer));
      }}
    >
      <header className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-5" />
          <h1 className="text-xl font-semibold tracking-tight">{album.title}</h1>
          <Badge variant="secondary">{plural(album.photos.length, 'photo')}</Badge>
          <Badge variant="outline">{listing}</Badge>
          {album.draft && <Badge variant="destructive">Draft</Badge>}
          {album.hasLayout && <Badge variant="outline">Custom layout</Badge>}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => picker.current?.click()}>
              <ImagePlus /> Add photos
            </Button>
            <input ref={picker} type="file" accept="image/*,.heic" multiple hidden onChange={(e) => add([...(e.target.files ?? [])]).finally(() => (e.target.value = ''))} />
            <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings2 /> Settings
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`/photography/${album.id}`} target="_blank">
                <ExternalLink /> View
              </a>
            </Button>
          </div>
        </div>
        {album.photos.length > 0 && (
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative w-64 max-w-full">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, title or tag" className="h-8 pl-8" />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="untitled" checked={untitled} onCheckedChange={setUntitled} />
              <Label htmlFor="untitled" className="text-sm font-normal">
                Untitled only
              </Label>
            </div>
            <span className="text-xs text-muted-foreground">
              {filtering ? `${shown.length} of ${order.length} shown · clear the filter to reorder` : 'Drag photos to reorder · click one to edit'}
            </span>
          </div>
        )}
        {progress && (
          <div className="flex flex-col gap-1.5">
            <Progress value={(progress.done / progress.total) * 100} className="h-1.5" />
            <p className="text-xs text-muted-foreground">{progress.message ?? `Processing ${progress.done} of ${progress.total}…`}</p>
          </div>
        )}
      </header>

      <main className="flex-1 p-4 md:p-6">
        {album.photos.length === 0 ? (
          <EmptyAlbum album={album} albums={albums} onPick={() => picker.current?.click()} />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={shown.map((p) => p.src)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4">
                {shown.map((photo) => {
                  const ref = refFor(album, photo);
                  return (
                    <PhotoTile
                      key={photo.src}
                      album={album}
                      photo={photo}
                      sortable={!filtering}
                      selected={selection.includes(ref)}
                      onToggle={() => toggleSelected(ref)}
                      onOpen={() => openPhoto(photo.src)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 m-2 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80">
          <p className="flex items-center gap-2 text-lg font-medium">
            <Upload className="size-5" /> Drop to add to {album.title}
          </p>
        </div>
      )}

      <AlbumSettingsDialog album={album} albums={albums} open={settingsOpen} onOpenChange={setSettingsOpen} reload={reload} />
    </div>
  );
}

function EmptyAlbum({ album, albums, onPick }: { album: Album; albums: Album[]; onPick: () => void }) {
  const children = album.children.map((id) => albums.find((a) => a.id === id)?.title ?? id);
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
      {children.length > 0 ? <p>Groups other albums: {children.join(', ')}.</p> : <p>No photos yet.</p>}
      <Button variant="outline" size="sm" onClick={onPick}>
        <ImagePlus /> Add photos
      </Button>
      <p>or drop photos or a folder here</p>
    </div>
  );
}

function PhotoTile({
  album,
  photo,
  sortable,
  selected,
  onToggle,
  onOpen,
}: {
  album: Album;
  photo: Photo;
  sortable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.src, disabled: !sortable });
  const cover = album.coverId === photo.id;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border bg-card text-left shadow-xs transition-shadow hover:shadow-md',
        selected && 'ring-2 ring-primary',
        isDragging && 'z-10 opacity-60 shadow-lg',
        sortable && 'cursor-grab active:cursor-grabbing',
      )}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter') onOpen();
      }}
      role="button"
      aria-label={`Edit ${photo.title || photo.name}`}
    >
      <div className="relative aspect-3/2 bg-muted">
        <Thumb album={album.id} photo={photo} className="absolute inset-0 size-full object-contain" />
        {cover && <Badge className="absolute top-2 right-2">Cover</Badge>}
        <div
          className={cn('absolute top-2 left-2 rounded-sm bg-background/80 p-1 opacity-0 transition-opacity group-hover:opacity-100', selected && 'opacity-100')}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Checkbox checked={selected} onCheckedChange={onToggle} aria-label="Select for a gallery snippet" />
        </div>
      </div>
      <div className="flex flex-col gap-0.5 p-2.5">
        <span className={cn('truncate text-sm font-medium', !photo.title && 'text-muted-foreground italic')}>{photo.title || 'Untitled'}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{photo.name}</span>
        {photo.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {photo.tags.slice(0, 3).map((t) => (
              <Badge key={t} variant="secondary" className="px-1.5 text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
