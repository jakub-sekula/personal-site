// The local site editor at /dev (also /dev/photos), only while `astro dev` runs:
// photos and albums (./api.mjs), blog posts and the CV (./content-api.mjs), all
// saved into the files in the repo. Nothing of this is part of the built site.
import {
  createCollection,
  getSettings,
  saveSettings,
  deleteCollection,
  listAlbums,
  photoFiles,
  removePhoto,
  reorderPhotos,
  setCollectionAlbums,
  setCover,
  syncNow,
  syncStatus,
  updateAlbum,
  updatePhoto,
  uploadPhoto,
} from './api.mjs';
import { publish, publishStatus } from './publish-api.mjs';
import { createPost, deletePost, getCv, getPost, listPosts, saveCv, savePost, uploadCvLogo, uploadPostImage } from './content-api.mjs';

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}');
}

const ok = () => ({ saved: true });

/** GET handlers, POST JSON handlers and POST upload (raw body) handlers, by path. */
const PHOTOS = {
  get: {
    '/': async () => ({ albums: await listAlbums() }),
    '/sync': () => syncStatus(),
    '/files': (params) => photoFiles(params),
    '/settings': () => getSettings(),
  },
  post: {
    '/photo': (body) => updatePhoto(body).then((saved) => ({ saved })),
    '/cover': (body) => setCover(body).then(ok),
    '/order': (body) => reorderPhotos(body).then(ok),
    '/remove': (body) => removePhoto(body).then(ok),
    '/album': (body) => updateAlbum(body).then(ok),
    '/collection': (body) => createCollection(body).then(ok),
    '/collection/albums': (body) => setCollectionAlbums(body).then(ok),
    '/collection/delete': (body) => deleteCollection(body).then(ok),
    '/sync': () => syncNow(),
    '/settings': (body) => saveSettings(body),
  },
  upload: { '/upload': uploadPhoto },
};

const CONTENT = {
  get: {
    '/posts': async () => ({ posts: await listPosts() }),
    '/post': (params) => getPost(params),
    '/cv': () => getCv(),
    '/publish': () => publishStatus(),
  },
  post: {
    '/post': (body) => savePost(body),
    '/post/create': (body) => createPost(body),
    '/post/delete': (body) => deletePost(body).then(ok),
    '/cv': (body) => saveCv(body),
  },
  upload: { '/post/image': uploadPostImage, '/cv/logo': uploadCvLogo },
  // Long jobs that report progress: one JSON object per line as they go.
  stream: { '/publish': publish },
};

function handler(routes) {
  return async (req, res) => {
    const send = (status, data) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    const url = new URL(req.url, 'http://localhost');
    const params = Object.fromEntries(url.searchParams);
    try {
      if (req.method === 'GET') {
        const get = routes.get[url.pathname];
        return get ? send(200, await get(params)) : send(404, { error: 'Unknown action' });
      }
      // Writes only from the editor page itself: from our own origin, and either JSON
      // or carrying our header (both need a CORS preflight from other sites, which we
      // never approve).
      const origin = req.headers.origin;
      const type = req.headers['content-type'] ?? '';
      const json = type.startsWith('application/json');
      const ours = json || req.headers['x-photo-editor'] === '1';
      if (req.method !== 'POST' || !ours || (origin && new URL(origin).host !== req.headers.host)) {
        return send(403, { error: 'Not allowed' });
      }
      const stream = routes.stream?.[url.pathname];
      if (stream && json) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/x-ndjson');
        const emit = (event) => res.write(`${JSON.stringify(event)}\n`);
        try {
          emit({ result: await stream(await readJson(req), emit) });
        } catch (error) {
          emit({ error: error.message });
        }
        return res.end();
      }
      const upload = routes.upload[url.pathname];
      if (upload) return send(200, await upload(req, params));
      const action = routes.post[url.pathname];
      if (!action || !json) return send(404, { error: 'Unknown action' });
      return send(200, await action(await readJson(req)));
    } catch (error) {
      return send(400, { error: error.message });
    }
  };
}

export default function photoEditor() {
  return {
    name: 'photo-editor',
    hooks: {
      'astro:config:setup': async ({ command, injectRoute, updateConfig }) => {
        if (command !== 'dev') return;
        // The editor is a React app (shadcn/ui); React is added only for `astro dev`,
        // so it's never part of the site's build.
        const { default: react } = await import('@astrojs/react');
        updateConfig({ integrations: [react()] });
        const entrypoint = new URL('./PhotoEditor.astro', import.meta.url);
        injectRoute({ pattern: '/dev', entrypoint });
        injectRoute({ pattern: '/dev/photos', entrypoint });
      },

      'astro:server:setup': ({ server }) => {
        server.middlewares.use('/dev/api/photos', handler(PHOTOS));
        server.middlewares.use('/dev/api/content', handler(CONTENT));
      },

      'astro:server:start': ({ address, logger }) => {
        const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
        logger.info(`Site editor: http://${host === '::1' || host === '[::1]' || host === '127.0.0.1' ? 'localhost' : host}:${address.port}/dev`);
      },
    },
  };
}
