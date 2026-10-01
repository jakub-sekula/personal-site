import { useEffect, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, Rocket, TriangleAlert } from 'lucide-react';
import { Badge } from '@editor/components/ui/badge';
import { Button } from '@editor/components/ui/button';
import { Checkbox } from '@editor/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@editor/components/ui/dialog';
import { Textarea } from '@editor/components/ui/textarea';
import { cn } from '@editor/lib/utils';
import { Progress } from '@editor/components/ui/progress';
import { Field } from './shared';

interface Change {
  file: string;
  status: string;
  kind: 'photos' | 'posts' | 'cv' | 'other content' | null;
}
interface Status {
  branch: string;
  live: string;
  remote: string;
  changes: Change[];
  other: Change[];
  unpublished: { hash: string; subject: string }[];
  behind: number;
  targets: string[];
}

const API = '/dev/api/content/publish';
async function json<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

const GROUPS = [
  ['photos', 'Photos and albums'],
  ['posts', 'Posts'],
  ['cv', 'CV'],
  ['other content', 'Other content'],
] as const;

/** A starting commit message from what changed ("Update Iceland album, 2 posts and the CV"). */
function suggestMessage(changes: Change[]) {
  const parts: string[] = [];
  const albums = [...new Set(changes.filter((c) => c.file.startsWith('src/content/albums/')).map((c) => c.file.split('/').pop()!.replace(/\.mdx$/, '')))];
  if (albums.length) parts.push(albums.length <= 3 ? `${albums.join(', ')} ${albums.length === 1 ? 'album' : 'albums'}` : `${albums.length} albums`);
  if (!albums.length && changes.some((c) => c.file.startsWith('src/data/photos/'))) parts.push('photos');
  // src/content/blog/<slug>/index.mdx (or a flat <slug>.mdx)
  const posts = new Set(changes.filter((c) => c.kind === 'posts').map((c) => c.file.split('/')[3].replace(/\.mdx?$/, '')));
  if (posts.size) parts.push(posts.size === 1 ? `the "${[...posts][0]}" post` : `${posts.size} posts`);
  if (changes.some((c) => c.kind === 'cv')) parts.push('the CV');
  if (changes.some((c) => c.file === 'photos.config.json')) parts.push('photo settings');
  if (!parts.length) return 'Update content';
  return `Update ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`}`;
}

/** Commit the content changes and push them live, from the editor. */
export function PublishDialog({ open, onOpenChange, onPublished }: { open: boolean; onOpenChange: (open: boolean) => void; onPublished: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState('');
  const [targets, setTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  // Live progress while publishing: finished steps, and the one in progress.
  const [log, setLog] = useState<string[]>([]);
  const [current, setCurrent] = useState<{ step: string; detail?: string; progress?: number } | null>(null);
  const [error, setError] = useState('');

  // (After a failed publish the list is refreshed, keeping the error on screen.)
  const load = async ({ keepError = false } = {}) => {
    if (!keepError) setError('');
    try {
      const s = await json<Status>(await fetch(API));
      setStatus(s);
      setMessage(suggestMessage(s.changes));
      setTargets(s.targets);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setDone(null);
    load();
  }, [open]);

  /** Publish, following the server's progress (one JSON event per line) as it goes. */
  async function publish() {
    setBusy(true);
    setError('');
    setLog([]);
    setCurrent(null);
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, targets }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let result: { steps: string[]; status: Status } | null = null;
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.error) throw new Error(event.error);
          if (event.step) setCurrent({ step: event.step, detail: event.detail, progress: event.progress });
          if (event.done) {
            setLog((l) => [...l, event.done]);
            setCurrent(null);
          }
          if (event.result) result = event.result;
        }
      }
      if (!result) throw new Error('The publish stopped without finishing (is the dev server still running?)');
      setDone(result.steps);
      setStatus(result.status);
      onPublished();
    } catch (e) {
      setError((e as Error).message);
      load({ keepError: true });
    } finally {
      setBusy(false);
      setCurrent(null);
    }
  }

  const nothing = !!status && !status.changes.length && !status.unpublished.length;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col sm:max-w-2xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>Publish</DialogTitle>
          <DialogDescription>
            Commits your content changes and pushes them to GitHub; Cloudflare then rebuilds the live site. Code changes are never included.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-col gap-5 overflow-y-auto px-1 text-sm">
          {!status && !error && <p className="text-muted-foreground">Checking what changed…</p>}

          {done && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
              <p className="mb-1.5 font-medium">Published</p>
              <ul className="flex flex-col gap-1">
                {done.map((s) => (
                  <li key={s} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" /> {s}
                  </li>
                ))}
              </ul>
              <a href="https://jakubsekula.com" target="_blank" className="mt-2 inline-flex items-center gap-1 underline">
                jakubsekula.com <ExternalLink className="size-3" />
              </a>
            </div>
          )}

          {status && !done && (
            <>
              {status.behind > 0 && (
                <p className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  {status.live} on GitHub has {status.behind} change{status.behind === 1 ? '' : 's'} this copy doesn't have (as of the last check). Publishing
                  will stop before pushing; bring them in first (git pull).
                </p>
              )}

              {nothing ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Check className="size-4 text-emerald-500" /> Everything is published.
                </p>
              ) : (
                <>
                  {status.changes.length > 0 && (
                    <div className="flex flex-col gap-3">
                      <h3 className="font-medium">Changes to publish</h3>
                      {GROUPS.map(([kind, label]) => {
                        const files = status.changes.filter((c) => c.kind === kind);
                        return (
                          files.length > 0 && (
                            <div key={kind}>
                              <p className="mb-1 text-xs text-muted-foreground">{label}</p>
                              <ul className="flex flex-col gap-0.5">
                                {files.map((c) => (
                                  <li key={c.file} className="flex items-center gap-2">
                                    <Badge variant={c.status === 'deleted' ? 'destructive' : 'secondary'} className="w-16 justify-center">
                                      {c.status}
                                    </Badge>
                                    <code className="truncate text-xs">{c.file}</code>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )
                        );
                      })}
                    </div>
                  )}

                  {status.unpublished.length > 0 && (
                    <div>
                      <h3 className="mb-1 font-medium">Also going live (saved earlier, not published yet)</h3>
                      <ul className="flex flex-col gap-0.5 text-xs">
                        {status.unpublished.map((c) => (
                          <li key={c.hash} className="flex gap-2">
                            <code className="text-muted-foreground">{c.hash}</code> <span className="truncate">{c.subject}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {status.changes.length > 0 && (
                    <Field label="Description" hint="Saved in the history with this change">
                      <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} disabled={busy} />
                    </Field>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <span className="font-medium">Publish to</span>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {status.targets.map((t) => (
                        <label key={t} className="flex items-center gap-2">
                          <Checkbox
                            checked={targets.includes(t)}
                            disabled={busy}
                            onCheckedChange={(on) => setTargets((ts) => (on ? [...ts, t] : ts.filter((x) => x !== t)))}
                          />
                          <span>
                            {t}
                            {t === status.live && <span className="text-muted-foreground"> (the live site)</span>}
                            {t === status.branch && t !== status.live && <span className="text-muted-foreground"> (this copy's branch)</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {status.other.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    {status.other.length} other changed file{status.other.length === 1 ? '' : 's'} not included (code, not content)
                  </summary>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {status.other.map((c) => (
                      <li key={c.file}>
                        <code>{c.file}</code> <span className="opacity-70">({c.status})</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {(busy || (error && log.length > 0)) && (
            <div className="rounded-lg border p-3">
              <p className="mb-2 font-medium">{busy ? 'Publishing…' : 'Got this far'}</p>
              <ul className="flex flex-col gap-1.5">
                {log.map((s) => (
                  <li key={s} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" /> {s}
                  </li>
                ))}
                {current && (
                  <li className="flex flex-col gap-1.5">
                    <span className="flex items-start gap-2">
                      <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                      {current.step}
                      {current.detail && <span className="text-muted-foreground tabular-nums">({current.detail})</span>}
                    </span>
                    {current.progress !== undefined && <Progress value={current.progress * 100} className="ml-6 h-1.5" />}
                  </li>
                )}
              </ul>
            </div>
          )}
          {error && <p className={cn('rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive')}>{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {done ? 'Done' : 'Cancel'}
          </Button>
          {!done && (
            <Button onClick={publish} disabled={busy || !status || nothing || !targets.length || (status.changes.length > 0 && !message.trim())}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Rocket />}
              {busy ? 'Publishing…' : targets.includes(status?.live ?? 'main') ? 'Publish to the live site' : 'Publish'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
