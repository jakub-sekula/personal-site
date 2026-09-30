// The old site's lightbox (yet-another-react-lightbox with Zoom + Captions,
// same options), as a small React island. The gallery markup itself is static
// HTML: any element inside #target with data-slide="<index>" opens that slide.
import { useEffect, useState } from 'react';
import Lightbox, { type SlideImage } from 'yet-another-react-lightbox';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';

interface Props {
  target: string;
  slides: SlideImage[];
}

export default function GalleryLightbox({ target, slides }: Props) {
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    const root = document.getElementById(target);
    if (!root) return;
    const open = (e: Event) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slide]');
      if (!el || !root.contains(el)) return;
      if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      setIndex(Number(el.dataset.slide));
    };
    root.addEventListener('click', open);
    root.addEventListener('keydown', open);
    return () => {
      root.removeEventListener('click', open);
      root.removeEventListener('keydown', open);
    };
  }, [target]);

  return (
    <Lightbox
      plugins={[Zoom, Captions]}
      open={index >= 0}
      index={Math.max(index, 0)}
      captions={{ descriptionTextAlign: 'center' }}
      carousel={{ preload: 2 }}
      controller={{ closeOnBackdropClick: true }}
      close={() => setIndex(-1)}
      slides={slides}
    />
  );
}
