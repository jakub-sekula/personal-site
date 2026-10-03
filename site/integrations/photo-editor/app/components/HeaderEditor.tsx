import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Save, Trash2, X } from 'lucide-react';
import { type Album, albumThumb } from '@editor/lib/api';
import { type Accent, type HeaderData, type HeaderItem, type HeaderMenu, type PostSummary, fetchHeader, saveHeader } from '@editor/lib/content';
import { Badge } from '@editor/components/ui/badge';
import { Button } from '@editor/components/ui/button';
import { Input } from '@editor/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@editor/components/ui/select';
import { Switch } from '@editor/components/ui/switch';
import { cn } from '@editor/lib/utils';
import { Field, Thumb } from './shared';

// The site's accent colours (--color-js-* in src/styles/global.css).
const ACCENT_COLORS: Record<Accent, string> = { green: '#44eaa0', yellow: '#fed557', blue: '#59b8df', red: '#f1647b' };
const MENUS: Record<HeaderMenu, { label: string; auto: string; limit: number }> = {
  projects: { label: 'Projects', auto: 'The featured projects', limit: 4 },
  photography: { label: 'Albums', auto: "The photography sidebar's albums", limit: 6 },
  blog: { label: 'Posts', auto: 'The latest posts', limit: 4 },
};

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/** Something a menu can show: a project, album or post. */
interface Option {
  id: string;
  title: string;
  sub: string;
  draft: boolean;
  thumb?: React.ReactNode;
}

export function HeaderEditor({
  albums,
  posts,
  jumpTo,
  onItems,
  onDirtyChange,
}: {
  albums: Album[];
  posts: PostSummary[] | null;
  jumpTo?: { index: number };
  onItems?: (labels: string[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [data, setData] = useState<HeaderData | null>(null);
  const [items, setItems] = useState<HeaderItem[]>([]);
  const [savedJson, setSavedJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  const loaded = (result: HeaderData) => {
    setData(result);
    setItems(result.header.items);
    setSavedJson(JSON.stringify(result.header.items));
  };
  useEffect(() => {
    fetchHeader()
      .then(loaded)
      .catch((e) => setError(e.message));
  }, []);
  // The sidebar lists the items; clicking one scrolls to it here.
  useEffect(() => {
    if (data) onItems?.(items.map((i) => i.label || 'Untitled'));
  }, [items, data]);
  useEffect(() => {
    if (jumpTo) itemRefs.current[jumpTo.index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [jumpTo]);

  const dirty = !!data && JSON.stringify(items) !== savedJson;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!data || saving) return;
    setSaving(true);
    try {
      loaded(await saveHeader({ items }));
      toast.success('Header saved', { description: 'src/content/header.yaml' });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [data, items, saving]);

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
  if (!data) return <p className="p-8 text-muted-foreground">Loading…</p>;

  // What each kind of menu can show, and what it shows when nothing is picked.
  const options: Record<HeaderMenu, Option[]> = {
    projects: data.projects.map((p) => ({
      id: p.id,
      title: p.title,
      sub: [p.type, p.featured && 'featured'].filter(Boolean).join(' · '),
      draft: p.draft,
      thumb: p.cover ? <img src={p.cover} alt="" className="size-full object-cover" /> : undefined,
    })),
    photography: albums.map((a) => {
      const thumb = albumThumb(a, albums);
      return {
        id: a.id,
        title: a.title,
        sub: a.isCollection ? `Collection · ${a.children.length} albums` : `${a.photos.length} photos`,
        draft: a.draft,
        thumb: thumb ? <Thumb album={thumb.album} photo={thumb.photo} className="size-full object-cover" /> : undefined,
      };
    }),
    blog: (posts ?? []).map((p) => ({ id: p.slug, title: p.title, sub: p.date, draft: p.draft })),
  };
  const automatic: Record<HeaderMenu, string[]> = {
    projects: data.projects.filter((p) => p.featured && !p.draft && p.listed).map((p) => p.id),
    photography: data.sidebar.filter((id) => albums.some((a) => a.id === id && !a.draft)),
    blog: (posts ?? []).filter((p) => !p.draft).map((p) => p.slug),
  };

  const setItem = (i: number, item: HeaderItem) => setItems(items.map((it, j) => (j === i ? item : it)));

  const form = (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-6">
        {items.map((item, i) => (
          <section
            key={i}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className={cn('scroll-mt-4 rounded-xl border', item.hidden && 'opacity-60')}
          >
            <div className="flex flex-wrap items-end gap-3 border-b p-4">
              <Field label="Label" className="min-w-36 flex-1">
                <Input value={item.label} onChange={(e) => setItem(i, { ...item, label: e.target.value })} />
              </Field>
              <Field label="Link" className="min-w-36 flex-1">
                <Input value={item.href} onChange={(e) => setItem(i, { ...item, href: e.target.value })} placeholder="/projects" />
              </Field>
              <Field label="Accent">
                <Select value={item.accent ?? 'none'} onValueChange={(v) => setItem(i, { ...item, accent: v === 'none' ? undefined : (v as Accent) })}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(Object.keys(ACCENT_COLORS) as Accent[]).map((a) => (
                      <SelectItem key={a} value={a}>
                        <span className="size-3 rounded-full" style={{ background: ACCENT_COLORS[a] }} /> {a[0].toUpperCase() + a.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={item.hidden ? 'Show in the header' : 'Hide from the header'}
                  title={item.hidden ? 'Show in the header' : 'Hide from the header'}
                  onClick={() => setItem(i, { ...item, hidden: !item.hidden })}
                >
                  {item.hidden ? <EyeOff /> : <Eye />}
                </Button>
                <Button size="icon" variant="ghost" aria-label="Move up" title="Earlier in the header" disabled={i === 0} onClick={() => setItems(move(items, i, i - 1))}>
                  <ArrowUp />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Move down" title="Later in the header" disabled={i === items.length - 1} onClick={() => setItems(move(items, i, i + 1))}>
                  <ArrowDown />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive"
                  aria-label="Delete item"
                  onClick={() => confirm(`Remove "${item.label}" from the header?`) && setItems(items.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>

            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Menu" hint={item.menu ? 'Opens on hover; clicking the label still goes to the link' : 'A plain link'}>
                <Select
                  value={item.menu ?? 'none'}
                  onValueChange={(v) => setItem(i, { ...item, menu: v === 'none' ? undefined : (v as HeaderMenu), pick: [], limit: undefined })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No menu</SelectItem>
                    {(Object.keys(MENUS) as HeaderMenu[]).map((m) => (
                      <SelectItem key={m} value={m}>
                        {MENUS[m].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Badge" hint={item.menu === 'blog' ? 'Shown next to the label (besides the automatic "New")' : 'Shown next to the label, e.g. "New"'}>
                <Input value={item.badge ?? ''} onChange={(e) => setItem(i, { ...item, badge: e.target.value })} />
              </Field>

              {item.menu && (
                <>
                  <Field label="Heading">
                    <Input value={item.heading ?? ''} onChange={(e) => setItem(i, { ...item, heading: e.target.value })} />
                  </Field>
                  <Field label="Subheading">
                    <Input value={item.subheading ?? ''} onChange={(e) => setItem(i, { ...item, subheading: e.target.value })} />
                  </Field>
                  <Field label="“All” link text">
                    <Input value={item.allLabel ?? ''} onChange={(e) => setItem(i, { ...item, allLabel: e.target.value })} placeholder={`All ${item.label.toLowerCase()}`} />
                  </Field>
                  <Field label="Show at most" hint={`Default ${MENUS[item.menu].limit}`}>
                    <Input
                      type="number"
                      min={1}
                      max={12}
                      value={item.limit ?? ''}
                      placeholder={String(MENUS[item.menu].limit)}
                      onChange={(e) => setItem(i, { ...item, limit: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </Field>
                  {item.menu === 'blog' && (
                    <label className="flex items-center gap-2 text-sm sm:col-span-2">
                      <Switch checked={item.newBadge !== false} onCheckedChange={(v) => setItem(i, { ...item, newBadge: v ? undefined : false })} />
                      “New” badge while the latest post is under six weeks old
                    </label>
                  )}
                  <PickList
                    className="sm:col-span-2"
                    menu={item.menu}
                    options={options[item.menu]}
                    automatic={automatic[item.menu]}
                    limit={item.limit ?? MENUS[item.menu].limit}
                    value={item.pick ?? []}
                    onChange={(pick) => setItem(i, { ...item, pick })}
                  />
                </>
              )}
            </div>
          </section>
        ))}
        <Button variant="outline" onClick={() => setItems([...items, { label: 'New item', href: '/' }])}>
          <Plus /> Add item
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100svh-var(--header-height))] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Header</h1>
        <Badge variant="outline" className="font-mono">
          src/content/header.yaml
        </Badge>
        <span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            <Save /> {saving ? 'Saving…' : 'Save'} <kbd className="ml-1 text-[10px] opacity-60">⌘S</kbd>
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1">{form}</div>
    </div>
  );
}

/** What a menu shows: the automatic list, or projects/albums/posts picked in order. */
function PickList({
  menu,
  options,
  automatic,
  limit,
  value,
  onChange,
  className,
}: {
  menu: HeaderMenu;
  options: Option[];
  automatic: string[];
  limit: number;
  value: string[];
  onChange: (pick: string[]) => void;
  className?: string;
}) {
  const [chosen, setChosen] = useState(value.length > 0);
  const byId = (id: string) => options.find((o) => o.id === id);
  const list = chosen ? value : automatic;
  const remaining = options.filter((o) => !value.includes(o.id));
  const noun = MENUS[menu].label.toLowerCase();

  return (
    <div className={cn('flex flex-col gap-2 text-sm', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Shows</span>
        <Select
          value={chosen ? 'chosen' : 'auto'}
          onValueChange={(v) => {
            setChosen(v === 'chosen');
            // Start from what it shows now, to reorder or trim.
            onChange(v === 'chosen' ? automatic.slice(0, limit) : []);
          }}
        >
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{MENUS[menu].auto}</SelectItem>
            <SelectItem value="chosen">Chosen {noun}</SelectItem>
          </SelectContent>
        </Select>
        {list.length > limit && <span className="text-xs text-muted-foreground">The first {limit} show (Show at most)</span>}
      </div>
      {menu === 'photography' && <p className="text-xs text-muted-foreground">Collections show first, in a group of their own, then albums; each in this order.</p>}

      <ol className="flex flex-col divide-y rounded-lg border">
        {list.length === 0 && <li className="p-3 text-muted-foreground">{chosen ? `No ${noun} chosen yet: shows ${MENUS[menu].auto.toLowerCase()}.` : `None yet: the menu is left out.`}</li>}
        {list.map((id, i) => {
          const o = byId(id);
          return (
            <li key={id} className={cn('flex items-center gap-3 p-2', i >= limit && 'opacity-45')}>
              <span className="flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-xs text-muted-foreground">
                {o?.thumb ?? i + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{o?.title ?? id}</span>
                <span className="truncate text-xs text-muted-foreground">{o ? o.sub : 'Not found: skipped on the site'}</span>
              </span>
              {o?.draft && <Badge variant="outline">draft</Badge>}
              {chosen && (
                <span className="ml-auto flex gap-0.5">
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Move up" disabled={i === 0} onClick={() => onChange(move(value, i, i - 1))}>
                    <ArrowUp />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" aria-label="Move down" disabled={i === value.length - 1} onClick={() => onChange(move(value, i, i + 1))}>
                    <ArrowDown />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${o?.title ?? id}`} onClick={() => onChange(value.filter((v) => v !== id))}>
                    <X />
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {chosen && remaining.length > 0 && (
        <Select value="" onValueChange={(id) => onChange([...value, id])}>
          <SelectTrigger size="sm" className="w-56">
            <SelectValue placeholder={`Add ${noun.replace(/s$/, '')}…`} />
          </SelectTrigger>
          <SelectContent>
            {remaining.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.title}
                {o.draft && <span className="text-xs text-muted-foreground">draft</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
