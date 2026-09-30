import type { Photo } from './photos';

/** What the lightbox island needs per photo (plain data, serialised into the page). */
export interface LightboxSlide {
  src: string;
  width: number;
  height: number;
  srcSet: { src: string; width: number; height: number }[];
  alt?: string;
  title?: string;
  /** Rendered Markdown. */
  descriptionHtml?: string;
  /** The photo's own page; the address bar shows it while the photo is open. */
  href?: string;
  /** Tab title while the photo is open. */
  pageTitle?: string;
}

export function toSlides(
  items: { photo: Photo; title?: string; descriptionHtml?: string; href?: string; alt?: string; pageTitle?: string }[],
): LightboxSlide[] {
  return items.map(({ photo, title, descriptionHtml, href, alt, pageTitle }) => ({
    src: photo.largest,
    width: photo.w,
    height: photo.h,
    srcSet: photo.widths.map((w) => ({ src: photo.url(w), width: w, height: Math.round((photo.h * w) / photo.w) })),
    ...(alt && { alt }),
    ...(title && { title }),
    ...(descriptionHtml && { descriptionHtml }),
    ...(href && { href }),
    ...(pageTitle && { pageTitle }),
  }));
}
