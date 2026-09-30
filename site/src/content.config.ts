import { defineCollection, reference, type SchemaContext } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Photos are referenced as "<album>/<photoId>" and resolved against
// src/data/photos/<album>.json at build time (see src/lib/photos.ts).
const photoRef = z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/, 'expected "<album>/<photoId>"');
const accent = z.enum(['green', 'yellow', 'blue', 'red']);

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string().optional(),
      date: z.coerce.date(),
      tags: z.array(z.string()).default([]),
      cover: image().optional(),
      /** A photo from the library as the cover, instead of an image file next to the post. */
      coverPhoto: photoRef.optional(),
      /**
       * "story": a photo-led page. Opens with the cover photo full screen, has no
       * table of contents, and photos can be wider than the text (see lib/story.ts).
       */
      // (Not `layout`: in MDX frontmatter Astro reads that as a layout component to import.)
      format: z.enum(['post', 'story']).default('post'),
      draft: z.boolean().default(false),
    }),
});

// The Markdown body is the project description.
const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      excerpt: z.string().optional(),
      type: z.enum(['Software', 'Engineering', 'Commercial']),
      color: accent.default('green'),
      /** Shown large on the homepage ("highlighted" in the old CMS). */
      featured: z.boolean().default(false),
      /** Position on the projects page. */
      order: z.number().default(0),
      cover: image(),
      /** Optional tighter crop for small cards. */
      coverSmall: image().optional(),
      github: z.url().optional(),
      demo: z.url().optional(),
      tags: z.array(z.string()).default([]),
      tools: z.array(reference('tools')).default([]),
      posts: z.array(reference('blog')).default([]),
      draft: z.boolean().default(false),
    }),
});

const tools = defineCollection({
  loader: file('src/content/tools.yaml'),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      category: z.enum(['frontend', 'backend', 'general', 'engineering']).optional(),
      icon: image().optional(), // for light backgrounds
      iconDark: image().optional(), // for dark backgrounds
      /** Use `icon` in dark mode too. */
      preferLight: z.boolean().default(false),
      /** Show the small icon on homepage project blurbs. */
      showOnHomepage: z.boolean().default(true),
    }),
});

// The Markdown body is the album description.
const albums = defineCollection({
  loader: glob({ pattern: '*.{md,mdx}', base: './src/content/albums' }),
  schema: z.object({
    title: z.string(),
    /** Plain text, in the album header. (The MDX body, if any, lays out the album page: see [album].astro.) */
    description: z.string().optional(),
    cover: photoRef,
    /** The album header: the cover photo full screen, edge to edge (default), or a banner. */
    hero: z.enum(['full', 'banner']).optional(),
    /** Which part of the cover stays in view when it's cropped (CSS object-position, e.g. "50% 30%"). */
    coverPosition: z.string().optional(),
    date: z.coerce.date(),
    draft: z.boolean().default(false),
    /** Shown under the description in the album header. */
    tags: z.array(z.string()).default([]),
    /** Child albums, for a grouping album like "Places". */
    albums: z.array(reference('albums')).default([]),
    // Each photo gets its own page at /photography/<album>/<slug>; every field is optional.
    photos: z
      .array(
        z.object({
          src: photoRef,
          title: z.string().optional(),
          /** Markdown. Shown on the photo's page and in the lightbox. */
          description: z.string().optional(),
          /** Photo tags, listed at /photography/tags/<tag>. */
          tags: z.array(z.string()).default([]),
          /** For screen readers; falls back to the title, then the album title. */
          alt: z.string().optional(),
          /** Address of the photo's page. Defaults to its file name (e.g. dscf-1434). */
          slug: z
            .string()
            .regex(/^[a-z0-9-]+$/)
            .optional(),
          /** Start a new grid block at this photo (Strapi albums were split into sections). */
          newSection: z.boolean().optional(),
        }),
      )
      .default([]),
  }),
});

// Which albums the photography page and its sidebar list, in order (single entry "photography").
const photography = defineCollection({
  loader: file('src/content/photography.yaml'),
  schema: z.object({
    index: z.array(reference('albums')),
    sidebar: z.array(reference('albums')),
  }),
});

const cvEntry = ({ image }: SchemaContext) =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('role'),
      title: z.string(),
      place: z.string().optional(),
      years: z.string().optional(),
      logo: image().optional(),
      bullets: z.array(z.string()).default([]),
      hidden: z.boolean().default(false),
    }),
    z.object({
      kind: z.literal('list'),
      title: z.string(),
      items: z.array(z.string()),
      hidden: z.boolean().default(false),
    }),
    z.object({
      kind: z.literal('bullets'),
      bullets: z.array(z.string()),
      hidden: z.boolean().default(false),
    }),
  ]);

// A single entry ("cv") so the sections keep the order they have in the file.
const cv = defineCollection({
  loader: file('src/content/cv.yaml'),
  schema: (ctx) =>
    z.object({
      pdf: z.string().optional(),
      linkedin: z.url().optional(),
      sections: z.array(
        z.object({
          title: z.string(),
          accent: accent.optional(),
          entries: z.array(cvEntry(ctx)),
        }),
      ),
    }),
});

// Homepage copy and which projects/tools/albums it features (single entry "home").
const home = defineCollection({
  loader: file('src/content/home.yaml'),
  schema: ({ image }) =>
    z.object({
      headline: z.string(),
      avatar: image(),
      background: image(),
      socials: z.array(z.object({ name: z.string(), url: z.url(), icon: image() })).default([]),
      about: z.string(),
      projects: z.array(z.object({ title: z.string(), projects: z.array(reference('projects')) })).default([]),
      skills: z.array(z.object({ title: z.string(), tools: z.array(reference('tools')) })).default([]),
      photography: z.array(reference('albums')).default([]),
      showBlog: z.boolean().default(false),
    }),
});

export const collections = { blog, projects, tools, albums, photography, cv, home };
