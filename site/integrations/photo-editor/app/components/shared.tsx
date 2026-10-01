import { useState } from 'react';
import { toast } from 'sonner';
import { type Album, type Photo, photoUrl } from '@editor/lib/api';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@editor/components/ui/select';
import { cn } from '@editor/lib/utils';

/** A photo from the local copies, falling back to R2 when it isn't on this machine. */
export function Thumb({ album, photo, width, className }: { album: string; photo: Pick<Photo, 'id' | 'thumb'>; width?: number; className?: string }) {
  const { local, remote } = photoUrl(album, photo, width);
  const [src, setSrc] = useState(local);
  return <img src={src} onError={() => src !== remote && setSrc(remote)} alt="" loading="lazy" draggable={false} className={cn('select-none', className)} />;
}

export async function copy(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success('Copied', { description: text.length > 80 ? `${text.slice(0, 77)}…` : text });
}

/** Where an album is listed: nowhere, the photography sidebar and page, or inside a group album. */
export function ListingSelect({
  albums,
  self,
  value,
  onChange,
  topOnly = false,
}: {
  albums: Album[];
  self?: string;
  value: string;
  onChange: (value: string) => void;
  /** For collections, which can't go inside another collection. */
  topOnly?: boolean;
}) {
  const groups = topOnly ? [] : albums.filter((a) => a.isCollection && a.id !== self);
  return (
    <Select value={value || 'none'} onValueChange={(v) => onChange(v === 'none' ? '' : v)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Not listed (reachable by its address only)</SelectItem>
        <SelectItem value="top">Photography sidebar and page</SelectItem>
        {groups.length > 0 && (
          <SelectGroup>
            <SelectLabel>Inside a collection</SelectLabel>
            {groups.map((g) => (
              <SelectItem key={g.id} value={`in:${g.id}`}>
                Inside {g.title}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

/** A labelled form row. */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('flex flex-col gap-1.5 text-sm', className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
