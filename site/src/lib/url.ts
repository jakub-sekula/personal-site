/**
 * The page's path as visitors see it. With `build.format: 'file'`, Astro.url
 * in a build ends in ".html" ("/projects.html", "/index.html"), while the site
 * is served without it; in dev it has neither. Returns "/", "/projects",
 * "/photography/iceland", … in both.
 */
export const pagePath = (url: URL) =>
  url.pathname
    .replace(/\.html$/, '')
    .replace(/\/index$/, '/')
    .replace(/(.)\/$/, '$1');
