// Upload photo variants from public/photos/ to the R2 bucket: anything missing
// there, or different from the copy there (MD5 vs ETag). Used by
// `pnpm photos sync` and the photo editor's upload button.
//
// Needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in the
// environment (site/.env; see .env.example).

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OUT_DIR, ROOT } from './photos.mjs';

const TYPES = { avif: 'image/avif', webp: 'image/webp', jpg: 'image/jpeg' };

function r2Config() {
  // `pnpm photos` loads .env itself; the dev server (photo editor) doesn't.
  if (!process.env.R2_BUCKET) {
    try {
      process.loadEnvFile(path.join(ROOT, '.env'));
    } catch {}
  }
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET (e.g. in site/.env)');
  }
  return { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET };
}

/**
 * Compare public/photos/ with the bucket and (unless `dryRun`) upload what's
 * new or changed. Returns { local, remote, added, changed, uploaded }.
 */
export async function syncPhotos({ dryRun = false, onProgress } = {}) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = r2Config();
  const { S3Client, ListObjectsV2Command, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    // Newer AWS SDKs add CRC checksums to every request; only send them when S3 requires it.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  // Key -> ETag, which for a single-part upload is the MD5 of the contents.
  const remote = new Map();
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token }));
    page.Contents?.forEach((o) => remote.set(o.Key, o.ETag?.replaceAll('"', '')));
    token = page.NextContinuationToken;
  } while (token);

  const local = (await readdir(OUT_DIR, { recursive: true, withFileTypes: true }))
    .filter((d) => d.isFile() && /\.(avif|webp|jpg)$/.test(d.name))
    .map((d) => path.relative(OUT_DIR, path.join(d.parentPath, d.name)).split(path.sep).join('/'));
  const md5 = async (key) => createHash('md5').update(await readFile(path.join(OUT_DIR, key))).digest('hex');
  const pending = [];
  for (const key of local) if (!remote.has(key) || remote.get(key) !== (await md5(key))) pending.push(key);
  const changed = pending.filter((key) => remote.has(key)).length;
  const result = { local: local.length, remote: remote.size, added: pending.length - changed, changed, uploaded: 0 };
  if (dryRun || pending.length === 0) return result;

  const queue = [...pending];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let key; (key = queue.shift()); ) {
        await s3.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: await readFile(path.join(OUT_DIR, key)),
            ContentType: TYPES[key.split('.').pop()],
            // Photo ids include a content hash, so a URL never shows a different photo
            // (a re-upload only ever changes metadata).
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
        // (Counted outside the call: with no onProgress, `?.()` skips its arguments too.)
        result.uploaded++;
        onProgress?.(result.uploaded, pending.length);
      }
    }),
  );
  return result;
}
