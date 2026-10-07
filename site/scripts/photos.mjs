#!/usr/bin/env node
// Photo CLI.
//
//   pnpm photos add <album> <folder-or-files...> [--title "🇵🇹 Portugal"] [--parent places]
//     Resize the images, update src/data/photos/<album>.json and append them to
//     src/content/albums/<album>.mdx (created if missing). --parent also lists
//     the album inside another one (e.g. a country inside Places).
//
//   pnpm photos backfill
//     Create any files that newer versions of the pipeline add (e.g. og.jpg link
//     previews) for photos processed before, from their existing variants.
//
//   pnpm photos share [<album>...] [--force]
//     Draw the link-preview pictures (og:image) of the photography pages that are
//     missing or out of date (all of them with --force), into public/photos/_share/
//     and src/data/share-images.json (see scripts/lib/share.mjs). The editor and
//     Publish do this by themselves.
//
//   pnpm photos sync [--dry-run]
//     Upload anything in public/photos/ that isn't in the R2 bucket yet, or that
//     differs from the copy there (e.g. after its metadata was updated).
//     Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (see .env.example).

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { syncPhotos } from './lib/sync.mjs';
import { updateShareImages } from './lib/share.mjs';
import {
  IMAGE_EXT,
  listInParent,
  MANIFEST_DIR,
  OUT_DIR,
  appendPhotos,
  deriveMissing,
  newAlbumDoc,
  processPhotos,
  readAlbum,
  readManifest,
  slugify,
  writeAlbum,
} from './lib/photos.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    parent: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

const [command, ...rest] = positionals;

if (command === 'add') await add(rest);
else if (command === 'backfill') await backfill();
else if (command === 'sync') await sync();
else if (command === 'share') await share(rest);
else {
  console.error('Usage: pnpm photos add <album> <folder-or-files...> [--title ...] [--parent ...]\n       pnpm photos backfill\n       pnpm photos share [<album>...] [--force]\n       pnpm photos sync [--dry-run]');
  process.exit(1);
}

async function add([albumArg, ...inputs]) {
  if (!albumArg || inputs.length === 0) throw new Error('add: expected <album> and at least one folder or file');
  const album = slugify(albumArg);

  const files = [];
  for (const input of inputs) {
    if ((await stat(input)).isDirectory()) {
      const names = (await readdir(input)).filter((n) => IMAGE_EXT.test(n)).sort();
      files.push(...names.map((n) => path.join(input, n)));
    } else if (IMAGE_EXT.test(input)) {
      files.push(input);
    }
  }
  if (files.length === 0) throw new Error('add: no images found');

  console.log(`Processing ${files.length} photo(s) into "${album}"…`);
  const results = await processPhotos(files, album, {
    onProgress: (done, total, r) => console.log(`  [${done}/${total}] ${r.id}${r.skipped ? ' (unchanged)' : ''}`),
  });
  const srcs = results.map((r) => `${album}/${r.id}`);

  const existing = await readAlbum(album);
  const albumFile = existing ?? {
    doc: newAlbumDoc({
      title: values.title ?? albumArg,
      cover: srcs[0],
      date: new Date().toISOString().slice(0, 10),
      photos: [],
    }),
    body: '',
  };
  const added = appendPhotos(albumFile.doc, srcs);
  await writeAlbum(album, albumFile);

  console.log(`\n${existing ? 'Updated' : 'Created'} src/content/albums/${album}.mdx (+${added} photo(s)).`);

  if (values.parent) {
    await listInParent(album, values.parent);
    console.log(`Listed it in src/content/albums/${values.parent}.mdx.`);
  }

  console.log('Next: add titles, descriptions and tags if you like, then `pnpm photos sync` and commit.');
}

async function backfill() {
  let made = 0;
  for (const file of (await readdir(MANIFEST_DIR)).filter((f) => f.endsWith('.json'))) {
    const album = path.basename(file, '.json');
    for (const [id, entry] of Object.entries(await readManifest(album))) {
      made += (await deriveMissing(album, id, entry)).length;
    }
  }
  console.log(`Created ${made} file(s). Run \`pnpm photos sync\` to upload them.`);
}

async function share(albums) {
  const { drawn, removed } = await updateShareImages({
    only: albums.length ? albums : undefined,
    force: values.force,
    onProgress: (n, total, page) => process.stdout.write(`\r  ${n}/${total} ${page}`.padEnd(40)),
  });
  process.stdout.write('\n');
  console.log(`Drew ${drawn.length} link-preview picture(s)${drawn.length ? `: ${drawn.join(', ')}` : ''}; removed ${removed.length} old one(s).`);
  if (drawn.length) console.log('Upload them with `pnpm photos sync` (Publish does it too).');
}

async function sync() {
  const result = await syncPhotos({
    dryRun: values['dry-run'],
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) console.log(`  uploaded ${done}/${total}`);
    },
  });
  console.log(
    `${result.local} local variant(s), ${result.remote} in bucket: ${result.added} new and ${result.changed} changed` +
      (values['dry-run'] ? ' to upload.' : `, ${result.uploaded} uploaded.`),
  );
}
