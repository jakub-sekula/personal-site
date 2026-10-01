import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Briefcase, Eye, EyeOff, List, ListChecks, PanelRight, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react';
import { type Cv, type CvEntry, type CvSection, fetchCv, saveCv, uploadCvLogo } from '@editor/lib/content';
import { Badge } from '@editor/components/ui/badge';
import { Button } from '@editor/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@editor/components/ui/dropdown-menu';
import { Input } from '@editor/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@editor/components/ui/resizable';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@editor/components/ui/select';
import { Textarea } from '@editor/components/ui/textarea';
import { cn } from '@editor/lib/utils';
import { Field } from './shared';

// The site's accent colours (--color-js-* in src/styles/global.css).
const ACCENT_COLORS = { green: '#44eaa0', yellow: '#fed557', blue: '#59b8df', red: '#f1647b' } as const;
const KIND = {
  role: { label: 'Role', icon: Briefcase, hint: 'A job, study or project: title, place, years, logo and bullet points' },
  list: { label: 'List', icon: List, hint: 'A titled list, e.g. a group of skills' },
  bullets: { label: 'Bullet points', icon: ListChecks, hint: 'Just bullet points' },
} as const;
const blank = (kind: CvEntry['kind']): CvEntry =>
  kind === 'role' ? { kind, title: '', bullets: [] } : kind === 'list' ? { kind, title: '', items: [] } : { kind, bullets: [] };

/** Logo paths in cv.yaml are relative to it ("../assets/cv/x.jpeg"); Vite serves them in dev. */
const logoUrl = (logo: string) => logo.replace(/^\.\.\//, '/src/');

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function CvEditor({
  jumpTo,
  onSections,
  onDirtyChange,
}: {
  jumpTo?: { index: number };
  onSections?: (titles: string[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [cv, setCv] = useState<Cv | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const [logos, setLogos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    fetchCv()
      .then(({ cv, logos }) => {
        setCv(cv);
        setSavedJson(JSON.stringify(cv));
        setLogos(logos);
      })
      .catch((e) => setError(e.message));
  }, []);
  // The sidebar lists the sections; clicking one scrolls to it here.
  useEffect(() => {
    if (cv) onSections?.(cv.sections.map((s) => s.title || 'Untitled'));
  }, [cv]);
  useEffect(() => {
    if (jumpTo) sectionRefs.current[jumpTo.index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [jumpTo]);

  const dirty = !!cv && JSON.stringify(cv) !== savedJson;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!cv || saving) return;
    setSaving(true);
    try {
      const result = await saveCv(cv);
      setCv(result.cv);
      setSavedJson(JSON.stringify(result.cv));
      setLogos(result.logos);
      toast.success('CV saved', { description: 'src/content/cv.yaml' });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [cv, saving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  if (error) return <p className="p-8 text-destructive">{error}</p>;
  if (!cv) return <p className="p-8 text-muted-foreground">Loading…</p>;

  const setSection = (i: number, section: CvSection) => setCv({ ...cv, sections: cv.sections.map((s, j) => (j === i ? section : s)) });
  const setEntry = (si: number, ei: number, entry: CvEntry) =>
    setSection(si, { ...cv.sections[si], entries: cv.sections[si].entries.map((e, j) => (j === ei ? entry : e)) });

  const form = (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-6">
        <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
          <Field label="PDF" hint="The download button; the file lives in public/">
            <Input value={cv.pdf ?? ''} onChange={(e) => setCv({ ...cv, pdf: e.target.value })} placeholder="/jakub-sekula-cv.pdf" />
          </Field>
          <Field label="LinkedIn">
            <Input value={cv.linkedin ?? ''} onChange={(e) => setCv({ ...cv, linkedin: e.target.value })} placeholder="https://www.linkedin.com/in/…" />
          </Field>
        </div>

        {cv.sections.map((section, si) => (
          <section key={si} ref={(el) => {
              sectionRefs.current[si] = el;
            }} className="scroll-mt-4 rounded-xl border">
            <div className="flex flex-wrap items-end gap-3 border-b p-4">
              <Field label="Section" className="min-w-48 flex-1">
                <Input value={section.title} onChange={(e) => setSection(si, { ...section, title: e.target.value })} />
              </Field>
              <Field label="Accent">
                <Select value={section.accent ?? 'none'} onValueChange={(v) => setSection(si, { ...section, accent: v === 'none' ? undefined : (v as CvSection['accent']) })}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(Object.keys(ACCENT_COLORS) as (keyof typeof ACCENT_COLORS)[]).map((a) => (
                      <SelectItem key={a} value={a}>
                        <span className="size-3 rounded-full" style={{ background: ACCENT_COLORS[a] }} /> {a[0].toUpperCase() + a.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label="Move section up" disabled={si === 0} onClick={() => setCv({ ...cv, sections: move(cv.sections, si, si - 1) })}>
                  <ArrowUp />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Move section down" disabled={si === cv.sections.length - 1} onClick={() => setCv({ ...cv, sections: move(cv.sections, si, si + 1) })}>
                  <ArrowDown />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive"
                  aria-label="Delete section"
                  onClick={() => confirm(`Delete the "${section.title}" section and its ${section.entries.length} entries?`) && setCv({ ...cv, sections: cv.sections.filter((_, j) => j !== si) })}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <div className="flex flex-col divide-y">
              {section.entries.map((entry, ei) => (
                <EntryEditor
                  key={ei}
                  entry={entry}
                  logos={logos}
                  first={ei === 0}
                  last={ei === section.entries.length - 1}
                  onChange={(e) => setEntry(si, ei, e)}
                  onMove={(d) => setSection(si, { ...section, entries: move(section.entries, ei, ei + d) })}
                  onDelete={() => setSection(si, { ...section, entries: section.entries.filter((_, j) => j !== ei) })}
                  onLogoUploaded={(file) => setLogos((l) => [...new Set([...l, file])].sort())}
                />
              ))}
            </div>
            <div className="border-t p-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus /> Add entry
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {(Object.keys(KIND) as CvEntry['kind'][]).map((k) => {
                    const { label, icon: Icon, hint } = KIND[k];
                    return (
                      <DropdownMenuItem key={k} onSelect={() => setSection(si, { ...section, entries: [...section.entries, blank(k)] })}>
                        <Icon />
                        <span className="flex flex-col">
                          <span>{label}</span>
                          <span className="text-xs text-muted-foreground">{hint}</span>
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </section>
        ))}
        <Button variant="outline" onClick={() => setCv({ ...cv, sections: [...cv.sections, { title: 'New section', entries: [] }] })}>
          <Plus /> Add section
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100svh-var(--header-height))] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">CV</h1>
        <Badge variant="outline" className="font-mono">
          src/content/cv.yaml
        </Badge>
        <span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
            <PanelRight /> Preview
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            <Save /> {saving ? 'Saving…' : 'Save'} <kbd className="ml-1 text-[10px] opacity-60">⌘S</kbd>
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {preview ? (
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="55" minSize="35">
              {form}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="45" minSize="20">
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                  <span>/cv {dirty ? '· shows the last save' : ''}</span>
                  <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label="Reload preview" onClick={() => setPreviewKey((k) => k + 1)}>
                    <RefreshCw />
                  </Button>
                </div>
                <iframe key={previewKey} src="/cv" title="Preview" className="min-h-0 flex-1 bg-white" />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          form
        )}
      </div>
    </div>
  );
}

function EntryEditor({
  entry,
  logos,
  first,
  last,
  onChange,
  onMove,
  onDelete,
  onLogoUploaded,
}: {
  entry: CvEntry;
  logos: string[];
  first: boolean;
  last: boolean;
  onChange: (entry: CvEntry) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
  onLogoUploaded: (file: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const { label, icon: Icon } = KIND[entry.kind];
  const lines = (value: string) => value.split('\n');

  return (
    <div className={cn('flex flex-col gap-3 p-4', entry.hidden && 'opacity-60')}>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">
          <Icon /> {label}
        </Badge>
        {entry.hidden && <Badge variant="outline">Hidden on the site</Badge>}
        <div className="ml-auto flex gap-1">
          <Button size="icon" variant="ghost" className="size-7" aria-label={entry.hidden ? 'Show on the site' : 'Hide on the site'} title={entry.hidden ? 'Show on the site' : 'Hide on the site'} onClick={() => onChange({ ...entry, hidden: !entry.hidden })}>
            {entry.hidden ? <EyeOff /> : <Eye />}
          </Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label="Move up" disabled={first} onClick={() => onMove(-1)}>
            <ArrowUp />
          </Button>
          <Button size="icon" variant="ghost" className="size-7" aria-label="Move down" disabled={last} onClick={() => onMove(1)}>
            <ArrowDown />
          </Button>
          <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="Delete entry" onClick={() => confirm('Delete this entry?') && onDelete()}>
            <Trash2 />
          </Button>
        </div>
      </div>

      {entry.kind === 'role' && (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem]">
          <Field label="Title">
            <Input value={entry.title} onChange={(e) => onChange({ ...entry, title: e.target.value })} placeholder="Mechanical Engineer" />
          </Field>
          <Field label="Place">
            <Input value={entry.place ?? ''} onChange={(e) => onChange({ ...entry, place: e.target.value })} placeholder="Company or school" />
          </Field>
          <Field label="Years">
            <Input value={entry.years ?? ''} onChange={(e) => onChange({ ...entry, years: e.target.value })} placeholder="2022 - present" />
          </Field>
          <Field label="Logo" className="sm:col-span-3">
            <div className="flex items-center gap-2">
              <span className="size-9 shrink-0 overflow-hidden rounded-md border bg-muted">
                {entry.logo && <img src={logoUrl(entry.logo)} alt="" className="size-full object-cover" />}
              </span>
              <Select value={entry.logo || 'none'} onValueChange={(v) => onChange({ ...entry, logo: v === 'none' ? '' : v })}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No logo</SelectItem>
                  {logos.map((f) => (
                    <SelectItem key={f} value={`../assets/cv/${f}`}>
                      <img src={`/src/assets/cv/${f}`} alt="" className="size-5 rounded-sm object-cover" /> {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => picker.current?.click()}>
                <Upload /> Upload
              </Button>
              <input
                ref={picker}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  try {
                    const { logo, file: saved } = await uploadCvLogo(file);
                    onLogoUploaded(saved);
                    onChange({ ...entry, logo });
                    toast.success(`Added src/assets/cv/${saved}`);
                  } catch (err) {
                    toast.error((err as Error).message);
                  }
                }}
              />
            </div>
          </Field>
          <Field label="Bullet points" hint="One per line" className="sm:col-span-3">
            <Textarea rows={Math.max(3, (entry.bullets ?? []).length + 1)} value={(entry.bullets ?? []).join('\n')} onChange={(e) => onChange({ ...entry, bullets: lines(e.target.value) })} />
          </Field>
        </div>
      )}
      {entry.kind === 'list' && (
        <div className="grid gap-3">
          <Field label="Title">
            <Input value={entry.title} onChange={(e) => onChange({ ...entry, title: e.target.value })} placeholder="Programming" />
          </Field>
          <Field label="Items" hint="One per line">
            <Textarea rows={Math.max(3, entry.items.length + 1)} value={entry.items.join('\n')} onChange={(e) => onChange({ ...entry, items: lines(e.target.value) })} />
          </Field>
        </div>
      )}
      {entry.kind === 'bullets' && (
        <Field label="Bullet points" hint="One per line">
          <Textarea rows={Math.max(3, entry.bullets.length + 1)} value={entry.bullets.join('\n')} onChange={(e) => onChange({ ...entry, bullets: lines(e.target.value) })} />
        </Field>
      )}
    </div>
  );
}
