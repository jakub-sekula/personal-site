import { FileText, FolderKanban, Images, PanelTop, PenSquare, Rocket, UserRound } from 'lucide-react';
import { Badge } from '@editor/components/ui/badge';
import { Button } from '@editor/components/ui/button';
import { Separator } from '@editor/components/ui/separator';
import { SidebarTrigger } from '@editor/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@editor/components/ui/tooltip';
import { cn } from '@editor/lib/utils';
import { type Section } from './AppSidebar';

const SECTIONS: { id: Section; label: string; icon: typeof Images }[] = [
  { id: 'photos', label: 'Photos', icon: Images },
  { id: 'posts', label: 'Posts', icon: FileText },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'cv', label: 'CV', icon: UserRound },
  { id: 'header', label: 'Header', icon: PanelTop },
];

/** The editor's full-width bar: the site's sections, and Publish. Its height is --header-height. */
export function TopBar({ section, onSection, onPublish }: { section: Section; onSection: (section: Section) => void; onPublish: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-3 border-b bg-background px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />
      <div className="flex items-center gap-2">
        <PenSquare className="size-4" />
        <span className="font-semibold whitespace-nowrap max-sm:hidden">Site editor</span>
        <Badge variant="secondary" className="max-sm:hidden">
          local
        </Badge>
      </div>
      <nav aria-label="Sections" className="ml-2 flex h-full items-stretch overflow-x-auto">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? 'page' : undefined}
            onClick={() => onSection(id)}
            className={cn(
              'flex items-center gap-2 border-b-2 border-transparent px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
              section === id && 'border-foreground font-medium text-foreground',
            )}
          >
            <Icon /> <span className="max-sm:sr-only">{label}</span>
          </button>
        ))}
      </nav>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" className="ml-auto" onClick={onPublish}>
            <Rocket /> Publish
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          Edits are saved here as you go; Publish puts them on the live site.
        </TooltipContent>
      </Tooltip>
    </header>
  );
}
