#!/usr/bin/env node
// One-off migration: rebuild all content from the live Strapi-backed site.
//
//   pnpm scrape:live [--base https://jakubsekula.com] [--cache .cache/live]
//
// The old Next.js pages embed the Strapi records they rendered in their RSC
// payload (self.__next_f.push(...)), including original upload URLs, so we can
// recover content + full-resolution originals without API access. What isn't
// in the payload (hero copy, some homepage lists) is read from the HTML.
//
// Overwrites everything under src/content (except blog), src/data/photos and
// the migrated assets. Downloads are cached, so re-runs are cheap.

import { createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import YAML from 'yaml';
import {
  ALBUM_DIR,
  MANIFEST_DIR,
  OUT_DIR,
  ROOT,
  appendPhotos,
  newAlbumDoc,
  processPhotos,
  readManifest,
  writeAlbum,
  writeManifest,
} from './lib/photos.mjs';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'https://jakubsekula.com' },
    api: { type: 'string', default: 'https://api.dev.jakubsekula.com' },
    cache: { type: 'string', default: '.cache/live' },
  },
});
const BASE = values.base;
const API = values.api;
const CACHE = path.resolve(ROOT, values.cache);

// --- Fetching & parsing -------------------------------------------------------

const pageCache = new Map();
async function page(pathname) {
  if (!pageCache.has(pathname)) {
    const res = await fetch(BASE + pathname);
    if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status}`);
    const html = await res.text();
    pageCache.set(pathname, { html, rows: parseRsc(html) });
  }
  return pageCache.get(pathname);
}

/** Split the RSC stream into rows and JSON-parse the ones that are JSON. */
function parseRsc(html) {
  const stream = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map((m) => JSON.parse(`"${m[1]}"`))
    .join('');
  const rows = [];
  let i = 0;
  while (i < stream.length) {
    const colon = stream.indexOf(':', i);
    if (colon < 0) break;
    if (stream[colon + 1] === 'T') {
      // Text row: `<id>:T<hex byte length>,<text>`
      const comma = stream.indexOf(',', colon);
      const len = parseInt(stream.slice(colon + 2, comma), 16);
      const text = Buffer.from(stream.slice(comma + 1), 'utf8').subarray(0, len).toString('utf8');
      i = comma + 1 + text.length;
      continue;
    }
    const nl = stream.indexOf('\n', colon);
    const payload = stream.slice(colon + 1, nl < 0 ? undefined : nl);
    i = nl < 0 ? stream.length : nl + 1;
    try {
      rows.push(JSON.parse(/^[A-Z]/.test(payload) ? payload.slice(1) : payload));
    } catch {
      /* module/hint rows */
    }
  }
  return rows;
}

function* walk(node) {
  if (node && typeof node === 'object') {
    yield node;
    for (const v of Object.values(node)) yield* walk(v);
  }
}

function findAll(rows, predicate) {
  const out = [];
  for (const row of rows) for (const n of walk(row)) if (predicate(n)) out.push(n);
  return out;
}

const findOne = (rows, predicate, what) => {
  const hit = findAll(rows, predicate)[0];
  if (!hit) throw new Error(`Couldn't find ${what}`);
  return hit;
};

/** Strapi media → { url, name, ext } for the original upload (or null). */
function media(m) {
  const a = m?.data?.attributes ?? m?.attributes;
  return a?.url ? { url: a.url, name: a.name, ext: a.ext, caption: a.caption, width: a.width, height: a.height } : null;
}

/** Download an upload (cached) and return its local path. */
async function download(url) {
  const abs = url.startsWith('http') ? url : API + url;
  const dest = path.join(CACHE, 'uploads', path.basename(new URL(abs).pathname));
  if (!existsSync(dest)) {
    await mkdir(path.dirname(dest), { recursive: true });
    const res = await fetch(abs);
    if (!res.ok) throw new Error(`${abs}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest + '.part'));
    await rename(dest + '.part', dest);
  }
  return dest;
}

async function copyUpload(m, destNoExt) {
  if (!m) return null;
  const src = await download(m.url);
  const dest = `${destNoExt}${m.ext.toLowerCase()}`;
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
  return dest;
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const rel = (from, to) => path.relative(path.dirname(from), to).split(path.sep).join('/');
const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const writeYaml = (file, data) => writeFile(path.join(ROOT, file), YAML.stringify(data, { lineWidth: 0 }));
const writeMarkdown = (file, frontmatter, body) =>
  writeFile(file, `---\n${YAML.stringify(frontmatter, { lineWidth: 0 })}---\n${body?.trim() ? `\n${body.trim()}\n` : ''}`);

/** Slugs linked from inside the homepage <section id="…-section"> for `title`. */
function linksInSection(html, title, prefix) {
  const start = html.indexOf(`id="${title.replace(/&/g, '&amp;')}-section"`);
  if (start < 0) return [];
  const end = html.indexOf('</section>', start);
  const re = new RegExp(`href="/${prefix}/([a-z0-9-]+)"`, 'g');
  return [...new Set([...html.slice(start, end).matchAll(re)].map((m) => m[1]))];
}

// --- Start fresh ----------------------------------------------------------------
// Processed photos are kept (and pruned at the end) so re-runs don't re-encode everything.

for (const dir of ['src/content/albums', 'src/content/projects', 'src/assets/cv', 'src/assets/tools', 'src/assets/home']) {
  await rm(path.join(ROOT, dir), { recursive: true, force: true });
}
const usedPhotos = new Map(); // album -> Set(photoId)

// --- Tools & projects -------------------------------------------------------------

const projectsPage = await page('/projects');
const projectEntities = [];
for (const n of findAll(projectsPage.rows, (n) => n.attributes?.slug && 'excerpt' in n.attributes)) {
  if (!projectEntities.some((p) => p.attributes.slug === n.attributes.slug)) projectEntities.push(n);
}

const tools = new Map();
for (const p of projectEntities) {
  for (const t of p.attributes.tools?.data ?? []) {
    const a = t.attributes;
    const id = slugify(a.name);
    if (tools.has(id)) continue;
    const light = await copyUpload(media(a.icon_light), path.join(ROOT, 'src/assets/tools', id));
    const dark = await copyUpload(media(a.icon_dark), path.join(ROOT, 'src/assets/tools', `${id}-dark`));
    const toolsFile = path.join(ROOT, 'src/content/tools.yaml');
    tools.set(id, {
      id,
      name: a.name,
      ...(a.type && { category: a.type }),
      ...(light && { icon: rel(toolsFile, light) }),
      ...(dark && { iconDark: rel(toolsFile, dark) }),
      ...(a.prefer_light && { preferLight: true }),
      ...(a.show_on_homepage === false && { showOnHomepage: false }),
    });
  }
}
await writeYaml('src/content/tools.yaml', [...tools.values()]);
console.log(`Tools: ${tools.size}`);

for (const [i, p] of projectEntities.entries()) {
  const a = p.attributes;
  const dir = path.join(ROOT, 'src/content/projects', a.slug);
  const cover = await copyUpload(media(a.featured_image), path.join(dir, 'cover'));
  const detail = await page(`/projects/${a.slug}`);
  const tags = [...new Set([...detail.html.matchAll(/href="\/tags\/[^"]+"[^>]*>([^<]+)</g)].map((m) => decode(m[1])))];
  await writeMarkdown(
    path.join(dir, 'index.md'),
    {
      title: a.title,
      ...(a.excerpt?.trim() && { excerpt: a.excerpt.trim() }),
      type: a.type,
      ...(a.color && { color: a.color }),
      ...(a.highlighted && { featured: true }),
      order: i + 1,
      date: isoDate(a.createdAt),
      cover: `./${path.basename(cover)}`,
      ...(a.github_url && { github: a.github_url }),
      ...(a.demo_url && { demo: a.demo_url }),
      ...(tags.length && { tags }),
      ...(a.tools?.data?.length && { tools: a.tools.data.map((t) => slugify(t.attributes.name)) }),
    },
    a.description,
  );
  console.log(`Project: ${a.slug}`);
}

// --- Albums ----------------------------------------------------------------------

const photographyPage = await page('/photography');
const albumSlugs = [...new Set([...photographyPage.html.matchAll(/href="\/photography\/([a-z0-9-]+)"/g)].map((m) => m[1]))];

for (const slug of albumSlugs) {
  const { rows } = await page(`/photography/${slug}`);
  const album = findOne(rows, (n) => n.slug === slug && 'sections' in n && 'type' in n, `album ${slug}`);
  const imageLinks = findAll(rows, (n) => Array.isArray(n.imageLinks))[0]?.imageLinks ?? [];
  const cover = media(album.featured_image);

  // Originals: gallery photos (in order) + the cover.
  const inputs = [];
  for (const link of imageLinks) inputs.push({ file: await download(link.src), name: decodeURIComponent(path.basename(link.src)).replace(/_[0-9a-f]{10}(\.\w+)$/, '$1') });
  if (cover) inputs.push({ file: await download(cover.url), name: cover.name });

  console.log(`Album ${slug}: ${imageLinks.length} photo(s)`);
  const results = await processPhotos(inputs, slug);
  const srcs = results.map((r) => `${slug}/${r.id}`);
  usedPhotos.set(slug, new Set(results.map((r) => r.id)));

  const doc = newAlbumDoc({
    title: album.title,
    cover: cover ? srcs.at(-1) : srcs[0],
    date: isoDate(album.createdAt),
    ...(album.show_tags && album.tags?.data?.length && { tags: album.tags.data.map((t) => t.attributes.title) }),
    ...(album.type === 'category' && {
      albums: (album.albums?.data ?? []).map((c) => c.attributes.slug).filter((s) => albumSlugs.includes(s)),
    }),
    photos: [],
  });
  appendPhotos(doc, srcs.slice(0, imageLinks.length));
  // Captions (Strapi defaulted them to the file name, which we skip).
  // Section boundaries, where the payload has the per-section gallery arrays (not deduplicated away).
  const sizes = (album.sections ?? []).map((s) => (Array.isArray(s.gallery?.data) ? s.gallery.data.length : NaN));
  const starts = new Set();
  if (sizes.length > 1 && sizes.every(Number.isFinite) && sizes.reduce((a, b) => a + b, 0) === imageLinks.length) {
    sizes.slice(0, -1).reduce((at, n) => (starts.add(at + n), at + n), 0);
  }
  doc.get('photos').items.forEach((item, idx) => {
    const caption = imageLinks[idx]?.description;
    if (caption && !/\.(jpe?g|png|webp)$/i.test(caption)) item.set('description', caption);
    if (starts.has(idx)) item.set('newSection', true);
  });
  await writeAlbum(slug, { doc, body: album.description ?? '' });
}

// Drop processed photos (and whole albums) that no longer exist on the live site.
for (const file of await readdir(MANIFEST_DIR)) {
  const album = path.basename(file, '.json');
  const keep = usedPhotos.get(album);
  if (!keep) {
    await rm(path.join(MANIFEST_DIR, file));
    await rm(path.join(OUT_DIR, album), { recursive: true, force: true });
    continue;
  }
  const manifest = await readManifest(album);
  for (const id of Object.keys(manifest)) {
    if (keep.has(id)) continue;
    delete manifest[id];
    await rm(path.join(OUT_DIR, album, id), { recursive: true, force: true });
  }
  await writeManifest(album, manifest);
}

// Photography page and sidebar order.
// The photography page grid is server-rendered, so read its order from the HTML inside <main>.
const mainHtml = photographyPage.html.slice(photographyPage.html.indexOf('<main'));
const index = [...new Set([...mainHtml.matchAll(/href="\/photography\/([a-z0-9-]+)"/g)].map((m) => m[1]))];
const { rows: anyAlbumRows } = await page(`/photography/${albumSlugs.find((s) => s !== 'places') ?? albumSlugs[0]}`);
const sidebar = [
  ...new Set(
    findAll(anyAlbumRows, (n) => n.attributes?.slug && 'albums' in n.attributes && 'seo' in n.attributes).map((n) => n.attributes.slug),
  ),
];
await writeYaml('src/content/photography.yaml', [{ id: 'photography', index, sidebar }]);
console.log(`Photography index: ${index.join(', ')}\nSidebar: ${sidebar.join(', ')}`);

// --- CV ------------------------------------------------------------------------

const homePage = await page('/');
const cvPage = await page('/cv');
const cv = findOne(homePage.rows, (n) => Array.isArray(n.sections) && n.sections[0]?.entries, 'CV').sections;
const cvFile = path.join(ROOT, 'src/content/cv.yaml');
const sections = [];
for (const section of cv) {
  const entries = [];
  for (const e of section.entries) {
    const lines = (e.bullets ?? '').split('\n').map((l) => l.replace(/^[-*∙]\s*/, '').trim()).filter(Boolean);
    const hidden = e.show_on_website === false ? { hidden: true } : {};
    if (e.type === 'Inline list') {
      entries.push({ kind: 'list', title: e.title, items: lines.join(', ').split(/\s*,\s*/).filter(Boolean), ...hidden });
    } else if (e.type === 'Bullets') {
      entries.push({ kind: 'bullets', bullets: lines, ...hidden });
    } else {
      const logo = media(e.image);
      const logoPath = logo && (await copyUpload(logo, path.join(ROOT, 'src/assets/cv', slugify(path.parse(logo.name).name))));
      entries.push({
        kind: 'role',
        title: e.title,
        ...(e.place && { place: e.place }),
        ...(e.years && { years: e.years }),
        ...(logoPath && { logo: rel(cvFile, logoPath) }),
        ...(lines.length && { bullets: lines }),
        ...hidden,
      });
    }
  }
  sections.push({ title: section.title, ...(section.color && { accent: section.color }), entries });
}
const pdfUrl = cvPage.html.match(/href="([^"]+\.pdf)"/)?.[1];
if (pdfUrl) {
  await copyFile(await download(pdfUrl), path.join(ROOT, 'public/jakub-sekula-cv.pdf'));
}
const linkedin = cvPage.html.match(/href="(https:\/\/www\.linkedin\.com[^"]+)"/)?.[1];
await writeYaml('src/content/cv.yaml', [{ id: 'cv', ...(pdfUrl && { pdf: '/jakub-sekula-cv.pdf' }), ...(linkedin && { linkedin }), sections }]);
console.log(`CV: ${sections.length} sections`);

// --- Homepage ------------------------------------------------------------------

const html = homePage.html;
const homeFile = path.join(ROOT, 'src/content/home.yaml');
// Hero images are rendered via /_next/image?url=<encoded upload url>; strip the size prefix for the original.
const heroSection = html.slice(html.indexOf('id="hero-section"'), html.indexOf('</section>', html.indexOf('id="hero-section"')));
const heroImgs = [
  ...new Set([...heroSection.matchAll(/url=([^&"]+)/g)].map((m) => decodeURIComponent(m[1]).replace(/\/uploads\/(large|medium|small|xlarge|xxlarge)_/, '/uploads/'))),
];
const [backgroundUrl, avatarUrl] = heroImgs;
const background = await copyUpload({ url: backgroundUrl, ext: path.extname(backgroundUrl) }, path.join(ROOT, 'src/assets/home/hero'));
const avatar = await copyUpload({ url: avatarUrl, ext: path.extname(avatarUrl) }, path.join(ROOT, 'src/assets/home/avatar'));

const socials = [];
for (const m of heroSection.matchAll(/<a[^>]*href="(https:[^"]+)"[^>]*><img[^>]*alt="([^"]+)-icon"[^>]*src="([^"]+)"/g)) {
  const [, url, name, icon] = m;
  const iconPath = await copyUpload({ url: icon, ext: path.extname(icon) }, path.join(ROOT, 'src/assets/home', `${slugify(name)}-icon`));
  socials.push({ name, url, icon: rel(homeFile, iconPath) });
}

const about = findOne(homePage.rows, (n) => typeof n.bio === 'string', 'about bio').bio;
const projectGroups = findAll(homePage.rows, (n) => typeof n.title === 'string' && Array.isArray(n.projects) && 'reverse' in n).map((g) => ({
  title: g.title,
  projects: g.projects.map((p) => p.attributes?.slug).filter(Boolean),
}));

await writeYaml('src/content/home.yaml', [
  {
    id: 'home',
    headline: decode(heroSection.match(/<h1[^>]*>([^<]+)</)[1]),
    avatar: rel(homeFile, avatar),
    background: rel(homeFile, background),
    socials,
    about,
    projects: projectGroups,
    skills: [],
    photography: linksInSection(html, 'Photography', 'photography'),
    showBlog: html.includes('id="Recent blog posts-section"'),
  },
]);
console.log('Homepage done');

console.log(`\nPhotos in ${path.relative(ROOT, OUT_DIR)}, manifests in ${path.relative(ROOT, MANIFEST_DIR)}, albums in ${path.relative(ROOT, ALBUM_DIR)}.`);
