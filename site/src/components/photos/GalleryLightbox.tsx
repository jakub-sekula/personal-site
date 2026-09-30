// The old site's lightbox (yet-another-react-lightbox with Zoom + Captions),
// as a small React island. The gallery markup itself is static HTML: any
// element inside #target with data-slide="<index>" opens that slide.
//
// Each photo has its own page. While the lightbox is open, the address bar
// shows the current photo's page (so it can be copied or shared) and the back
// button closes the lightbox. Cmd/Ctrl-click still opens the page itself.
import { useEffect, useMemo, useRef, useState } from 'react';
import Lightbox from 'yet-another-react-lightbox';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';
import type { LightboxSlide } from '../../lib/lightbox';

interface Props {
  target: string;
  slides: LightboxSlide[];
}

export default function GalleryLightbox({ target, slides }: Props) {
  const [openAt, setOpenAt] = useState(-1);
  const pushedHistory = useRef(false);
  const pageTitle = useRef('');

  const lightboxSlides = useMemo(
    () =>
      slides.map(({ descriptionHtml, href: _href, pageTitle: _title, ...slide }) => ({
        ...slide,
        description: descriptionHtml ? (
          <div className="lightbox-description" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
        ) : undefined,
      })),
    [slides],
  );

  // Point the address bar and tab title at the photo being shown.
  const showInUrl = (index: number) => {
    const slide = slides[index];
    if (!slide?.href) return;
    history.replaceState(history.state, '', slide.href);
    if (slide.pageTitle) document.title = slide.pageTitle;
  };

  const restoreUrl = () => {
    document.title = pageTitle.current;
    if (pushedHistory.current) {
      pushedHistory.current = false;
      history.back(); // back to the page the lightbox was opened from
    }
  };

  useEffect(() => {
    const root = document.getElementById(target);
    if (!root) return;

    const open = (index: number) => {
      pageTitle.current = document.title;
      if (slides[index]?.href) {
        history.pushState({ lightbox: true }, '', slides[index].href);
        pushedHistory.current = true;
        showInUrl(index);
      }
      setOpenAt(index);
    };

    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slide]');
      if (!el || !root.contains(el)) return;
      // Let modified clicks open the photo page (new tab, etc.).
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      open(Number(el.dataset.slide));
    };
    // Links already turn Enter into a click; this covers non-link tiles.
    const onKey = (e: KeyboardEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slide]');
      if (!el || el.tagName === 'A' || !root.contains(el) || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      open(Number(el.dataset.slide));
    };
    // Browser back while the lightbox is open closes it.
    const onPopState = () => {
      if (!pushedHistory.current) return;
      pushedHistory.current = false;
      document.title = pageTitle.current;
      setOpenAt(-1);
    };

    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPopState);
    return () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPopState);
    };
  }, [target, slides]);

  return (
    <Lightbox
      plugins={[Zoom, Captions]}
      open={openAt >= 0}
      index={Math.max(openAt, 0)}
      captions={{ descriptionTextAlign: 'center' }}
      carousel={{ preload: 2 }}
      controller={{ closeOnBackdropClick: true }}
      on={{ view: ({ index }) => openAt >= 0 && showInUrl(index) }}
      close={() => {
        setOpenAt(-1);
        restoreUrl();
      }}
      slides={lightboxSlides}
    />
  );
}
