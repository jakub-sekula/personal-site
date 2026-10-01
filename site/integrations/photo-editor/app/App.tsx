// The local site editor (dev only): a small CMS for photos and albums, blog
// posts, the CV and the site header. Every change is written to the files in the repo through
// the dev API (../api.mjs, ../content-api.mjs); publishing is still commit + push.
import './editor.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Copy, X } from 'lucide-react';
import { type Album, fetchAlbums, plural, syncNow, syncStatus } from '@editor/lib/api';
import { type PostSummary, fetchPosts } from '@editor/lib/content';
import { Button } from '@editor/components/ui/button';
import { SidebarInset, SidebarProvider } from '@editor/components/ui/sidebar';
import { Toaster } from '@editor/components/ui/sonner';
import { TooltipProvider } from '@editor/components/ui/tooltip';
import { AlbumView } from './components/AlbumView';
import { AppSidebar, type R2State, type Section } from './components/AppSidebar';
import { CollectionView } from './components/CollectionView';
import { CommandMenu } from './components/CommandMenu';
import { CvEditor } from './components/CvEditor';
import { HeaderEditor } from './components/HeaderEditor';
import { NewAlbumDialog } from './components/NewAlbumDialog';
import { NewCollectionDialog } from './components/NewCollectionDialog';
import { NewPostDialog } from './components/NewPostDialog';
import { PhotoDialog } from './components/PhotoDialog';
import { PhotoSettingsDialog } from './components/PhotoSettingsDialog';
import { PublishDialog } from './components/PublishDialog';
import { PostEditor } from './components/PostEditor';
import { TopBar } from './components/TopBar';
import { copy } from './components/shared';

// Saving rewrites content files, and Astro reloads every open page when content
// changes. Keep this page as it is: Vite only reloads when the reload's `path`
// matches the page, so point it elsewhere. Other tabs (and the previews) still reload.
import.meta.hot?.on('vite:beforeFullReload', (payload: { path?: string }) => {
  payload.path = '/__photo-editor-stays-open__.html';
});
// An error while rendering a page (often a preview, e.g. a typo in a post) makes Vite
// cover every open page with its error overlay, the editor included. The editor is
// fine: show the error as a notice instead, and keep working.
import.meta.hot?.on('vite:error', (payload: { err?: { message?: string } }) => {
  setTimeout(() => document.querySelectorAll('vite-error-overlay').forEach((el) => el.remove()));
  toast.error('A page failed to render', { description: payload.err?.message?.split('\n')[0], duration: 8000 });
});

// The editor used to live at /dev/photos (still served): show the address as /dev.
if (location.pathname.replace(/\/$/, '') === '/dev/photos') history.replaceState(null, '', `/dev${location.hash}`);

// Where you are lives in the address, so a reload comes back to it:
// #photos/iceland, #posts/my-post, #cv, #header (and plain #iceland from before).
interface Route {
  section: Section;
  id: string;
}
function fromHash(): Route {
  const [first, ...rest] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (first === 'posts' || first === 'cv' || first === 'header' || first === 'photos') return { section: first, id: rest.join('/') };
  return { section: 'photos', id: first };
}
const toHash = ({ section, id }: Route) => `#${section}${id ? `/${id}` : ''}`;

export default function App() {
  const [route, setRoute] = useState<Route>(fromHash);
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState('');
  const [openSrc, setOpenSrc] = useState<string>();
  const [selection, setSelection] = useState<string[]>([]);
  const [newAlbum, setNewAlbum] = useState(false);
  const [newCollection, setNewCollection] = useState(false);
  const [newPost, setNewPost] = useState(false);
  const [search, setSearch] = useState(false);
  const [photoSettings, setPhotoSettings] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [r2, setR2] = useState<R2State>({ status: 'checking' });
  const [cvSections, setCvSections] = useState<string[]>([]);
  const [cvJump, setCvJump] = useState<{ index: number }>();
  const [headerItems, setHeaderItems] = useState<string[]>([]);
  const [headerJump, setHeaderJump] = useState<{ index: number }>();
  // Set by the post, CV and header editors: leaving with unsaved changes asks first.
  const dirty = useRef(false);

  const reload = useCallback(async () => {
    try {
      setAlbums(await fetchAlbums());
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  const reloadPosts = useCallback(async () => {
    try {
      setPosts(await fetchPosts());
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, []);
  const checkR2 = useCallback(async () => {
    setR2({ status: 'checking' });
    try {
      setR2({ status: 'ok', result: await syncStatus() });
    } catch (err) {
      setR2({ status: 'error', message: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    reload();
    reloadPosts();
    checkR2();
    const onHash = () => setRoute(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (next: Route) => {
    if (next.section === route.section && next.id === route.id) return;
    if (dirty.current && !confirm('You have unsaved changes. Leave without saving?')) return;
    dirty.current = false;
    setOpenSrc(undefined);
    if (location.hash !== toHash(next)) history.pushState(null, '', toHash(next));
    setRoute(next);
  };
  const select = (id: string) => go({ section: 'photos', id });

  if (error) return <p className="p-8 text-destructive">Couldn't load the editor: {error}</p>;
  if (!albums) return <p className="p-8 text-muted-foreground">Loading…</p>;

  const album =
    route.section === 'photos' ? (albums.find((a) => a.id === route.id) ?? albums.find((a) => a.photos.length) ?? albums[0]) : undefined;
  const postSlug = route.section === 'posts' ? route.id || posts?.[0]?.slug || '' : '';

  return (
    <TooltipProvider>
      {/* The top bar spans the width; the sidebar and the page sit below it. */}
      <SidebarProvider className="flex-col" style={{ '--header-height': '3rem' } as React.CSSProperties}>
        <TopBar section={route.section} onSection={(section) => go({ section, id: '' })} onPublish={() => setPublishing(true)} />
        <div className="flex flex-1">
        <AppSidebar
          section={route.section}
          albums={albums}
          current={album?.id ?? ''}
          onSelect={select}
          onNewAlbum={() => setNewAlbum(true)}
          onNewCollection={() => setNewCollection(true)}
          onSearch={() => setSearch(true)}
          onPhotoSettings={() => setPhotoSettings(true)}
          r2={r2}
          onUpload={async () => {
            setR2({ status: 'uploading' });
            try {
              const { uploaded } = await syncNow();
              toast.success(`Uploaded ${plural(uploaded, 'file')} to R2`, { description: 'Publish to put the changes live.' });
            } catch (err) {
              toast.error((err as Error).message);
            }
            checkR2();
          }}
          posts={posts}
          currentPost={postSlug}
          onSelectPost={(slug) => go({ section: 'posts', id: slug })}
          onNewPost={() => setNewPost(true)}
          cvSections={cvSections}
          onJumpCv={(index) => setCvJump({ index })}
          headerItems={headerItems}
          onJumpHeader={(index) => setHeaderJump({ index })}
        />
        <SidebarInset className="min-w-0">
          {route.section === 'photos' &&
            (album?.isCollection ? (
              <CollectionView collection={album} albums={albums} reload={reload} openAlbum={select} onDeleted={() => select('')} />
            ) : album ? (
              <AlbumView
                album={album}
                albums={albums}
                reload={reload}
                openPhoto={setOpenSrc}
                selection={selection}
                toggleSelected={(ref) => setSelection((s) => (s.includes(ref) ? s.filter((r) => r !== ref) : [...s, ref]))}
                onUploaded={checkR2}
              />
            ) : (
              <p className="p-8 text-muted-foreground">No albums yet: create one.</p>
            ))}
          {route.section === 'posts' &&
            (postSlug ? (
              <PostEditor
                key={postSlug}
                slug={postSlug}
                albums={albums}
                onDirtyChange={(d) => (dirty.current = d)}
                onSaved={reloadPosts}
                onDeleted={async () => {
                  dirty.current = false;
                  await reloadPosts();
                  go({ section: 'posts', id: '' });
                }}
              />
            ) : (
              <p className="p-8 text-muted-foreground">{posts ? 'No posts yet: create one.' : 'Loading…'}</p>
            ))}
          {route.section === 'cv' && <CvEditor jumpTo={cvJump} onSections={setCvSections} onDirtyChange={(d) => (dirty.current = d)} />}
          {route.section === 'header' && (
            <HeaderEditor albums={albums} posts={posts} jumpTo={headerJump} onItems={setHeaderItems} onDirtyChange={(d) => (dirty.current = d)} />
          )}
        </SidebarInset>
        </div>
      </SidebarProvider>

      <PhotoDialog album={album} src={openSrc} onClose={() => setOpenSrc(undefined)} onNavigate={setOpenSrc} reload={reload} />
      <NewAlbumDialog
        albums={albums}
        open={newAlbum}
        onOpenChange={setNewAlbum}
        onCreated={async (id) => {
          await reload();
          select(id);
          checkR2();
        }}
      />
      <NewCollectionDialog
        albums={albums}
        open={newCollection}
        onOpenChange={setNewCollection}
        onCreated={async (id) => {
          await reload();
          select(id);
        }}
      />
      <PhotoSettingsDialog albums={albums} open={photoSettings} onOpenChange={setPhotoSettings} onSaved={reload} />
      <PublishDialog open={publishing} onOpenChange={setPublishing} onPublished={checkR2} />
      <NewPostDialog
        open={newPost}
        onOpenChange={setNewPost}
        onCreated={async (slug) => {
          await reloadPosts();
          go({ section: 'posts', id: slug });
        }}
      />
      <CommandMenu
        albums={albums}
        open={search}
        onOpenChange={setSearch}
        onAlbum={select}
        onPhoto={(id, src) => {
          select(id);
          setOpenSrc(src);
        }}
      />

      {/* Above Astro's dev toolbar, which sits at the bottom centre in dev. */}
      {route.section === 'photos' && selection.length > 0 && (
        <div className="fixed bottom-16 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border bg-popover px-4 py-2.5 text-sm shadow-lg">
          <span>{plural(selection.length, 'photo')} selected</span>
          <Button size="sm" onClick={() => copy(`<Gallery photos={[${selection.map((ref) => `{ src: '${ref}' }`).join(', ')}]} />`)}>
            <Copy /> Copy &lt;Gallery&gt;
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelection([])} aria-label="Clear selection">
            <X />
          </Button>
        </div>
      )}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
