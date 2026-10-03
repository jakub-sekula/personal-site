import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { keymap } from '@codemirror/view';
import {
  Bold,
  Code,
  ExternalLink,
  Heading2,
  ImageIcon,
  Images,
  Italic,
  Link,
  List,
  PanelRight,
  Quote,
  RefreshCw,
  Rows3,
  Save,
  Settings2,
  Square,
  SquareSplitHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { type Album } from '@editor/lib/api';
import {
  type Accent,
  type Category,
  type Kind,
  KINDS,
  type Post,
  type PostSummary,
  type Tool,
  deletePost,
  fetchCategories,
  fetchPost,
  fetchTools,
  savePost,
  uploadPostImage,
} from '@editor/lib/content';
import { Checkbox } from '@editor/components/ui/checkbox';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@editor/components/ui/dropdown-menu';
import { Input } from '@editor/components/ui/input';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@editor/components/ui/resizable';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@editor/components/ui/select';
import { Separator } from '@editor/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@editor/components/ui/sheet';
import { Switch } from '@editor/components/ui/switch';
import { Textarea } from '@editor/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@editor/components/ui/tooltip';
import { Field } from './shared';
import { PhotoPicker } from './PhotoPicker';

// A project is a post with a few extras, edited here too (`kind`).
type Fields = Pick<
  Post,
  | 'title'
  | 'description'
  | 'date'
  | 'tags'
  | 'cover'
  | 'coverPhoto'
  | 'format'
  | 'draft'
  | 'category'
  | 'color'
  | 'featured'
  | 'coverSmall'
  | 'github'
  | 'demo'
  | 'tools'
  | 'posts'
>;
const fieldsOf = (p: Post): Fields => ({
  title: p.title,
  description: p.description,
  date: p.date,
  tags: p.tags,
  cover: p.cover,
  coverPhoto: p.coverPhoto,
  format: p.format,
  draft: p.draft,
  category: p.category,
  color: p.color,
  featured: p.featured,
  coverSmall: p.coverSmall,
  github: p.github,
  demo: p.demo,
  tools: p.tools,
  posts: p.posts,
});

// The site's accent colours (--color-js-* in src/styles/global.css).
const ACCENT_COLORS: Record<Accent, string> = { green: '#44eaa0', yellow: '#fed557', blue: '#59b8df', red: '#f1647b' };

type Picker = { kind: 'photo' | 'row' | 'gallery' | 'side' | 'cover' | 'coverPhoto' } | null;

const dark = () => document.documentElement.classList.contains('dark');

export function PostEditor({
  kind = 'blog',
  slug,
  albums,
  posts = [],
  onSaved,
  onDeleted,
  onDirtyChange,
}: {
  kind?: Kind;
  slug: string;
  albums: Album[];
  /** For a project's related posts. */
  posts?: PostSummary[];
  onSaved: () => void;
  onDeleted: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { noun, url, dir } = KINDS[kind];
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  const pageUrl = `${url}/${slug}`;
  const [categories, setCategories] = useState<Category[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const coverInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (kind !== 'projects') return;
    fetchCategories().then(setCategories, (e) => toast.error(e.message));
    fetchTools().then(setTools, (e) => toast.error(e.message));
  }, [kind]);
  const [post, setPost] = useState<Post | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState<{ fields: Fields; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const [preview, setPreview] = useState(true);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const view = useRef<EditorView | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  // A post that was just created takes Astro a moment to pick up: wait until its page
  // renders before showing the preview (instead of an error).
  useEffect(() => {
    let cancelled = false;
    setPreviewReady(false);
    (async () => {
      for (let i = 0; i < 25 && !cancelled; i++) {
        const ok = await fetch(pageUrl, { cache: 'no-store' }).then((r) => r.ok, () => false);
        if (ok) break;
        await new Promise((r) => setTimeout(r, 400));
      }
      if (!cancelled) setPreviewReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    setPost(null);
    setError('');
    fetchPost(kind, slug)
      .then((p) => {
        setPost(p);
        setFields(fieldsOf(p));
        setBody(p.body);
        setSaved({ fields: fieldsOf(p), body: p.body });
      })
      .catch((e) => setError(e.message));
  }, [kind, slug]);

  const dirty = !!saved && !!fields && (body !== saved.body || JSON.stringify(fields) !== JSON.stringify(saved.fields));
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!fields || saving) return;
    setSaving(true);
    try {
      const p = await savePost(kind, slug, fields, body);
      setPost(p);
      setSaved({ fields: fieldsOf(p), body });
      setFields(fieldsOf(p));
      onSaved();
      toast.success('Saved', { description: p.file });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [fields, body, kind, slug, saving]);

  // ⌘S / Ctrl+S saves.
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
  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  // --- Editing helpers ---------------------------------------------------------------
  /** Wrap the selection (or a placeholder) in before/after. */
  const wrap = (before: string, after = before, placeholder = 'text') => {
    const v = view.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    const selected = v.state.sliceDoc(from, to) || placeholder;
    v.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + before.length, head: from + before.length + selected.length },
    });
    v.focus();
  };
  /** Prefix the selected lines (headings, lists, quotes). */
  const prefixLines = (prefix: string) => {
    const v = view.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    const changes = [];
    for (let pos = from; pos <= to; ) {
      const line = v.state.doc.lineAt(pos);
      changes.push({ from: line.from, insert: prefix });
      pos = line.to + 1;
    }
    v.dispatch({ changes });
    v.focus();
  };
  /** Insert a block on its own lines at the cursor. */
  const insertBlock = (text: string) => {
    const v = view.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    const line = v.state.doc.lineAt(from);
    const before = line.text.trim() ? '\n\n' : '';
    const insert = `${before}${text}\n\n`;
    v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
    v.focus();
  };

  // ⌘B / ⌘I in the editor (they read the editor through the ref, so build them once).
  const shortcuts = useMemo(
    () =>
      keymap.of([
        { key: 'Mod-b', run: () => (wrap('**'), true) },
        { key: 'Mod-i', run: () => (wrap('*'), true) },
      ]),
    [],
  );

  const onPicked = (refs: string[]) => {
    const list = refs.map((r) => `'${r}'`).join(', ');
    switch (picker?.kind) {
      case 'photo':
        return insertBlock(`<Photo src="${refs[0]}" />`);
      case 'row':
        return insertBlock(`<Row photos={[${list}]} />`);
      case 'gallery':
        return insertBlock(`<Gallery photos={[${refs.map((r) => `{ src: '${r}' }`).join(', ')}]} />`);
      case 'side':
        return insertBlock(`<Side photo="${refs[0]}">\n\nText beside the photo.\n\n</Side>`);
      case 'cover':
        return insertBlock(`<Cover photo="${refs[0]}">\n\n## A chapter title\n\n</Cover>`);
      case 'coverPhoto':
        setFields((f) => f && { ...f, coverPhoto: refs[0] });
    }
  };

  async function uploadImages(files: File[]) {
    for (const file of files) {
      try {
        const { path } = await uploadPostImage(kind, slug, file);
        insertBlock(`![${file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')}](${path})`);
        setPost((p) => p && { ...p, images: [...p.images, path.slice(2)] });
        toast.success(`Added ${path.slice(2)} next to the ${noun}`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  }

  if (error) return <p className="p-8 text-destructive">{error}</p>;
  if (!post || !fields) return <p className="p-8 text-muted-foreground">Loading…</p>;

  const components = post.mdx;
  const tool = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={label} disabled={disabled} onClick={onClick}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  const editor = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1">
        {tool('Bold (⌘B)', <Bold />, () => wrap('**'))}
        {tool('Italic (⌘I)', <Italic />, () => wrap('*'))}
        {tool('Heading', <Heading2 />, () => prefixLines('## '))}
        {tool('Link', <Link />, () => wrap('[', '](https://)', 'link text'))}
        {tool('List', <List />, () => prefixLines('- '))}
        {tool('Quote', <Quote />, () => prefixLines('> '))}
        {tool('Code', <Code />, () => wrap('`'))}
        <Separator orientation="vertical" className="mx-1 h-5" />
        {tool(`Upload an image (saved next to the ${noun})`, <Upload />, () => imageInput.current?.click(), !post.file.includes('/index.'))}
        <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => uploadImages([...(e.target.files ?? [])]).finally(() => (e.target.value = ''))} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost" className="h-8" disabled={!components}>
              <Images /> Insert photos
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>From the photo library</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setPicker({ kind: 'photo' })}>
              <ImageIcon /> Photo
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPicker({ kind: 'row' })}>
              <Rows3 /> Row (side by side, same height)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPicker({ kind: 'gallery' })}>
              <Images /> Gallery (justified rows)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPicker({ kind: 'side' })}>
              <SquareSplitHorizontal /> Photo beside text
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPicker({ kind: 'cover' })}>
              <Square /> Full-screen cover
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!components && <span className="ml-2 text-xs text-muted-foreground">Plain Markdown (.md): photo components need an .mdx {noun}</span>}
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          uploadImages([...e.dataTransfer.files]);
        }}
      >
        <CodeMirror
          value={body}
          onChange={setBody}
          theme={dark() ? 'dark' : 'light'}
          extensions={[markdown({ base: markdownLanguage, codeLanguages: languages }), EditorView.lineWrapping, shortcuts]}
          basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
          onCreateEditor={(v) => (view.current = v)}
          className="h-full text-[15px] [&_.cm-content]:px-4 [&_.cm-content]:py-4 [&_.cm-content]:font-mono [&_.cm-editor]:h-full [&_.cm-editor]:bg-transparent [&_.cm-editor.cm-focused]:outline-none"
          height="100%"
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100svh-var(--header-height))] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <h1 className="truncate text-xl font-semibold tracking-tight">{fields.title || 'Untitled'}</h1>
        {fields.draft && <Badge variant="destructive">Draft</Badge>}
        {fields.format === 'story' && <Badge variant="secondary">Story</Badge>}
        {kind === 'projects' && (
          <Badge variant="outline">
            {categories.find((c) => c.id === fields.category)?.label ?? fields.category}
            {categories.find((c) => c.id === fields.category)?.hidden && ' (hidden)'}
          </Badge>
        )}
        {fields.featured && <Badge variant="secondary">Featured</Badge>}
        <Badge variant="outline" className="font-mono">
          {post.file.replace(`${dir}/`, '')}
        </Badge>
        <span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'Saved'}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setDetails(true)}>
            <Settings2 /> Details
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
            <PanelRight /> Preview
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={pageUrl} target="_blank">
              <ExternalLink /> View
            </a>
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            <Save /> {saving ? 'Saving…' : 'Save'} <kbd className="ml-1 text-[10px] opacity-60">⌘S</kbd>
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {preview ? (
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="55" minSize="30">
              {editor}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="45" minSize="20">
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                  <span className="truncate">
                    {pageUrl} {dirty ? '· shows the last save' : ''}
                  </span>
                  <Button size="icon" variant="ghost" className="ml-auto size-7" aria-label="Reload preview" onClick={() => setPreviewKey((k) => k + 1)}>
                    <RefreshCw />
                  </Button>
                </div>
                {/* The real page (drafts show in dev); it reloads by itself after a save. */}
                {previewReady ? (
                  <iframe key={previewKey} src={pageUrl} title="Preview" className="min-h-0 flex-1 bg-white" />
                ) : (
                  <p className="p-6 text-sm text-muted-foreground">Preparing the preview…</p>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          editor
        )}
      </div>

      <Sheet open={details} onOpenChange={setDetails}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{Noun} details</SheetTitle>
            <SheetDescription>Saved with the {noun} (⌘S).</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-6">
            <Field label="Title">
              <Input value={fields.title} onChange={(e) => setFields({ ...fields, title: e.target.value })} />
            </Field>
            <Field label="Description" hint="Under the title in lists, and in link previews">
              <Textarea rows={3} value={fields.description} onChange={(e) => setFields({ ...fields, description: e.target.value })} />
            </Field>
            {kind === 'projects' && (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Category" hint={categories.find((c) => c.id === fields.category)?.hidden ? 'Hidden: not listed on the site' : undefined}>
                  <Select value={fields.category ?? ''} onValueChange={(v) => setFields({ ...fields, category: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose…" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.label}
                          {c.hidden && <span className="text-xs text-muted-foreground">hidden</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Colour">
                  <Select value={fields.color ?? 'green'} onValueChange={(v) => setFields({ ...fields, color: v as Accent })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ACCENT_COLORS) as Accent[]).map((a) => (
                        <SelectItem key={a} value={a}>
                          <span className="size-3 rounded-full" style={{ background: ACCENT_COLORS[a] }} /> {a[0].toUpperCase() + a.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
            <Field label="Date">
              <Input type="date" value={fields.date} onChange={(e) => setFields({ ...fields, date: e.target.value })} />
            </Field>
            {kind === 'projects' && (
              <>
                <div className="flex items-center gap-3">
                  <Switch id="post-featured" checked={!!fields.featured} onCheckedChange={(v) => setFields({ ...fields, featured: v })} />
                  <label htmlFor="post-featured" className="text-sm">
                    Featured <span className="text-muted-foreground">(large on the homepage, first in menus)</span>
                  </label>
                </div>
                <Field label="GitHub link">
                  <Input value={fields.github ?? ''} placeholder="https://github.com/…" onChange={(e) => setFields({ ...fields, github: e.target.value })} />
                </Field>
                <Field label="Demo link">
                  <Input value={fields.demo ?? ''} placeholder="https://…" onChange={(e) => setFields({ ...fields, demo: e.target.value })} />
                </Field>
              </>
            )}
            <Field label="Tags" hint="Comma separated">
              <Input value={fields.tags.join(', ')} onChange={(e) => setFields({ ...fields, tags: e.target.value.split(',').map((t) => t.trimStart()) })} />
            </Field>
            <Field label="Layout">
              <Select value={fields.format} onValueChange={(v) => setFields({ ...fields, format: v as Fields['format'] })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="post">
                    {kind === 'projects' ? 'Project (cover, text beside the tools)' : 'Post (text column, table of contents)'}
                  </SelectItem>
                  <SelectItem value="story">Story (full-screen cover, wide photos)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Cover photo" hint="From the photo library; a story opens with it full screen">
              <div className="flex gap-2">
                <Input value={fields.coverPhoto} placeholder="None" onChange={(e) => setFields({ ...fields, coverPhoto: e.target.value })} className="font-mono text-xs" />
                <Button type="button" variant="outline" size="sm" onClick={() => setPicker({ kind: 'coverPhoto' })}>
                  Choose
                </Button>
              </div>
            </Field>
            <Field label="Cover image file" hint={`Or an image next to the ${noun}, e.g. ./cover.jpg (used instead of a cover photo)`}>
              <div className="flex gap-2">
                <ImageFileSelect images={post.images} value={fields.cover} onChange={(cover) => setFields({ ...fields, cover })} />
                <Button type="button" variant="outline" size="sm" onClick={() => coverInput.current?.click()} disabled={!post.file.includes('/index.')}>
                  <Upload /> Upload
                </Button>
                <input
                  ref={coverInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    try {
                      const { path } = await uploadPostImage(kind, slug, file);
                      setPost((p) => p && { ...p, images: [...p.images, path.slice(2)] });
                      setFields((f) => f && { ...f, cover: path });
                      toast.success(`Added ${path.slice(2)} as the cover`, { description: 'Save to keep it.' });
                    } catch (err) {
                      toast.error((err as Error).message);
                    }
                  }}
                />
              </div>
            </Field>
            {kind === 'projects' && (
              <Field label="Small cover" hint="Optional tighter crop for cards and menus">
                <ImageFileSelect images={post.images} value={fields.coverSmall ?? ''} onChange={(coverSmall) => setFields({ ...fields, coverSmall })} />
              </Field>
            )}
            {kind === 'projects' && (
              <>
                <CheckList
                  label="Tools used"
                  options={tools.map((t) => ({ id: t.id, label: t.name }))}
                  value={fields.tools ?? []}
                  onChange={(tools) => setFields({ ...fields, tools })}
                />
                <CheckList
                  label="Related posts"
                  options={posts.map((p) => ({ id: p.slug, label: p.title, hint: p.draft ? 'draft' : p.date }))}
                  value={fields.posts ?? []}
                  onChange={(posts) => setFields({ ...fields, posts })}
                />
              </>
            )}
            <div className="flex items-center gap-3">
              <Switch id="post-draft" checked={fields.draft} onCheckedChange={(v) => setFields({ ...fields, draft: v })} />
              <label htmlFor="post-draft" className="text-sm">
                Draft <span className="text-muted-foreground">(only visible in dev)</span>
              </label>
            </div>
            <Button onClick={save} disabled={!dirty || saving}>
              <Save /> Save
            </Button>
            <Separator />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive hover:text-destructive">
                  <Trash2 /> Delete {noun}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{fields.title}”?</AlertDialogTitle>
                  <AlertDialogDescription>This deletes {post.file.replace(/\/index\.mdx?$/, '/')} and everything in it. Git can bring it back.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={async () => {
                      try {
                        await deletePost(kind, slug);
                        setSaved(null);
                        setDetails(false);
                        toast.success(`Deleted ${fields.title}`);
                        onDeleted();
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </SheetContent>
      </Sheet>

      <PhotoPicker
        albums={albums}
        open={!!picker}
        onOpenChange={(open) => !open && setPicker(null)}
        title={
          { photo: 'Insert a photo', row: 'Insert a row of photos', gallery: 'Insert a gallery', side: 'Insert a photo beside text', cover: 'Insert a full-screen cover', coverPhoto: 'Choose the cover photo' }[
            picker?.kind ?? 'photo'
          ]
        }
        description={picker?.kind === 'row' || picker?.kind === 'gallery' ? 'In the order you click them.' : undefined}
        max={picker?.kind === 'row' || picker?.kind === 'gallery' ? Infinity : 1}
        min={picker?.kind === 'row' ? 2 : 1}
        confirm={picker?.kind === 'coverPhoto' ? 'Use as cover' : 'Insert'}
        onPick={onPicked}
      />
    </div>
  );
}

/** An image file next to the post or project, as "./name.jpg". */
function ImageFileSelect({ images, value, onChange }: { images: string[]; value: string; onChange: (value: string) => void }) {
  const files = value && !images.includes(value.slice(2)) ? [...images, value.slice(2)] : images;
  return (
    <Select value={value || 'none'} onValueChange={(v) => onChange(v === 'none' ? '' : v)}>
      <SelectTrigger className="w-full min-w-0 flex-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">None</SelectItem>
        {files.map((f) => (
          <SelectItem key={f} value={`./${f}`}>
            ./{f}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Pick several (tools, related posts): a scrolling list of checkboxes. */
function CheckList({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string; hint?: string }[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5 text-sm">
      <legend className="mb-1.5 font-medium">
        {label} <span className="font-normal text-muted-foreground">{value.length ? `· ${value.length}` : ''}</span>
      </legend>
      <div className="flex max-h-44 flex-col overflow-y-auto rounded-lg border p-1">
        {options.length === 0 && <p className="p-2 text-xs text-muted-foreground">None yet</p>}
        {options.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
            <Checkbox
              checked={value.includes(o.id)}
              onCheckedChange={(checked) => onChange(checked ? [...value, o.id] : value.filter((v) => v !== o.id))}
            />
            <span className="truncate">{o.label}</span>
            {o.hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{o.hint}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
