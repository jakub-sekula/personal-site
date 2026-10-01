# jakubsekula.com

Static site built with [Astro](https://docs.astro.build), deployed to Cloudflare (Workers static assets).
Content lives in this repo as Markdown/MDX/YAML; photos live in a Cloudflare R2 bucket.

It started as a backend-less port of the old Next.js + Strapi site: the components are ported
one-to-one and the old design tokens live on in `src/styles/global.css` (Tailwind 4, `@theme`).
Galleries open in [PhotoSwipe](https://photoswipe.com) (`src/components/photos/Lightbox.astro`);
there's no client-side framework. Like the old site it names Albert Sans / Inter / Source Code
Pro but doesn't load web fonts.

```bash
pnpm install
pnpm dev        # http://localhost:4321 (drafts are visible here, never in builds)
pnpm build      # → dist/
pnpm check      # type-check .astro files and content schemas
```

## Where things are

| What | Where |
| --- | --- |
| Homepage copy + what it features | `src/content/home.yaml` (hero, socials, about, project groups, skills, albums) |
| Photography page + sidebar order | `src/content/photography.yaml` |
| Projects | `src/content/projects/<slug>/index.{md,mdx}`, cover alongside |
| Tools (skills, "tools used") | `src/content/tools.yaml`, icons in `src/assets/tools/` |
| Blog posts | `src/content/blog/<slug>/index.{md,mdx}`, images alongside |
| Photo albums | `src/content/albums/<slug>.mdx`: frontmatter has the description, cover and photos (or child `albums`); an optional MDX body lays out the page |
| Photo metadata | `src/data/photos/<album>.json`, **generated**, don't edit by hand |
| CV | `src/content/cv.yaml`, logos in `src/assets/cv/`, PDF in `public/` |
| Components usable in MDX without importing | `src/components/mdx/index.ts` |
| Content schemas | `src/content.config.ts` |

References between content (a project's `tools`/`posts`, the homepage's `projects`/`photography`,
an album's child `albums`) are checked at build time, so a typo fails the build instead of
rendering a hole. Anything with `draft: true` shows in `pnpm dev` only.

## Photos

Originals never go in git. `pnpm photos add` resizes each one into AVIF + WebP at
each configured width (640/1280/1920/2560px by default) plus a 1200px JPEG for link previews
(camera data and GPS stripped; your name and copyright added, see `CREDIT` in
`scripts/lib/photos.mjs`), writes them to `public/photos/` (local only), records dimensions and a
blur placeholder in `src/data/photos/<album>.json`, and appends the photos to the album file.

The widths and the AVIF/WebP quality are in `photos.config.json`, edited under **Photo settings**
in the editor (defaults apply without it). Changes apply to photos added from then on; to remake an
existing photo at the new sizes, add its original again (in the editor, drop it on its album): same
file, same photo id and URLs. The editor lists which photos aren't at the current sizes.

```bash
# New album (or add more photos to an existing one)
pnpm photos add portugal ~/Exports/portugal --title "🇵🇹 Portugal" --parent places

# Edit src/content/albums/portugal.mdx: reorder, add titles/descriptions/tags, pick the cover, add a description.
# Without --parent, add it to src/content/photography.yaml to list it on /photography.

pnpm photos sync   # upload new variants to R2
git add src && git commit -m "Add Portugal album" && git push   # the Worker rebuilds and deploys
```

Photo ids include a content hash, so a re-edited export gets new file URLs (safe to cache
forever). Refer to a photo by its short name (`greece/img-7785`) unless two in an album share one.

### Titles, descriptions and tags

Every field is optional and lives with the photo in its album file:

```yaml
photos:
  - src: iceland/dscf-1434
    title: Búðakirkja
    description: |          # Markdown
      The black church at Búðir, built in 1703.
    tags: [churches, fog]
    alt: A small black church on a grassy plain  # defaults to the title
    slug: budakirkja       # page address; defaults to the file name (dscf-1434)
```

- Every photo in an album has a page at `/photography/<album>/<slug>` with its title,
  description, tags and prev/next, and uses the photo as its link preview.
- Clicking a photo in a grid opens the lightbox instead; the address bar shows the photo's
  page while it's open, and back closes it.
- Tags list at `/photography/tags/<tag>` (separate from the project/post tags at `/tags`).

### Photo editor (local)

While `pnpm dev` runs, **http://localhost:4321/dev/photos** does everything above without the
terminal (except committing):

- **New album**: title, address, description, where it's listed (inside Places, or in the
  photography sidebar and page) and a folder or files of photos. It runs the same pipeline as
  `pnpm photos add`.
- **Add photos** to an album with its button, or by dropping files or folders on it; **drag**
  photos by their ⠿ handle to reorder; **Remove** takes one out of the album (its files stay).
- **Settings** per album: title, date, description, listing, header (full screen or banner),
  cover crop, draft.
- **Upload to R2** appears in the toolbar when files aren't in the bucket yet (`pnpm photos sync`).
- Fill in title, description, tags, alt text and address; each change saves into the album
  file when you leave the field (formatting and comments are kept). Review with `git diff`.
- Copy a photo's `<Photo>` snippet or name; click thumbnails to select several (in order) and
  copy a `<Gallery>` snippet for a post.
- Set an album's cover, filter by album, search by name/title/tag, or show only untitled photos.

It's added by `integrations/photo-editor/` only in dev: it isn't part of the build, and it only
accepts writes from its own page. The page is a React app built with
[shadcn/ui](https://ui.shadcn.com) (`integrations/photo-editor/app/`, with its own stylesheet);
React is only loaded by `astro dev`, so the site itself still ships no framework. Add more
components with `pnpm dlx shadcn@latest add <name>` (configured in `components.json`).

### In posts

```mdx
<Photo src="greece/img-7785" />                                  {/* caption = the photo's title */}
<Photo src="greece/img-7785" caption="Markdown *works* here" />
<Gallery album="greece" />
<Gallery photos={[{ src: 'greece/img-7770' }, { src: 'greece/img-7607', caption: '…' }]} />
```

`caption` replaces the photo's description for that one use. All the photos in a post open in one
lightbox, in reading order. When a pipeline update adds a new file type, `pnpm photos backfill`
creates it for existing photos (then run `pnpm photos sync`).

### Story posts

`format: story` in a post's frontmatter makes a photo-led page: it opens with `coverPhoto` full
screen (title and description over it), has no table of contents, and photos can be wider than
the text.

```mdx
<Photo src="iceland/dscf-1434" size="full" />                    {/* size: text (default) | wide | full */}
<Gallery tag="ice" size="wide" />
<Row photos={['iceland/dscf-0820', 'iceland/dscf-0767']} />       {/* one row, same heights; wide by default */}

<Side photo="iceland/dscf-1479" side="right">                     {/* photo beside text; wide by default */}

Markdown text…

</Side>

<Cover photo="iceland/dscf-0558" position="50% 30%">              {/* full-screen chapter break */}

## Ice

</Cover>
```

In ordinary posts the same components work, but everything stays in the text column.

### Album layouts

An album's MDX body, if it has one, lays out the album page with the same components, plus
`<AlbumGrid />` (the classic grid: the whole album, or `photos={['dscf-0503', …]}`). Without a body
the page is the classic grid. In the album's frontmatter, `description` is the header text,
the header is the cover photo full screen (`hero: banner` for a smaller banner instead), and
`coverPosition: 50% 30%` picks which part of the cover stays in view when it's cropped.

## Deploying (one-time setup)

The site is a Cloudflare **Worker serving static assets** (see `wrangler.jsonc`), built by
Workers Builds from GitHub.

1. **R2**: create a bucket (e.g. `photos`), connect a custom domain such as
   `photos.jakubsekula.com`, and create an API token with Object Read & Write on it.
   Put the credentials in `site/.env` (see `.env.example`) and run `pnpm photos sync`.
2. **Worker** (Workers & Pages → Create → import the GitHub repo), then under Settings → Build:
   root directory `site`, build command `pnpm build`, deploy command `npx wrangler deploy`,
   build variable `PUBLIC_PHOTOS_URL=https://photos.jakubsekula.com`, and the production branch.
   The Worker's name must match `name` in `wrangler.jsonc`. The build fails if
   `PUBLIC_PHOTOS_URL` is missing, rather than shipping broken images.

Every push to the production branch builds and deploys.

## Migrating from the old site

All content was scraped from the live Strapi-backed site (its local database copy was out of
date). The old Next.js pages embed the Strapi records they render, including original upload
URLs, so `scripts/scrape-live.mjs` rebuilds projects, tools, albums (full-resolution
originals), the CV and the homepage from them:

```bash
pnpm scrape:live   # downloads are cached in .cache/, processed photos are reused
```

It overwrites `src/content` (except the blog) and the migrated assets, so it's a one-off: once
you start editing content here, don't run it again.
