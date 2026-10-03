import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Plus, Save, Trash2 } from 'lucide-react';
import { slugify } from '@editor/lib/api';
import { type Category, type PostSummary, fetchCategories, saveCategories, saveProjectOrder } from '@editor/lib/content';
import { Badge } from '@editor/components/ui/badge';
import { Button } from '@editor/components/ui/button';
import { Input } from '@editor/components/ui/input';
import { cn } from '@editor/lib/utils';

/** A category being edited: `isNew` ones take their id from the name until saved. */
type Row = Category & { isNew?: boolean };

/** The Projects section's front page: the categories, and the projects' order on the site. */
export function ProjectsOverview({
  projects,
  onOpen,
  onChanged,
  onDirtyChange,
}: {
  projects: PostSummary[] | null;
  onOpen: (slug: string) => void;
  /** After saving: the projects' categories or order changed. */
  onChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [savedJson, setSavedJson] = useState('');
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<string[]>([]);

  const loaded = (categories: Category[]) => {
    setRows(categories);
    setSavedJson(JSON.stringify(categories));
  };
  useEffect(() => {
    fetchCategories().then(loaded, (e) => toast.error(e.message));
  }, []);
  useEffect(() => {
    if (projects) setOrder(projects.map((p) => p.slug));
  }, [projects]);

  const dirty = !!rows && JSON.stringify(rows.map(({ isNew, ...c }) => c)) !== savedJson;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!rows || saving) return;
    setSaving(true);
    try {
      loaded(await saveCategories(rows.map(({ isNew, ...c }) => c)));
      toast.success('Categories saved', { description: 'src/content/project-categories.yaml' });
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [rows, saving]);
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );
  // The order saves as soon as a project is dropped (as albums in a collection do).
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setOrder(next);
    try {
      await saveProjectOrder(next);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
      setOrder(order);
    }
  };

  if (!rows || !projects) return <p className="p-8 text-muted-foreground">Loading…</p>;

  const used = (id: string) => projects.filter((p) => p.category === id).length;
  const setRow = (i: number, row: Row) => setRows(rows.map((r, j) => (j === i ? row : r)));
  const move = (i: number, d: number) => {
    const next = [...rows];
    next.splice(i + d, 0, next.splice(i, 1)[0]);
    setRows(next);
  };
  const label = (id?: string) => rows.find((c) => c.id === id);

  return (
    <div className="flex min-h-[calc(100svh-var(--header-height))] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
        <Badge variant="outline" className="font-mono">
          src/content/project-categories.yaml
        </Badge>
        <span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <Button size="sm" className="ml-auto" onClick={save} disabled={!dirty || saving}>
          <Save /> {saving ? 'Saving…' : 'Save'} <kbd className="ml-1 text-[10px] opacity-60">⌘S</kbd>
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 md:p-6">
        <section className="rounded-xl border">
          <div className="border-b p-4">
            <h2 className="font-semibold">Categories</h2>
            <p className="text-sm text-muted-foreground">
              The filter buttons on /projects, in this order. A hidden category's projects aren't listed anywhere on the site; their pages still work.
            </p>
          </div>
          <ul className="divide-y">
            {rows.map((row, i) => {
              const count = used(row.id);
              return (
                <li key={i} className={cn('flex flex-wrap items-center gap-3 p-3', row.hidden && 'opacity-60')}>
                  <Input
                    className="max-w-56"
                    value={row.label}
                    aria-label="Category name"
                    onChange={(e) => setRow(i, { ...row, label: e.target.value, ...(row.isNew && { id: slugify(e.target.value) }) })}
                  />
                  <code className="text-xs text-muted-foreground">{row.id || '…'}</code>
                  <span className="text-xs text-muted-foreground">{count === 1 ? '1 project' : `${count} projects`}</span>
                  {row.hidden && <Badge variant="outline">Hidden</Badge>}
                  <span className="ml-auto flex gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={row.hidden ? `Show ${row.label}` : `Hide ${row.label}`}
                      title={row.hidden ? 'Show on the site' : 'Hide from the site'}
                      onClick={() => setRow(i, { ...row, hidden: !row.hidden })}
                    >
                      {row.hidden ? <EyeOff /> : <Eye />}
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive"
                      aria-label={`Delete ${row.label}`}
                      title={count ? 'Move its projects to another category first' : 'Delete'}
                      disabled={count > 0}
                      onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="border-t p-3">
            <Button size="sm" variant="outline" onClick={() => setRows([...rows, { id: '', label: '', hidden: false, isNew: true }])}>
              <Plus /> Add category
            </Button>
          </div>
        </section>

        <section className="rounded-xl border">
          <div className="border-b p-4">
            <h2 className="font-semibold">Order on the projects page</h2>
            <p className="text-sm text-muted-foreground">Drag to reorder; it saves when you drop. Click one to edit it.</p>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={verticalListSortingStrategy}>
              <ol className="divide-y">
                {order.map((slug) => {
                  const p = projects.find((x) => x.slug === slug);
                  if (!p) return null;
                  const category = label(p.category);
                  return <ProjectRow key={slug} project={p} category={category?.label ?? p.category ?? ''} hidden={!!category?.hidden} onOpen={() => onOpen(slug)} />;
                })}
              </ol>
            </SortableContext>
          </DndContext>
        </section>
      </div>
    </div>
  );
}

function ProjectRow({ project: p, category, hidden, onOpen }: { project: PostSummary; category: string; hidden: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.slug });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-3 bg-background p-2 pr-3', isDragging && 'relative z-10 shadow-lg', hidden && 'opacity-60')}
    >
      <button type="button" className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted" aria-label={`Drag ${p.title}`} {...attributes} {...listeners}>
        <GripVertical className="size-4" />
      </button>
      <span className="h-9 w-14 shrink-0 overflow-hidden rounded-md border bg-muted">{p.coverUrl && <img src={p.coverUrl} alt="" className="size-full object-cover" />}</span>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-col text-left hover:underline">
        <span className="truncate font-medium">{p.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {category}
          {hidden && ' (hidden)'}
        </span>
      </button>
      <span className="ml-auto flex gap-1.5">
        {p.featured && <Badge variant="secondary">Featured</Badge>}
        {p.draft && <Badge variant="outline">draft</Badge>}
      </span>
    </li>
  );
}
