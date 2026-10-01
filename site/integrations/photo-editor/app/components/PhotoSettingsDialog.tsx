import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, RotateCcw, X } from 'lucide-react';
import { type Album, type PhotoSettings, type SettingsInfo, fetchSettings, plural, saveSettings } from '@editor/lib/api';
import { Badge } from '@editor/components/ui/badge';
import { Button } from '@editor/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@editor/components/ui/dialog';
import { Input } from '@editor/components/ui/input';
import { Field } from './shared';

/**
 * The sizes every photo is resized to and the encoding quality (photos.config.json).
 * Applies to photos added from now on; existing ones are remade by adding their originals again.
 */
export function PhotoSettingsDialog({
  albums,
  open,
  onOpenChange,
  onSaved,
}: {
  albums: Album[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [form, setForm] = useState<PhotoSettings | null>(null);
  const [newWidth, setNewWidth] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setNewWidth('');
    fetchSettings().then(
      (i) => {
        setInfo(i);
        setForm(i.config);
      },
      (e) => setError(e.message),
    );
  }, [open]);

  const changed = !!info && !!form && JSON.stringify(form) !== JSON.stringify(info.config);
  const outdatedTotal = info ? Object.values(info.outdated).reduce((a, b) => a + b, 0) : 0;
  const albumTitle = (id: string) => albums.find((a) => a.id === id)?.title ?? id;

  const addWidth = () => {
    if (!form || !info) return;
    const w = Number(newWidth);
    const [min, max] = info.limits.width;
    if (!Number.isInteger(w) || w < min || w > max) return setError(`Sizes must be whole numbers from ${min} to ${max} px`);
    if (form.widths.includes(w)) return setNewWidth('');
    setError('');
    setForm({ ...form, widths: [...form.widths, w].sort((a, b) => a - b) });
    setNewWidth('');
  };

  async function save() {
    if (!form) return;
    setSaving(true);
    setError('');
    try {
      const i = await saveSettings(form);
      setInfo(i);
      setForm(i.config);
      onSaved();
      toast.success('Photo settings saved', { description: 'photos.config.json' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Photo settings</DialogTitle>
          <DialogDescription>How photos are resized when you add them. Saved in photos.config.json (commit it with your photos).</DialogDescription>
        </DialogHeader>
        {!form || !info ? (
          <p className="text-sm text-muted-foreground">{error || 'Loading…'}</p>
        ) : (
          <div className="flex flex-col gap-5">
            <Field
              label="Sizes (width in px)"
              hint={`Every photo gets an AVIF and a WebP at each size up to its own width (a ${form.widths.at(-1)} px limit; a smaller photo also gets one at its own width). Browsers pick the one the screen needs; the largest is for zooming in the lightbox.`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {form.widths.map((w) => (
                  <Badge key={w} variant="secondary" className="h-7 gap-1 pr-1 text-sm tabular-nums">
                    {w}
                    <button
                      type="button"
                      className="rounded-sm p-0.5 hover:bg-background/60 disabled:opacity-30"
                      aria-label={`Remove ${w}`}
                      disabled={form.widths.length === 1}
                      onClick={() => setForm({ ...form, widths: form.widths.filter((x) => x !== w) })}
                    >
                      <X className="size-3.5" />
                    </button>
                  </Badge>
                ))}
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={newWidth}
                    placeholder="e.g. 3840"
                    className="h-7 w-28"
                    onChange={(e) => setNewWidth(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addWidth();
                      }
                    }}
                    aria-label="Add a size"
                  />
                  <Button type="button" size="sm" variant="outline" className="h-7" onClick={addWidth} disabled={form.widths.length >= info.limits.count}>
                    <Plus /> Add
                  </Button>
                </div>
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="AVIF quality" hint={`${info.limits.quality[0]}–${info.limits.quality[1]}; default ${info.defaults.avifQuality}. AVIF looks good at lower numbers.`}>
                <Input type="number" value={form.avifQuality} onChange={(e) => setForm({ ...form, avifQuality: Number(e.target.value) })} />
              </Field>
              <Field label="WebP quality" hint={`${info.limits.quality[0]}–${info.limits.quality[1]}; default ${info.defaults.webpQuality}.`}>
                <Input type="number" value={form.webpQuality} onChange={(e) => setForm({ ...form, webpQuality: Number(e.target.value) })} />
              </Field>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Existing photos</p>
              <p className="mt-1 text-muted-foreground">
                Changes apply to photos you add from now on. Existing photos keep their files (originals aren't stored, so they can't be
                remade on their own): to remake one at the new sizes, drop its original file on its album again. It stays the same photo
                at the same address.
              </p>
              <p className="mt-2">
                {outdatedTotal
                  ? `${plural(outdatedTotal, 'photo')} of ${info.photos} aren't at the saved sizes yet:`
                  : `All ${info.photos} photos are at the saved sizes.`}
              </p>
              {outdatedTotal > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {Object.entries(info.outdated).map(([id, n]) => (
                    <li key={id}>
                      <Badge variant="outline">
                        {albumTitle(id)}: {n}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={!form || !info || JSON.stringify(form) === JSON.stringify(info.defaults)}
            onClick={() => info && setForm(info.defaults)}
          >
            <RotateCcw /> Defaults
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="button" onClick={save} disabled={!changed || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
