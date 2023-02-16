import { useRouter } from "next/router";
import Image from "next/image";
import { motion } from "framer-motion";

import { Hyperlink } from "components/common";
import { useAnimationContext } from "components/contexts";
import Link from "next/link";

export default function PhotographySection({ title }) {
  const { sectionEntryAnimation } = useAnimationContext();

  return (
    <motion.section
      // {...sectionEntryAnimation}
      id="photography-section"
      className="mx-auto flex w-full max-w-page flex-col items-center gap-12"
    >
      <h2 id={title} className="font-heading text-4xl font-semibold text-js-yellow">
        {title}
      </h2>
      <div className="relative grid w-full grid-cols-12 gap-4">
        <PhotoCard img="/images/travel.jpg" title="travel" />
        <PhotoCard img="/images/architecture.jpg" title="architecture" />
        <PhotoCard img="/images/analogue.jpg" title="analogue" />
        <PhotoCard img="/images/monochrome.jpg" title="monochrome" />
        <PhotoCard img="/images/portraits.jpg" title="portraits" />
        <PhotoCard img="/images/experiments.jpg" title="experiments" />
      </div>
      <Hyperlink title="Go to photography page" href="/photography" />
    </motion.section>
  );
}

function PhotoCard({ title = "Photo", img = "IMG_1933.jpg" }) {
  const { cardEntryAnimation } = useAnimationContext();

  return (
    <Link
    scroll={false}
      href={`/photography/${title}`}
      className="relative col-span-4 flex h-56 w-full flex-col items-center justify-center gap-4 overflow-hidden
    rounded-md border border-neutral-200 dark:border-0 px-3 py-6 font-bold"
      key={`photocard-${title}`}
    >
      <Image
        width={400}
        height={100}
        src={img}
        alt={title}
        className="absolute inset-0 -z-10 h-full w-full"
      />
      <h6 className="z-10 font-heading text-4xl font-bold text-white">
        {title.toUpperCase()}
      </h6>
    </Link>
  );
}
