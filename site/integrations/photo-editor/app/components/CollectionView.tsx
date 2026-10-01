import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ExternalLink, FolderPlus, Settings2, Trash2, X } from 'lucide-react';
import { type Album, albumThumb, plural, post } from '@editor/lib/api';
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
import { Checkbox } from '@editor/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@editor/components/ui/dialog';
import { Separator } from '@editor/components/ui/separator';
import { SidebarTrigger } from '@editor/components/ui/sidebar';
import { cn } from '@editor/lib/utils';
import { AlbumSettingsDialog } from './AlbumSettingsDialog';
import { Thumb } from './shared';

interface Props {
  collection: Album;
  albums: Album[];
  reload: () => Promise<void>;
  openAlbum: (id: string) => void;
  onDeleted: () => void;
}

/** A collection: the albums it groups, in order. */
export function CollectionView({ collection, albums, reload, openAlbum, onDeleted }: Props) {
  const children = collection.children.map((id) => albums.find((a) => a.id === id)).filter((a): a is Album => !!a);
  const [order, setOrder] = useState(children.map((a) => a.id));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    setOrder(collection.children);
  }, [collection]);

  const save = async (ids: string[], message?: string) => {
    setOrder(ids);
    try {
      await post('/collection/albums', { album: collection.id, children: ids });
      await reload();
      if (message) toast.success(message);
    } catch (error) {
      toast.error((error as Error).message);
      setOrder(collection.children);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    save(arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id))));
  };

  const listing = collection.topLevel ? 'In the sidebar' : 'Not listed';

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur md:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="h-5" />
        <h1 className="text-xl font-semibold tracking-tight">{collection.title}</h1>
        <Badge>Collection</Badge>
        <Badge variant="secondary">{plural(children.length, 'album')}</Badge>
        <Badge variant="outline">{listing}</Badge>
        {collection.draft && <Badge variant="destructive">Draft</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setAdding(true)}>
            <FolderPlus /> Add albums
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings2 /> Settings
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`/photography/${collection.id}`} target="_blank">
              <ExternalLink /> View
            </a>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
                <Trash2 /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete the {collection.title} collection?</AlertDialogTitle>
                <AlertDialogDescription>
                  Its albums and their photos stay; they just won't be grouped, or listed anywhere until you list them again. This deletes
                  src/content/albums/{collection.id}.mdx (git can bring it back).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={async () => {
                    try {
                      await post('/collection/delete', { album: collection.id });
                      onDeleted();
                      await reload();
                      toast.success(`Deleted ${collection.title}`);
                    } catch (error) {
                      toast.error((error as Error).message);
                    }
                  }}
                >
                  Delete collection
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <p className="w-full text-xs text-muted-foreground">
          {children.length ? 'Drag albums to reorder · click one to open it' : 'Empty: it stays off the site until you add albums.'}
        </p>
      </header>

      <main className="flex-1 p-4 md:p-6">
        {children.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            <p>No albums in this collection yet.</p>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <FolderPlus /> Add albums
            </Button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
                {order.map((id) => {
                  const album = albums.find((a) => a.id === id);
                  return (
                    album && (
                      <AlbumCard
                        key={id}
                        album={album}
                        albums={albums}
                        onOpen={() => openAlbum(id)}
                        onRemove={() => save(order.filter((x) => x !== id), `${album.title} taken out of ${collection.title}`)}
                      />
                    )
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>

      <AlbumSettingsDialog album={collection} albums={albums} open={settingsOpen} onOpenChange={setSettingsOpen} reload={reload} />
      <AddAlbumsDialog
        collection={collection}
        albums={albums}
        open={adding}
        onOpenChange={setAdding}
        onAdd={(ids) => save([...order, ...ids], `Added ${plural(ids.length, 'album')} to ${collection.title}`)}
      />
    </div>
  );
}

function AlbumCard({ album, albums, onOpen, onRemove }: { album: Album; albums: Album[]; onOpen: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: album.id });
  const thumb = albumThumb(album, albums);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative flex cursor-grab flex-col overflow-hidden rounded-lg border bg-card shadow-xs transition-shadow hover:shadow-md active:cursor-grabbing',
        isDragging && 'z-10 opacity-60 shadow-lg',
      )}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter') onOpen();
      }}
      role="button"
      aria-label={`Open ${album.title}`}
    >
      <div className="relative aspect-3/2 bg-muted">
        {thumb && <Thumb album={thumb.album} photo={thumb.photo} className="absolute inset-0 size-full object-cover" />}
        <Button
          size="icon"
          variant="secondary"
          className="absolute top-2 right-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label={`Take ${album.title} out of this collection`}
          title="Take out of this collection"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X />
        </Button>
      </div>
      <div className="flex items-center gap-2 p-3">
        <span className="truncate font-medium">{album.title}</span>
        {album.draft && <Badge variant="outline">draft</Badge>}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{plural(album.photos.length, 'photo')}</span>
      </div>
    </div>
  );
}

/** Pick albums to add: any album that isn't a collection or already in this one. */
function AddAlbumsDialog({
  collection,
  albums,
  open,
  onOpenChange,
  onAdd,
}: {
  collection: Album;
  albums: Album[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    setPicked([]);
  }, [open]);
  const candidates = albums.filter((a) => !a.isCollection && !collection.children.includes(a.id));
  const where = (a: Album) => (a.parent ? `in ${albums.find((p) => p.id === a.parent)?.title ?? a.parent}, will move` : a.topLevel ? 'in the sidebar, will move' : 'not listed');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add albums to {collection.title}</DialogTitle>
          <DialogDescription>An album is in one place at a time: adding it here takes it out of its collection or the sidebar.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
          {candidates.length === 0 && <p className="text-sm text-muted-foreground">Every album is already in this collection.</p>}
          {candidates.map((a) => {
            const thumb = albumThumb(a, albums);
            return (
              <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted">
                <Checkbox checked={picked.includes(a.id)} onCheckedChange={(on) => setPicked((p) => (on ? [...p, a.id] : p.filter((x) => x !== a.id)))} />
                <span className="size-10 shrink-0 overflow-hidden rounded bg-muted">
                  {thumb && <Thumb album={thumb.album} photo={thumb.photo} className="size-full object-cover" />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{a.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {plural(a.photos.length, 'photo')} · {where(a)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!picked.length}
            onClick={() => {
              onAdd(picked);
              onOpenChange(false);
            }}
          >
            Add {picked.length ? plural(picked.length, 'album') : 'albums'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
