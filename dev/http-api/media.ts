/**
 * The media the dev HTTP API serves: the media the synthetic player events play, from the one list
 * of media ids in the dev environment, with a title, a publication date, a duration and a
 * thumbnail. A search counts plays by media id; this API gives the rest, so a panel can join both.
 */
import { type CoreMedia, coreMedia } from '../log-seed/core-events-catalog.ts';

/** A media as the API serves it. */
interface MediaRow {
  readonly id: string;
  readonly bu: string;
  readonly type: CoreMedia['type'];
  readonly title: string;
  /** When it was published, ISO 8601. */
  readonly published_at: string;
  readonly duration_s: number;
  /** A thumbnail on the API's own host. */
  readonly thumbnail: string;
}

/** The title of each kind of media, in the order of the kinds of a business unit. */
const titles = ['Evening news', 'Match highlights', 'Morning show'];

/**
 * Every media, or those asked for.
 *
 * @param origin - The API's own origin, for the thumbnail URLs.
 * @param ids - The ids wanted; every media when empty.
 * @param units - The business units wanted; every one when empty.
 * @returns The media, in the order of the list.
 */
export function mediaRows(
  origin: string,
  ids: readonly string[] = [],
  units: readonly string[] = [],
): MediaRow[] {
  const day = Date.UTC(2026, 0, 5);
  return coreMedia
    .map((media, index) => ({
      id: media.id,
      bu: media.bu,
      type: media.type,
      title: `${media.bu[0]?.toUpperCase()}${media.bu.slice(1)}: ${titles[index % 3]}`,
      published_at: new Date(day + index * 86_400_000).toISOString(),
      duration_s: media.type === 'audio' ? 3600 : 600 + index * 60,
      thumbnail: `${origin}/thumbnails/${index + 1}.svg`,
    }))
    .filter((media) => ids.length === 0 || ids.includes(media.id))
    .filter((media) => units.length === 0 || units.includes(media.bu));
}

/**
 * A thumbnail: a coloured square with the media's number.
 *
 * @param number - The media's place in the list, from 1.
 * @returns The SVG, or `undefined` for a number no media has.
 */
export function thumbnail(number: number): string | undefined {
  if (!Number.isInteger(number) || number < 1 || number > coreMedia.length) return undefined;
  const hue = Math.round((number * 360) / coreMedia.length);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="hsl(${hue} 60% 45%)"/><text x="80" y="55" font-size="32" text-anchor="middle" fill="#fff">${number}</text></svg>`;
}
