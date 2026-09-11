import { CustomIconSchema } from '@/lib/domain';

/**
 * An icon as uploaded: the document's own shape of it, with one picture.
 *
 * The browser sanitised the SVG before it got here — the server has no DOM
 * to do it again — so what is checked is the shape, the sizes the schema
 * already bounds, and that there is exactly one picture: a vector or a
 * raster, never neither and never both.
 */
export const IconBodySchema = CustomIconSchema.strict().refine(
  (icon) => Boolean(icon.svg) !== Boolean(icon.image),
  { message: 'An icon carries either a vector or an image.' },
);
