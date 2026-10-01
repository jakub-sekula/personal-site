import { ChevronDown, CloudUpload, FileText, FolderPlus, ImagePlus, Images, Library, PenSquare, Plus, Rocket, Search, Settings2, UserRound } from 'lucide-react';
import { type Album, type SyncStatus, plural } from '@editor/lib/api';
import { type PostSummary } from '@editor/lib/content';
import { Badge } from '@editor/components/ui/badge';
import { Button } from '@editor/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@editor/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@editor/components/ui/sidebar';
import { Tabs, TabsList, TabsTrigger } from '@editor/components/ui/tabs';

export type R2State = { status: 'checking' } | { status: 'ok'; result: SyncStatus } | { status: 'uploading' } | { status: 'error'; message: string };
export type Section = 'photos' | 'posts' | 'cv';

interface Props {
  section: Section;
  onSection: (section: Section) => void;
  // Photos
  albums: Album[];
  current: string;
  onSelect: (id: string) => void;
  onNewAlbum: () => void;
  onNewCollection: () => void;
  onSearch: () => void;
  r2: R2State;
  onUpload: () => void;
  onPhotoSettings: () => void;
  onPublish: () => void;
  // Posts
  posts: PostSummary[] | null;
  currentPost: string;
  onSelectPost: (slug: string) => void;
  onNewPost: () => void;
  // CV
  cvSections: string[];
  onJumpCv: (index: number) => void;
}

export function AppSidebar(props: Props) {
  const { section, onSection } = props;
  return (
    <Sidebar>
      <SidebarHeader className="gap-3 p-3">
        <div className="flex items-center gap-2 px-1">
          <PenSquare className="size-5" />
          <span className="font-semibold">Site editor</span>
          <Badge variant="secondary" className="ml-auto">
            local
          </Badge>
        </div>
        <Tabs value={section} onValueChange={(v) => onSection(v as Section)}>
          <TabsList className="w-full">
            <TabsTrigger value="photos">
              <Images /> Photos
            </TabsTrigger>
            <TabsTrigger value="posts">
              <FileText /> Posts
            </TabsTrigger>
            <TabsTrigger value="cv">
              <UserRound /> CV
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {section === 'photos' && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Plus /> New <ChevronDown className="ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
                <DropdownMenuItem onSelect={props.onNewAlbum}>
                  <ImagePlus /> Album
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={props.onNewCollection}>
                  <FolderPlus /> Collection of albums
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline" className="justify-start text-muted-foreground" onClick={props.onSearch}>
              <Search /> Search photos
              <kbd className="ml-auto rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
            </Button>
          </>
        )}
        {section === 'posts' && (
          <Button size="sm" onClick={props.onNewPost}>
            <Plus /> New post
          </Button>
        )}
      </SidebarHeader>
      {section === 'photos' && <PhotosNav {...props} />}
      {section === 'posts' && <PostsNav {...props} />}
      {section === 'cv' && <CvNav {...props} />}
      <SidebarFooter className="gap-2 border-t p-3 text-xs">
        {section === 'photos' && (
          <>
            <Button size="sm" variant="outline" className="justify-start" onClick={props.onPhotoSettings}>
              <Settings2 /> Photo settings
            </Button>
            <R2Status r2={props.r2} onUpload={props.onUpload} />
          </>
        )}
        <Button size="sm" onClick={props.onPublish}>
          <Rocket /> Publish
        </Button>
        <p className="text-muted-foreground">Edits are saved here as you go; Publish puts them on the live site.</p>
      </SidebarFooter>
    </Sidebar>
  );
}

function PhotosNav({ albums, current, onSelect }: Props) {
  const byTitle = (a: Album, b: Album) => a.title.replace(/^\P{L}+/u, '').localeCompare(b.title.replace(/^\P{L}+/u, ''));
  const childIds = new Set(albums.flatMap((a) => a.children));
  // Collections (listed or not) with their albums nested, then listed albums, then the rest.
  const collections = albums.filter((a) => a.isCollection).sort(byTitle);
  const listed = albums.filter((a) => !a.isCollection && !childIds.has(a.id) && a.topLevel).sort(byTitle);
  const unlisted = albums.filter((a) => !a.isCollection && !childIds.has(a.id) && !a.topLevel).sort(byTitle);
  // In the collection's own order, as on the site.
  const childrenOf = (album: Album) => album.children.map((id) => albums.find((a) => a.id === id)).filter((a): a is Album => !!a);

  const item = (album: Album) => (
    <SidebarMenuItem key={album.id}>
      <SidebarMenuButton isActive={album.id === current} onClick={() => onSelect(album.id)}>
        {album.isCollection && <Library />}
        <span className="truncate">{album.title}</span>
        {album.draft && <Badge variant="outline" className="ml-auto px-1 text-[10px]">draft</Badge>}
      </SidebarMenuButton>
      <SidebarMenuBadge>{album.isCollection ? album.children.length || '' : album.photos.length || ''}</SidebarMenuBadge>
      {album.children.length > 0 && (
        <SidebarMenuSub>
          {childrenOf(album).map((child) => (
            <SidebarMenuSubItem key={child.id}>
              <SidebarMenuSubButton isActive={child.id === current} onClick={() => onSelect(child.id)} className="cursor-pointer">
                <span className="truncate">{child.title}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{child.photos.length}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );

  return (
    <SidebarContent>
      {collections.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Collections</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{collections.map(item)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
      <SidebarGroup>
        <SidebarGroupLabel>Albums in the sidebar</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>{listed.map(item)}</SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {unlisted.length > 0 && (
        <SidebarGroup>
          <SidebarGroupLabel>Not listed</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{unlisted.map(item)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </SidebarContent>
  );
}

function PostsNav({ posts, currentPost, onSelectPost }: Props) {
  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Posts, newest first</SidebarGroupLabel>
        <SidebarGroupContent>
          {!posts && <p className="px-2 text-sm text-muted-foreground">Loading…</p>}
          <SidebarMenu>
            {posts?.map((p) => (
              <SidebarMenuItem key={p.slug}>
                <SidebarMenuButton isActive={p.slug === currentPost} onClick={() => onSelectPost(p.slug)} className="h-auto flex-col items-start gap-0.5 py-1.5">
                  <span className="line-clamp-2 w-full">{p.title}</span>
                  <span className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
                    {p.date}
                    {p.draft && <Badge variant="outline" className="px-1 text-[10px]">draft</Badge>}
                    {p.format === 'story' && <Badge variant="secondary" className="px-1 text-[10px]">story</Badge>}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  );
}

function CvNav({ cvSections, onJumpCv }: Props) {
  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Sections</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {cvSections.map((title, i) => (
              <SidebarMenuItem key={i}>
                <SidebarMenuButton onClick={() => onJumpCv(i)}>
                  <span className="truncate">{title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  );
}

function R2Status({ r2, onUpload }: { r2: R2State; onUpload: () => void }) {
  const pending = r2.status === 'ok' ? r2.result.added + r2.result.changed : 0;
  return (
    <>
      <div className="flex items-center gap-2">
        <CloudUpload className="size-4 shrink-0" />
        <span className="font-medium">R2</span>
        <span className="ml-auto text-right text-muted-foreground" title={r2.status === 'error' ? r2.message : undefined}>
          {r2.status === 'checking' && 'Checking…'}
          {r2.status === 'uploading' && 'Uploading…'}
          {r2.status === 'error' && (r2.message.includes('R2_') ? 'Not set up (keys go in site/.env)' : 'Unavailable')}
          {r2.status === 'ok' && (pending ? `${plural(pending, 'file')} to upload` : 'Up to date')}
        </span>
      </div>
      {pending > 0 && (
        <Button size="sm" onClick={onUpload}>
          <CloudUpload /> Upload to R2
        </Button>
      )}
    </>
  );
}
