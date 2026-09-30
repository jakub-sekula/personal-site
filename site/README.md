# jakubsekula.com

Static site built with [Astro](https://docs.astro.build), deployed to Cloudflare (Workers static assets).
Content lives in this repo as Markdown/MDX/YAML; photos live in a Cloudflare R2 bucket.

It's a backend-less port of the old Next.js + Strapi site and looks the same: the components
are ported one-to-one, styling is the old Tailwind **v3** config and `globals.css` unchanged
(`tailwind.config.cjs`, `src/styles/global.css`), and the photo lightbox is the same
yet-another-react-lightbox, loaded as a small React island on gallery pages only. Like the old
site it names Albert Sans / Inter / Source Code Pro but doesn't load web fonts.

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
| Photo albums | `src/content/albums/<slug>.mdx`: frontmatter lists photos (or child `albums`), body is the intro |
| Photo metadata | `src/data/photos/<album>.json`, **generated**, don't edit by hand |
| CV | `src/content/cv.yaml`, logos in `src/assets/cv/`, PDF in `public/` |
| Components usable in MDX without importing | `src/components/mdx/index.ts` |
| Content schemas | `src/content.config.ts` |

References between content (a project's `tools`/`posts`, the homepage's `projects`/`photography`,
an album's child `albums`) are checked at build time, so a typo fails the build instead of
rendering a hole. Anything with `draft: true` shows in `pnpm dev` only.

## Photos

Originals never go in git. `pnpm photos add` resizes each one into AVIF + WebP at
640/1280/1920/2560px plus a 1200px JPEG for link previews (EXIF and GPS stripped), writes
them to `public/photos/` (git-ignored), records dimensions and a blur placeholder in
`src/data/photos/<album>.json`, and appends the photos to the album file.

```bash
# New album (or add more photos to an existing one)
pnpm photos add portugal ~/Exports/portugal --title "🇵🇹 Portugal" --parent places

# Edit src/content/albums/portugal.mdx: reorder, add titles/descriptions/tags, pick the cover, write an intro.
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

While `pnpm dev` runs, **http://localhost:4321/dev/photos** lists every album's photos:

- Fill in title, description, tags, alt text and address; each change saves into the album
  file when you leave the field (formatting and comments are kept). Review with `git diff`.
- Copy a photo's `<Photo>` snippet or name; click thumbnails to select several (in order) and
  copy a `<Gallery>` snippet for a post.
- Set an album's cover, filter by album, search by name/title/tag, or show only untitled photos.

It's added by `integrations/photo-editor/` only in dev: it isn't part of the build, and it only
accepts writes from its own page.

### In posts

```mdx
<Photo src="greece/img-7785" />                                  {/* caption = the photo's title */}
<Photo src="greece/img-7785" caption="Markdown *works* here" />
<Gallery album="greece" />
<Gallery photos={[{ src: 'greece/img-7770' }, { src: 'greece/img-7607', caption: '…' }]} />
```

`caption` replaces the photo's description for that one use. When a pipeline update adds a new
file type, `pnpm photos backfill` creates it for existing photos (then run `pnpm photos sync`).

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
