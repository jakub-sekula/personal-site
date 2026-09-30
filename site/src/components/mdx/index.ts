// Components available in every post and album body without an import.
// Anything else can still be imported at the top of an .mdx file.
import Callout from './Callout.astro';
import ExposureCalc from './ExposureCalc.astro';
import Gallery from '../photos/Gallery.astro';
import Photo from '../photos/Photo.astro';

export const mdxComponents = { Callout, ExposureCalc, Gallery, Photo };
