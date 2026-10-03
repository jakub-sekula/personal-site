// Dev-only API for the site editor's Posts, Projects, CV and Header sections: reads and
// writes src/content/{blog,projects}/<slug>/index.mdx, project-categories.yaml, cv.yaml and
// header.yaml (frontmatter and YAML formatting preserved where possible). Photos: ./api.mjs.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { ROOT, slugify } from '../../scripts/lib/photos.mjs';

const SLUG = /^[a-z0-9-]+$/;
const CV_FILE = path.join(ROOT, 'src/content/cv.yaml');
const CV_LOGOS = path.join(ROOT, 'src/assets/cv');
const IMAGE = /\.(jpe?g|png|webp|avif|gif|svg)$/i;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const YAML_OPTIONS = { lineWidth: 0, flowCollectionPadding: false };

let queue = Promise.resolve();
const exclusive = (fn) => (queue = queue.then(fn, fn));

// --- Posts and projects ----------------------------------------------------------------
// A project is a post with a few extras: both are <slug>/index.mdx (or .md, or a flat
// <slug>.mdx) with frontmatter, and keep their images next to it.

const KINDS = {
  blog: { dir: path.join(ROOT, 'src/content/blog'), noun: 'post', url: '/blog' },
  projects: { dir: path.join(ROOT, 'src/content/projects'), noun: 'project', url: '/projects' },
};
const CATEGORIES_FILE = path.join(ROOT, 'src/content/project-categories.yaml');
const TOOLS_FILE = path.join(ROOT, 'src/content/tools.yaml');
const ACCENTS = ['green', 'yellow', 'blue', 'red'];

function kindOf(kind = 'blog') {
  if (!Object.hasOwn(KINDS, kind)) throw new Error(`Unknown kind "${kind}"`);
  return KINDS[kind];
}

/** The file of a post or project: <slug>/index.mdx (or .md), or a flat <slug>.mdx/.md. */
function postFile(kind, slug) {
  const { dir, noun } = kindOf(kind);
  if (!SLUG.test(slug ?? '')) throw new Error(`Bad ${noun} address "${slug}"`);
  for (const candidate of [`${slug}/index.mdx`, `${slug}/index.md`, `${slug}.mdx`, `${slug}.md`]) {
    const file = path.join(dir, candidate);
    if (existsSync(file)) return file;
  }
  throw new Error(`No ${noun} "${slug}"`);
}

async function readPost(file) {
  const [, fm, body] = (await readFile(file, 'utf8')).match(FRONTMATTER) ?? [];
  if (fm === undefined) throw new Error(`${path.relative(ROOT, file)}: missing frontmatter`);
  return { doc: YAML.parseDocument(fm), body: body.replace(/^\n/, '') };
}

/** Frontmatter, then the body after a blank line (nothing for an empty body). */
async function writePost(file, doc, body) {
  const content = String(body ?? '').replace(/\s+$/, '');
  await writeFile(file, `---\n${doc.toString(YAML_OPTIONS).trimEnd()}\n---\n${content ? `\n${content}\n` : ''}`);
}

const dateString = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? ''));
/** An image next to the file ("./cover.jpg"), as Vite serves it in dev. */
const fileUrl = (file, rel) => (typeof rel === 'string' && rel.startsWith('./') ? `/${path.relative(ROOT, path.dirname(file))}/${rel.slice(2)}` : '');

function summary(kind, slug, file, data) {
  const common = {
    slug,
    file: path.relative(ROOT, file),
    mdx: file.endsWith('.mdx'),
    title: data.title ?? slug,
    description: data.description ?? '',
    date: dateString(data.date),
    tags: data.tags ?? [],
    cover: data.cover ?? '',
    coverUrl: fileUrl(file, data.coverSmall ?? data.cover),
    coverPhoto: data.coverPhoto ?? '',
    format: data.format ?? 'post',
    draft: !!data.draft,
  };
  if (kind !== 'projects') return common;
  return {
    ...common,
    category: data.category ?? '',
    color: data.color ?? 'green',
    featured: !!data.featured,
    order: data.order ?? 0,
    coverSmall: data.coverSmall ?? '',
    github: data.github ?? '',
    demo: data.demo ?? '',
    tools: data.tools ?? [],
    posts: data.posts ?? [],
  };
}

export async function listPosts({ kind } = {}) {
  const { dir } = kindOf(kind);
  const posts = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const slug = entry.isDirectory() ? entry.name : entry.name.replace(/\.mdx?$/, '');
    if (!entry.isDirectory() && !/\.mdx?$/.test(entry.name)) continue;
    let file;
    try {
      file = postFile(kind, slug);
    } catch {
      continue;
    }
    posts.push(summary(kind, slug, file, (await readPost(file)).doc.toJS() ?? {}));
  }
  // Posts newest first; projects in their page order.
  return kind === 'projects' ? posts.sort((a, b) => a.order - b.order) : posts.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getPost({ kind, slug }) {
  const file = postFile(kind, slug);
  const { doc, body } = await readPost(file);
  const dir = path.dirname(file);
  const images = file.endsWith(`${path.sep}index.mdx`) || file.endsWith(`${path.sep}index.md`) ? (await readdir(dir)).filter((f) => IMAGE.test(f)) : [];
  return { ...summary(kind, slug, file, doc.toJS() ?? {}), body, images };
}

const url = (value, label) => {
  const v = text(value);
  if (v && !/^https?:\/\/[^\s]+$/.test(v)) throw new Error(`${label} should be a full address (https://…)`);
  return v;
};
const imageRef = (value, label) => {
  const v = text(value);
  if (v && !/^\.\/[^/]+$/.test(v)) throw new Error(`${label} should be an image next to the file, like ./cover.jpg`);
  return v;
};

/** The project-only fields, checked against the categories, tools and posts that exist. */
async function projectValues(fields) {
  const categories = (await getCategories()).categories.map((c) => c.id);
  if (!categories.includes(fields.category)) throw new Error('Choose a category');
  const tools = new Set((await listTools()).map((t) => t.id));
  const missingTool = (fields.tools ?? []).find((t) => !tools.has(t));
  if (missingTool) throw new Error(`No tool "${missingTool}" in src/content/tools.yaml`);
  const posts = new Set((await listPosts({ kind: 'blog' })).map((p) => p.slug));
  const missingPost = (fields.posts ?? []).find((p) => !posts.has(p));
  if (missingPost) throw new Error(`No post "${missingPost}"`);
  return {
    category: fields.category,
    color: ACCENTS.includes(fields.color) ? fields.color : 'green',
    featured: fields.featured ? true : '',
    coverSmall: imageRef(fields.coverSmall, 'The small cover'),
    github: url(fields.github, 'The GitHub link'),
    demo: url(fields.demo, 'The demo link'),
    tools: [...new Set(fields.tools ?? [])],
    posts: [...new Set(fields.posts ?? [])],
  };
}

export const savePost = ({ kind, slug, fields, body }) =>
  exclusive(async () => {
    const { noun } = kindOf(kind);
    const file = postFile(kind, slug);
    const { doc } = await readPost(file);
    const title = String(fields.title ?? '').trim();
    if (!title) throw new Error(`A ${noun} needs a title`);
    const date = String(fields.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date should look like 2024-01-31');
    if (fields.coverPhoto && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(fields.coverPhoto)) throw new Error('Cover photo should look like album/photo-name');
    const values = {
      title,
      description: String(fields.description ?? '').trim(),
      date,
      tags: [...new Set((fields.tags ?? []).map((t) => String(t).trim()).filter(Boolean))],
      cover: imageRef(fields.cover, 'The cover image'),
      coverPhoto: String(fields.coverPhoto ?? '').trim(),
      format: fields.format === 'story' ? 'story' : '',
      ...(kind === 'projects' && (await projectValues(fields))),
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
    await writePost(file, doc, body);
    return getPost({ kind, slug });
  });

export const createPost = ({ kind, title, slug: wanted }) =>
  exclusive(async () => {
    const { dir, noun, url: base } = kindOf(kind);
    const slug = String(wanted || slugify(title ?? '')).trim();
    if (!String(title ?? '').trim()) throw new Error(`A ${noun} needs a title`);
    if (!SLUG.test(slug)) throw new Error('The address can only use a–z, 0–9 and hyphens');
    const folder = path.join(dir, slug);
    if (existsSync(folder) || existsSync(`${folder}.md`) || existsSync(`${folder}.mdx`)) throw new Error(`There's already a ${noun} at ${base}/${slug}`);
    const fields = { title: String(title).trim(), date: new Date().toISOString().slice(0, 10) };
    if (kind === 'projects') {
      // Last on the projects page, in the first category until one is chosen.
      const [first] = (await getCategories()).categories;
      if (!first) throw new Error('Add a project category first');
      const last = Math.max(0, ...(await listPosts({ kind })).map((p) => p.order));
      Object.assign(fields, { category: first.id, order: last + 1 });
    }
    await mkdir(folder, { recursive: true });
    const doc = new YAML.Document({ ...fields, tags: [], draft: true });
    doc.get('tags', true).flow = true;
    await writeFile(path.join(folder, 'index.mdx'), `---\n${doc.toString(YAML_OPTIONS).trimEnd()}\n---\n\nStart writing here.\n`);
    return { slug };
  });

/** Deletes the post's or project's folder (or file); git can bring it back. */
export const deletePost = ({ kind, slug }) =>
  exclusive(async () => {
    const file = postFile(kind, slug);
    const dir = path.dirname(file);
    if (path.basename(file).startsWith('index.') && dir !== kindOf(kind).dir) await rm(dir, { recursive: true });
    else await rm(file);
  });

/** Save an uploaded image (the request body) next to the post; returns its Markdown path. */
export async function uploadPostImage(req, { kind, slug, name }) {
  const file = postFile(kind, slug);
  if (!path.basename(file).startsWith('index.')) throw new Error('Images need a folder of their own (…/index.mdx)');
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

// --- Project categories, order and tools ------------------------------------------------

export async function getCategories() {
  const list = YAML.parse(await readFile(CATEGORIES_FILE, 'utf8')) ?? [];
  return { categories: list.map((c) => ({ id: c.id, label: c.label ?? c.id, hidden: !!c.hidden })) };
}

/** Rename, reorder, hide, add or remove categories (only ones no project uses). */
export const saveCategories = ({ categories }) =>
  exclusive(async () => {
    const seen = new Set();
    const clean = (categories ?? []).map((c) => {
      const label = text(c.label);
      const id = text(c.id) || slugify(label);
      if (!label) throw new Error('Every category needs a name');
      if (!SLUG.test(id)) throw new Error(`"${label}": its id can only use a–z, 0–9 and hyphens`);
      if (seen.has(id)) throw new Error(`Two categories with the id "${id}"`);
      seen.add(id);
      return { id, label, ...(c.hidden && { hidden: true }) };
    });
    const used = new Set((await listPosts({ kind: 'projects' })).map((p) => p.category));
    const removed = [...used].find((id) => id && !seen.has(id));
    if (removed) throw new Error(`Projects still use the "${removed}" category: move them first`);
    const doc = YAML.parseDocument(await readFile(CATEGORIES_FILE, 'utf8'));
    // Keep the explanation at the top of the file.
    // (YAML attaches a comment at the top of a list to its first item.)
    const comment = doc.commentBefore ?? doc.contents?.commentBefore ?? doc.contents?.items?.[0]?.commentBefore;
    doc.contents = doc.createNode(clean);
    if (doc.contents.items[0]) doc.contents.items[0].commentBefore = comment;
    else doc.commentBefore = comment;
    await writeFile(CATEGORIES_FILE, doc.toString(YAML_OPTIONS));
    return getCategories();
  });

/** Number the projects 1, 2, 3… in the given order (their order on the projects page). */
export const setProjectOrder = ({ slugs }) =>
  exclusive(async () => {
    for (const [i, slug] of (slugs ?? []).entries()) {
      const file = postFile('projects', slug);
      const { doc, body } = await readPost(file);
      if (doc.get('order') === i + 1) continue;
      doc.set('order', i + 1);
      await writePost(file, doc, body);
    }
    return { projects: await listPosts({ kind: 'projects' }) };
  });

/** The tools a project can list (src/content/tools.yaml). */
export async function listTools() {
  const list = YAML.parse(await readFile(TOOLS_FILE, 'utf8')) ?? [];
  return list.map((t) => ({ id: t.id, name: t.name ?? t.id }));
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

// --- Header ----------------------------------------------------------------------------

const HEADER_FILE = path.join(ROOT, 'src/content/header.yaml');
const PHOTOGRAPHY_FILE = path.join(ROOT, 'src/content/photography.yaml');
const MENUS = ['projects', 'photography', 'blog'];

/** Projects for the header's pickers, in the projects page's order. */
async function listProjects() {
  const hidden = new Set((await getCategories()).categories.filter((c) => c.hidden).map((c) => c.id));
  const labels = new Map((await getCategories()).categories.map((c) => [c.id, c.label]));
  return (await listPosts({ kind: 'projects' })).map((p) => ({
    id: p.slug,
    title: p.title,
    type: labels.get(p.category) ?? p.category,
    featured: p.featured,
    draft: p.draft,
    // In a hidden category: never in an automatic list.
    listed: !hidden.has(p.category),
    cover: p.coverUrl,
  }));
}

export async function getHeader() {
  const doc = YAML.parseDocument(await readFile(HEADER_FILE, 'utf8'));
  const { id, ...header } = doc.contents.items[0].toJSON();
  const photography = YAML.parse(await readFile(PHOTOGRAPHY_FILE, 'utf8'))?.[0] ?? {};
  // `sidebar`: the albums a photography menu shows when none are picked.
  return { header, projects: await listProjects(), sidebar: photography.sidebar ?? [] };
}

function cleanItem(item) {
  const label = text(item.label);
  if (!label) throw new Error('Every header item needs a label');
  const href = text(item.href);
  if (!/^(\/|https?:\/\/|mailto:)/.test(href)) throw new Error(`${label}: the link should start with /, https:// or mailto:`);
  const menu = MENUS.includes(item.menu) ? item.menu : undefined;
  const limit = Number(item.limit);
  const pick = [...new Set((item.pick ?? []).map(text).filter(Boolean))];
  return {
    label,
    href,
    ...(ACCENTS.includes(item.accent) && { accent: item.accent }),
    ...(menu && {
      menu,
      ...(text(item.heading) && { heading: text(item.heading) }),
      ...(text(item.subheading) && { subheading: text(item.subheading) }),
      ...(text(item.allLabel) && { allLabel: text(item.allLabel) }),
      ...(pick.length && { pick }),
      ...(Number.isInteger(limit) && limit >= 1 && limit <= 12 && { limit }),
      ...(menu === 'blog' && item.newBadge === false && { newBadge: false }),
    }),
    ...(text(item.badge) && { badge: text(item.badge) }),
    ...(item.hidden && { hidden: true }),
  };
}

export const saveHeader = ({ header }) =>
  exclusive(async () => {
    const doc = YAML.parseDocument(await readFile(HEADER_FILE, 'utf8'));
    doc.contents.items[0] = doc.createNode({ id: 'header', items: (header.items ?? []).map(cleanItem) });
    await writeFile(HEADER_FILE, doc.toString(YAML_OPTIONS));
    return getHeader();
  });

