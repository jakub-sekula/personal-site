import type { Photo } from './photos';

/** What the lightbox needs per photo (plain data, embedded in the page as JSON). */
export interface LightboxSlide {
  /** Largest WebP, plus a srcset so PhotoSwipe picks a size for the screen. */
  src: string;
  srcset: string;
  width: number;
  height: number;
  /** Small version shown instantly while the full image loads. */
  msrc: string;
  /** The thumbnail on the page crops the photo (object-cover), for the zoom-in animation. */
  thumbCropped?: boolean;
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
  items: {
    photo: Photo;
    title?: string;
    descriptionHtml?: string;
    href?: string;
    alt?: string;
    pageTitle?: string;
    thumbCropped?: boolean;
  }[],
): LightboxSlide[] {
  return items.map(({ photo, title, descriptionHtml, href, alt, pageTitle, thumbCropped }) => ({
    src: photo.largest,
    srcset: photo.srcset('webp'),
    width: photo.w,
    height: photo.h,
    msrc: photo.url(photo.widths[0]),
    ...(thumbCropped && { thumbCropped }),
    ...(alt && { alt }),
    ...(title && { title }),
    ...(descriptionHtml && { descriptionHtml }),
    ...(href && { href }),
    ...(pageTitle && { pageTitle }),
  }));
}
