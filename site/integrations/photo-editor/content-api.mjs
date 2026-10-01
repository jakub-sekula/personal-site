// Dev-only API for the site editor's Posts and CV sections: reads and writes
// src/content/blog/<slug>/index.mdx and src/content/cv.yaml (frontmatter and YAML
// formatting preserved where possible). Photos live in ./api.mjs.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { ROOT, slugify } from '../../scripts/lib/photos.mjs';

const SLUG = /^[a-z0-9-]+$/;
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const CV_FILE = path.join(ROOT, 'src/content/cv.yaml');
const CV_LOGOS = path.join(ROOT, 'src/assets/cv');
const IMAGE = /\.(jpe?g|png|webp|avif|gif|svg)$/i;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const YAML_OPTIONS = { lineWidth: 0, flowCollectionPadding: false };

let queue = Promise.resolve();
const exclusive = (fn) => (queue = queue.then(fn, fn));

// --- Posts -----------------------------------------------------------------------------

/** The file of a post: <slug>/index.mdx (or .md), or a flat <slug>.mdx/.md. */
function postFile(slug) {
  if (!SLUG.test(slug ?? '')) throw new Error(`Bad post address "${slug}"`);
  for (const candidate of [`${slug}/index.mdx`, `${slug}/index.md`, `${slug}.mdx`, `${slug}.md`]) {
    const file = path.join(BLOG_DIR, candidate);
    if (existsSync(file)) return file;
  }
  throw new Error(`No post "${slug}"`);
}

async function readPost(file) {
  const [, fm, body] = (await readFile(file, 'utf8')).match(FRONTMATTER) ?? [];
  if (fm === undefined) throw new Error(`${path.relative(ROOT, file)}: missing frontmatter`);
  return { doc: YAML.parseDocument(fm), body: body.replace(/^\n/, '') };
}

const dateString = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? ''));

function summary(slug, file, data) {
  return {
    slug,
    file: path.relative(ROOT, file),
    mdx: file.endsWith('.mdx'),
    title: data.title ?? slug,
    description: data.description ?? '',
    date: dateString(data.date),
    tags: data.tags ?? [],
    cover: data.cover ?? '',
    coverPhoto: data.coverPhoto ?? '',
    format: data.format ?? 'post',
    draft: !!data.draft,
  };
}

export async function listPosts() {
  const posts = [];
  for (const entry of await readdir(BLOG_DIR, { withFileTypes: true })) {
    const slug = entry.isDirectory() ? entry.name : entry.name.replace(/\.mdx?$/, '');
    if (!entry.isDirectory() && !/\.mdx?$/.test(entry.name)) continue;
    let file;
    try {
      file = postFile(slug);
    } catch {
      continue;
    }
    posts.push(summary(slug, file, (await readPost(file)).doc.toJS() ?? {}));
  }
  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getPost({ slug }) {
  const file = postFile(slug);
  const { doc, body } = await readPost(file);
  const dir = path.dirname(file);
  const images = file.endsWith(`${path.sep}index.mdx`) || file.endsWith(`${path.sep}index.md`) ? (await readdir(dir)).filter((f) => IMAGE.test(f)) : [];
  return { ...summary(slug, file, doc.toJS() ?? {}), body, images };
}

export const savePost = ({ slug, fields, body }) =>
  exclusive(async () => {
    const file = postFile(slug);
    const { doc } = await readPost(file);
    const title = String(fields.title ?? '').trim();
    if (!title) throw new Error('A post needs a title');
    const date = String(fields.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date should look like 2024-01-31');
    if (fields.coverPhoto && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(fields.coverPhoto)) throw new Error('Cover photo should look like album/photo-name');
    const values = {
      title,
      description: String(fields.description ?? '').trim(),
      date,
      tags: [...new Set((fields.tags ?? []).map((t) => String(t).trim()).filter(Boolean))],
      cover: String(fields.cover ?? '').trim(),
      coverPhoto: String(fields.coverPhoto ?? '').trim(),
      format: fields.format === 'story' ? 'story' : '',
      draft: fields.draft ? true : '',
    };
    for (const [key, value] of Object.entries(values)) {
      const empty = Array.isArray(value) ? value.length === 0 : value === '';
      const current = doc.get(key, true);
      const now = current?.toJSON?.();
      if (empty) doc.delete(key);
      // Leave unchanged fields exactly as written (and lists in their style).
      else if (JSON.stringify(now instanceof Date ? dateString(now) : now) === JSON.stringify(value)) continue;
      else {
        const node = doc.createNode(value);
        if (Array.isArray(value)) node.flow = current ? !!current.flow : true;
        doc.set(key, node);
      }
    }
    const text = String(body ?? '').replace(/\s+$/, '');
    await writeFile(file, `---\n${doc.toString(YAML_OPTIONS).trimEnd()}\n---\n\n${text}\n`);
    return getPost({ slug });
  });

export const createPost = ({ title, slug: wanted }) =>
  exclusive(async () => {
    const slug = String(wanted || slugify(title ?? '')).trim();
    if (!String(title ?? '').trim()) throw new Error('A post needs a title');
    if (!SLUG.test(slug)) throw new Error('The address can only use a–z, 0–9 and hyphens');
    const dir = path.join(BLOG_DIR, slug);
    if (existsSync(dir) || existsSync(`${dir}.md`) || existsSync(`${dir}.mdx`)) throw new Error(`There's already a post at /blog/${slug}`);
    await mkdir(dir, { recursive: true });
    const doc = new YAML.Document({ title: String(title).trim(), date: new Date().toISOString().slice(0, 10), tags: [], draft: true });
    doc.get('tags', true).flow = true;
    await writeFile(path.join(dir, 'index.mdx'), `---\n${doc.toString(YAML_OPTIONS).trimEnd()}\n---\n\nStart writing here.\n`);
    return { slug };
  });

/** Deletes the post's folder (or file); git can bring it back. */
export const deletePost = ({ slug }) =>
  exclusive(async () => {
    const file = postFile(slug);
    const dir = path.dirname(file);
    if (path.basename(file).startsWith('index.') && dir !== BLOG_DIR) await rm(dir, { recursive: true });
    else await rm(file);
  });

/** Save an uploaded image (the request body) next to the post; returns its Markdown path. */
export async function uploadPostImage(req, { slug, name }) {
  const file = postFile(slug);
  if (!path.basename(file).startsWith('index.')) throw new Error('Images need a post in its own folder');
  if (!IMAGE.test(name ?? '')) throw new Error(`${name || 'File'}: not an image`);
  const dir = path.dirname(file);
  const ext = path.extname(name).toLowerCase();
  const base = slugify(path.basename(name, path.extname(name))) || 'image';
  let target = `${base}${ext}`;
  for (let i = 2; existsSync(path.join(dir, target)); i++) target = `${base}-${i}${ext}`;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  await writeFile(path.join(dir, target), Buffer.concat(chunks));
  return { path: `./${target}` };
}

// --- CV --------------------------------------------------------------------------------

async function readCv() {
  const doc = YAML.parseDocument(await readFile(CV_FILE, 'utf8'));
  return { doc, entry: doc.contents.items[0] };
}

export async function getCv() {
  const { entry } = await readCv();
  const { id, ...cv } = entry.toJSON();
  const logos = (await readdir(CV_LOGOS)).filter((f) => IMAGE.test(f)).sort();
  return { cv, logos };
}

const text = (v) => String(v ?? '').trim();
const lines = (v) => (Array.isArray(v) ? v : String(v ?? '').split('\n')).map(text).filter(Boolean);

/** Tidy one entry: drop empty optional fields so the YAML stays as hand-written. */
function cleanEntry(e) {
  const hidden = e.hidden ? { hidden: true } : {};
  if (e.kind === 'role') {
    if (!text(e.title)) throw new Error('Every role needs a title');
    return {
      kind: 'role',
      title: text(e.title),
      ...(text(e.place) && { place: text(e.place) }),
      ...(text(e.years) && { years: text(e.years) }),
      ...(text(e.logo) && { logo: text(e.logo) }),
      ...(lines(e.bullets).length && { bullets: lines(e.bullets) }),
      ...hidden,
    };
  }
  if (e.kind === 'list') {
    if (!text(e.title)) throw new Error('Every list needs a title');
    return { kind: 'list', title: text(e.title), items: lines(e.items), ...hidden };
  }
  if (e.kind === 'bullets') return { kind: 'bullets', bullets: lines(e.bullets), ...hidden };
  throw new Error(`Unknown entry kind "${e.kind}"`);
}

export const saveCv = ({ cv }) =>
  exclusive(async () => {
    const { doc } = await readCv();
    const clean = {
      id: 'cv',
      ...(text(cv.pdf) && { pdf: text(cv.pdf) }),
      ...(text(cv.linkedin) && { linkedin: text(cv.linkedin) }),
      sections: (cv.sections ?? []).map((s) => {
        if (!text(s.title)) throw new Error('Every section needs a title');
        return {
          title: text(s.title),
          ...(['green', 'yellow', 'blue', 'red'].includes(s.accent) && { accent: s.accent }),
          entries: (s.entries ?? []).map(cleanEntry),
        };
      }),
    };
    doc.contents.items[0] = doc.createNode(clean);
    await writeFile(CV_FILE, doc.toString(YAML_OPTIONS));
    return getCv();
  });

/** Save an uploaded logo (the request body) into src/assets/cv; returns the path cv.yaml uses. */
export async function uploadCvLogo(req, { name }) {
  if (!IMAGE.test(name ?? '')) throw new Error(`${name || 'File'}: not an image`);
  const ext = path.extname(name).toLowerCase();
  const base = slugify(path.basename(name, path.extname(name))) || 'logo';
  let target = `${base}${ext}`;
  for (let i = 2; existsSync(path.join(CV_LOGOS, target)); i++) target = `${base}-${i}${ext}`;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  await writeFile(path.join(CV_LOGOS, target), Buffer.concat(chunks));
  return { logo: `../assets/cv/${target}`, file: target };
}

