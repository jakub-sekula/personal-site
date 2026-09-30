// Local photo editor at /dev/photos, only while `astro dev` runs: browse every
// album's photos, edit their titles/descriptions/tags (saved into the album
// files), and copy <Photo>/<Gallery> snippets for posts. Nothing of this is
// part of the built site.
import { listAlbums, setCover, updatePhoto } from './api.mjs';

const API = '/dev/api/photos';

async function readJson(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}');
}

export default function photoEditor() {
  return {
    name: 'photo-editor',
    hooks: {
      'astro:config:setup': ({ command, injectRoute }) => {
        if (command !== 'dev') return;
        injectRoute({ pattern: '/dev/photos', entrypoint: new URL('./PhotoEditor.astro', import.meta.url) });
      },

      'astro:server:setup': ({ server }) => {
        server.middlewares.use(API, async (req, res) => {
          const send = (status, data) => {
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          };
          try {
            if (req.method === 'GET') return send(200, { albums: await listAlbums() });

            // Writes only from the editor page itself: JSON (so other sites can't send it
            // without a CORS preflight, which we never approve) from our own origin.
            const origin = req.headers.origin;
            if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json') || (origin && new URL(origin).host !== req.headers.host)) {
              return send(403, { error: 'Not allowed' });
            }
            const body = await readJson(req);
            if (req.url === '/photo') return send(200, { saved: await updatePhoto(body) });
            if (req.url === '/cover') return send(200, { saved: await setCover(body) });
            return send(404, { error: 'Unknown action' });
          } catch (error) {
            return send(400, { error: error.message });
          }
        });
      },

      'astro:server:start': ({ address, logger }) => {
        const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
        logger.info(`Photo editor: http://${host === '::1' || host === '[::1]' || host === '127.0.0.1' ? 'localhost' : host}:${address.port}/dev/photos`);
      },
    },
  };
}
