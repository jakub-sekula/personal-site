// Dev-only: publish content edits from the site editor. Commits the content
// files (albums, photo data, posts, CV, photo settings) — never code — and pushes
// to the branches Cloudflare deploys from, fast-forward only. Photo files go to R2
// first, so the live site never points at photos that aren't uploaded yet.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { ROOT } from '../../scripts/lib/photos.mjs';
import { syncPhotos } from '../../scripts/lib/sync.mjs';
import { updateShareImages } from '../../scripts/lib/share.mjs';

const exec = promisify(execFile);

/** What the editor writes (relative to the site folder): only these are committed. */
const CONTENT = ['src/content', 'src/data', 'src/assets/cv', 'photos.config.json'];
/** Branches a publish can update on the remote. `main` is what the live site builds from. */
const LIVE = 'main';
const REMOTE = 'origin';

async function git(args, { allowFail = false } = {}) {
  try {
    const { stdout } = await exec('git', args, {
      cwd: ROOT,
      maxBuffer: 16 << 20,
      // Never wait on a password prompt nobody can see: fail instead.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' },
    });
    return stdout;
  } catch (error) {
    if (allowFail) return null;
    throw new Error((error.stderr || error.message).trim().split('\n').slice(-3).join(' '));
  }
}

/** What kind of content a changed file is, for the list (or null for code etc.). */
function kindOf(file) {
  if (/^src\/content\/albums\/|^src\/data\/photos\/|^photos\.config\.json$/.test(file)) return 'photos';
  if (/^src\/content\/blog\//.test(file)) return 'posts';
  if (/^src\/content\/cv\.yaml$|^src\/assets\/cv\//.test(file)) return 'cv';
  if (CONTENT.some((p) => file === p || file.startsWith(`${p}/`))) return 'other content';
  return null;
}

const STATUS = { M: 'changed', A: 'added', D: 'deleted', R: 'renamed', '?': 'new', C: 'copied', U: 'conflict' };

export async function publishStatus() {
  const top = (await git(['rev-parse', '--show-toplevel'], { allowFail: true }))?.trim();
  if (!top) throw new Error('The site folder isn\'t in a git repository');
  const prefix = path.relative(top, ROOT); // e.g. "site"
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();

  const changes = [];
  const other = [];
  for (const line of (await git(['status', '--porcelain=v1', '--untracked-files=all'])).split('\n').filter(Boolean)) {
    const code = line.slice(0, 2).trim()[0] ?? '?';
    let file = line.slice(3).replace(/^"|"$/g, '');
    if (file.includes(' -> ')) file = file.split(' -> ')[1];
    const inSite = prefix ? file.startsWith(`${prefix}/`) : true;
    const rel = inSite ? file.slice(prefix ? prefix.length + 1 : 0) : file;
    const kind = inSite ? kindOf(rel) : null;
    (kind ? changes : other).push({ file: rel, status: STATUS[code] ?? code, kind });
  }

  // Commits on this branch that the live site doesn't have yet (as of the last fetch).
  const remoteBranches = (await git(['branch', '-r', '--format=%(refname:short)'])).split('\n').filter(Boolean);
  const hasLive = remoteBranches.includes(`${REMOTE}/${LIVE}`);
  const unpublished = hasLive
    ? (await git(['log', '--format=%h%x09%s', `${REMOTE}/${LIVE}..HEAD`])).split('\n').filter(Boolean).map((l) => {
        const [hash, ...subject] = l.split('\t');
        return { hash, subject: subject.join('\t') };
      })
    : [];
  const behind = hasLive ? Number((await git(['rev-list', '--count', `HEAD..${REMOTE}/${LIVE}`])).trim()) : 0;

  // Push targets: the live branch, and the branch this copy is on (e.g. dev).
  const targets = [LIVE, ...(branch !== LIVE && branch !== 'HEAD' ? [branch] : [])];

  return { branch, live: LIVE, remote: REMOTE, changes, other, unpublished, behind, targets };
}

/**
 * Upload photos, commit the content changes (if any) and push HEAD to `targets`,
 * reporting each step through `emit` as it happens ({ step, detail?, progress? }).
 * A failure stops there (nothing is forced).
 */
export async function publish({ message, targets }, emit = () => {}) {
  const steps = [];
  const done = (text) => {
    steps.push(text);
    emit({ done: text });
  };
  // 0. Link-preview pictures of albums changed by hand (the editor draws its own as it
  // goes). First, so their list (src/data/share-images.json) goes out with the rest.
  emit({ step: 'Drawing link-preview pictures' });
  try {
    const { drawn } = await updateShareImages({
      onProgress: (n, total) => emit({ step: 'Drawing link-preview pictures', detail: `${n} of ${total}`, progress: n / total }),
    });
    done(drawn.length ? `Drew ${drawn.length} link-preview picture${drawn.length === 1 ? '' : 's'}` : 'Link-preview pictures up to date');
  } catch (error) {
    // Not worth stopping for: pages without an up-to-date picture use their cover.
    done(`Couldn't draw link-preview pictures (${error.message}); those pages use their cover`);
  }

  emit({ step: 'Checking what changed' });
  const status = await publishStatus();
  const wanted = (targets ?? [status.live]).filter((t) => status.targets.includes(t));
  if (!wanted.length) throw new Error('Pick at least one branch to publish to');

  // 1. Photos first: the pages being published may use photos that only exist locally.
  emit({ step: 'Uploading new photo files to R2' });
  try {
    let last = 0;
    const r2 = await syncPhotos({
      onProgress: (n, total) => {
        // A few updates a second at most.
        if (n === total || Date.now() - last > 250) {
          last = Date.now();
          emit({ step: 'Uploading new photo files to R2', detail: `${n} of ${total}`, progress: n / total });
        }
      },
    });
    done(r2.uploaded ? `Uploaded ${r2.uploaded} photo file${r2.uploaded === 1 ? '' : 's'} to R2` : 'Photos already on R2');
  } catch (error) {
    // Without R2 set up, text-only changes (posts, CV) can still go out.
    const photoChanges = status.changes.some((c) => c.kind === 'photos');
    if (!error.message.includes('R2_') || photoChanges) {
      throw new Error(`Uploading photos to R2 failed, so nothing was published: ${error.message}`);
    }
    done('Skipped R2 (not set up here; no photo changes)');
  }

  // 2. Commit the content (only the content paths).
  if (status.changes.length) {
    const text = String(message ?? '').trim();
    if (!text) throw new Error('Write a short description of the changes');
    emit({ step: 'Saving the changes (commit)' });
    // Exactly the content files listed (staged or not; anything else stays as it is).
    const files = status.changes.map((c) => path.join(ROOT, c.file));
    await git(['add', '-A', '--', ...files]);
    await git(['commit', '-m', text, '--', ...files]);
    done(`Committed: ${text.split('\n')[0]}`);
  } else {
    done('No content changes to commit');
  }

  // 3. Push, fast-forward only: fetch first and refuse if a branch moved on there.
  emit({ step: 'Checking GitHub for changes made elsewhere' });
  const remote = new Set((await git(['ls-remote', '--heads', status.remote])).split('\n').filter(Boolean).map((l) => l.split('refs/heads/')[1]));
  const existing = wanted.filter((t) => remote.has(t));
  if (existing.length) await git(['fetch', status.remote, ...existing]);
  for (const target of existing) {
    if ((await git(['merge-base', '--is-ancestor', `${status.remote}/${target}`, 'HEAD'], { allowFail: true })) === null) {
      throw new Error(
        `${target} on GitHub has changes this copy doesn't (made somewhere else). Nothing was pushed; your commit is saved locally. ` +
          `Bring them in first (git pull), then publish again.`,
      );
    }
  }
  done('GitHub is in step');
  emit({ step: `Pushing to ${wanted.join(', ')}` });
  await git(['push', status.remote, ...wanted.map((t) => `HEAD:refs/heads/${t}`)]);
  done(`Pushed to ${wanted.join(', ')}${wanted.includes(status.live) ? ': the live site rebuilds in a minute or two' : ''}`);

  return { steps, status: await publishStatus() };
}
