import { useEffect } from 'react';
import { FolderOpen } from 'lucide-react';
import { type Album, refFor } from '@editor/lib/api';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@editor/components/ui/command';
import { Thumb } from './shared';

/** ⌘K: jump to any album, or any photo by name, title or tag. */
export function CommandMenu({
  albums,
  open,
  onOpenChange,
  onAlbum,
  onPhoto,
}: {
  albums: Album[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAlbum: (id: string) => void;
  onPhoto: (album: string, src: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const done = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Find an album or a photo">
      {/* This shadcn version leaves wrapping the contents in <Command> to us. */}
      <Command>
        <CommandInput placeholder="Album, photo name, title or tag…" />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          <CommandGroup heading="Albums">
            {albums.map((album) => (
              <CommandItem key={album.id} value={`album ${album.title} ${album.id}`} onSelect={done(() => onAlbum(album.id))}>
                <FolderOpen />
                {album.title}
                <span className="ml-auto text-xs text-muted-foreground">{album.photos.length}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Photos">
            {albums.flatMap((album) =>
              album.photos.map((photo) => (
                <CommandItem
                  key={photo.src}
                  value={`${refFor(album, photo)} ${photo.title} ${photo.tags.join(' ')}`}
                  onSelect={done(() => onPhoto(album.id, photo.src))}
                >
                  <Thumb album={album.id} photo={photo} className="size-8 rounded object-cover" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{photo.title || <span className="text-muted-foreground italic">Untitled</span>}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{refFor(album, photo)}</span>
                  </span>
                </CommandItem>
              )),
            )}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
