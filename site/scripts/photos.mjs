#!/usr/bin/env node
// Photo CLI.
//
//   pnpm photos add <album> <folder-or-files...> [--title "🇵🇹 Portugal"] [--parent places]
//     Resize the images, update src/data/photos/<album>.json and append them to
//     src/content/albums/<album>.mdx (created if missing). --parent also lists
//     the album inside another one (e.g. a country inside Places).
//
//   pnpm photos sync [--dry-run]
//     Upload anything in public/photos/ that isn't in the R2 bucket yet.
//     Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (see .env.example).

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  IMAGE_EXT,
  OUT_DIR,
  appendPhotos,
  newAlbumDoc,
  processPhotos,
  readAlbum,
  slugify,
  writeAlbum,
} from './lib/photos.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    parent: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const [command, ...rest] = positionals;

if (command === 'add') await add(rest);
else if (command === 'sync') await sync();
else {
  console.error('Usage: pnpm photos add <album> <folder-or-files...> [--title ...] [--parent ...]\n       pnpm photos sync [--dry-run]');
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
    const parent = await readAlbum(values.parent);
    if (!parent) throw new Error(`--parent: no album "${values.parent}"`);
    if (!parent.doc.has('albums')) parent.doc.set('albums', parent.doc.createNode([]));
    const children = parent.doc.get('albums');
    if (!children.items.some((item) => String(item.value ?? item) === album)) children.add(album);
    await writeAlbum(values.parent, parent);
    console.log(`Listed it in src/content/albums/${values.parent}.mdx.`);
  }

  console.log('Next: add captions if you like, then `pnpm photos sync` and commit.');
}

async function sync() {
  const { S3Client, ListObjectsV2Command, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('sync: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET (e.g. in site/.env)');
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    // Newer AWS SDKs add CRC checksums to every request; only send them when S3 requires it.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const remote = new Set();
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token }));
    page.Contents?.forEach((o) => remote.add(o.Key));
    token = page.NextContinuationToken;
  } while (token);

  const local = (await readdir(OUT_DIR, { recursive: true, withFileTypes: true }))
    .filter((d) => d.isFile() && /\.(avif|webp)$/.test(d.name))
    .map((d) => path.relative(OUT_DIR, path.join(d.parentPath, d.name)).split(path.sep).join('/'));
  const pending = local.filter((key) => !remote.has(key));

  console.log(`${local.length} local variant(s), ${remote.size} in bucket, ${pending.length} to upload.`);
  if (values['dry-run'] || pending.length === 0) return;

  let done = 0;
  const queue = [...pending];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let key; (key = queue.shift()); ) {
        await s3.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: await readFile(path.join(OUT_DIR, key)),
            ContentType: key.endsWith('.avif') ? 'image/avif' : 'image/webp',
            // Photo ids include a content hash, so a URL never changes content.
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
        if (++done % 25 === 0 || done === pending.length) console.log(`  uploaded ${done}/${pending.length}`);
      }
    }),
  );
}
