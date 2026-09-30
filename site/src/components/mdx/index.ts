// Components available in every post and album body without an import.
// Anything else can still be imported at the top of an .mdx file.
import AlbumGrid from '../photos/AlbumGrid.astro';
import Callout from './Callout.astro';
import ExposureCalc from './ExposureCalc.astro';
import Cover from '../photos/Cover.astro';
import Gallery from '../photos/Gallery.astro';
import Photo from '../photos/Photo.astro';
import Row from '../photos/Row.astro';
import Side from '../photos/Side.astro';

export const mdxComponents = { AlbumGrid, Callout, Cover, ExposureCalc, Gallery, Photo, Row, Side };
