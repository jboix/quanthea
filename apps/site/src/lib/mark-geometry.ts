/**
 * The geometry of the quanthea mark, read from `docs/brand/quanthea-mark.svg` at build time, so the
 * site draws the mark inline (in the current text colour) without a copy of its shapes.
 */
import markSvg from '../../../../docs/brand/quanthea-mark.svg?raw';

/** One shape of the mark: its tag and its attributes. */
export interface MarkShape {
  /** `circle`, `polyline` or `path`. */
  readonly tag: 'circle' | 'polyline' | 'path';
  /** The attributes as written, with the stroke and fill colours. */
  readonly attributes: Readonly<Record<string, string>>;
  /** Whether this is the signal dot, the one shape filled in the brand orange. */
  readonly signal: boolean;
}

/**
 * Reads the attributes of one element.
 *
 * @param source - The text between the tag name and `/>`.
 * @returns The attributes.
 */
function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([a-z-]+)="([^"]*)"/g)) {
    if (match[1] !== undefined && match[2] !== undefined) attributes[match[1]] = match[2];
  }
  return attributes;
}

/**
 * Reads the shapes of an SVG mark.
 *
 * @param svg - The SVG source.
 * @returns The shapes in drawing order.
 */
export function readMarkShapes(svg: string): MarkShape[] {
  const shapes: MarkShape[] = [];
  for (const match of svg.matchAll(/<(circle|polyline|path)\s([^>]*?)\/>/g)) {
    const tag = match[1] as MarkShape['tag'];
    const attributes = attributesOf(match[2] ?? '');
    const signal = attributes.fill?.startsWith('#') === true;
    shapes.push({ tag, attributes, signal });
  }
  return shapes;
}

/** The mark's view box. */
export const markViewBox: string = /viewBox="([^"]+)"/.exec(markSvg)?.[1] ?? '0 0 64 64';

/** The mark's shapes. */
export const markShapes: readonly MarkShape[] = readMarkShapes(markSvg);
