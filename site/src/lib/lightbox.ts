import type { SlideImage } from 'yet-another-react-lightbox';
import { getPhoto } from './photos';

/** Lightbox slides for a list of photos (full-size WebP with a srcset, like the old site). */
export function toSlides(photos: { src: string; caption?: string }[]): SlideImage[] {
  return photos.map(({ src, caption }) => {
    const photo = getPhoto(src);
    return {
      src: photo.largest,
      width: photo.w,
      height: photo.h,
      srcSet: photo.widths.map((w) => ({ src: photo.url(w), width: w, height: Math.round((photo.h * w) / photo.w) })),
      ...(caption && { description: caption }),
    };
  });
}
