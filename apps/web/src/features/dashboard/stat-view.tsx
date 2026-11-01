import {
  createFormatter,
  type Mapping,
  mappedResult,
  mapValue,
  maxStatTiles,
  type QueryOutcome,
  reduceResult,
  type StatTile,
  type StatView as StatViewSpec,
  statTiles,
} from '@quanthea/shared';
import type { CSSProperties } from 'react';
import { fittedNumber } from '../../ui/fitted-number.ts';
import { LinkTo } from './link-to.tsx';
import { hrefOf, type PanelLinks } from './links.ts';
import styles from './stat.module.css';
import { toneStyle } from './tone.ts';

/** Props of {@link StatView}. */
interface StatViewProps {
  /** The stat view. */
  readonly view: StatViewSpec;
  /** The outcome of each query of the panel. */
  readonly queries: readonly QueryOutcome[];
  /** The IANA time zone, or the browser's. */
  readonly timeZone: string | undefined;
  /** What the stat's link is built from; without it, a linked stat shows its value only. */
  readonly links?: PanelLinks | undefined;
}

/** Writes a value with the stat's format. */
type Format = (value: unknown) => string;

/**
 * The line under a stat: the comparison, then the subtitle, where `{{A.max}}` shows a reduced
 * result with the stat's format.
 *
 * @param view - The stat view.
 * @param queries - The query outcomes.
 * @param format - Formats a number with the stat's format.
 * @returns The line, or an empty string.
 */
function statSubtitle(view: StatViewSpec, queries: readonly QueryOutcome[], format: Format) {
  const compare = view.compare
    ? `${view.compare.label} ${format(reduceResult(queries, view.compare.ref, view.compare.reduce)) || '–'}`
    : '';
  const subtitle = (view.subtitle ?? '').replace(
    /\{\{(\w+)\.(\w+)\}\}/g,
    (_token, ref: string, reduce: string) =>
      format(reduceResult(queries, ref, reduce as StatViewSpec['reduce'])),
  );
  return [compare, subtitle].filter(Boolean).join(' · ');
}

/** What a stat shows. */
interface StatText {
  /** The text: the mapping's, or the value written with the stat's format. */
  readonly text: string;
  /** The mapping of the value, when one matches. */
  readonly mapped?: Mapping | undefined;
}

/**
 * What a stat shows. Without mappings it is the reduced number, as ever. With mappings, the first
 * that matches the value gives the text and the tone, and a value that is not a number, which no
 * mapping gives a text, is written as it is.
 *
 * @param view - The stat view.
 * @param queries - The query outcomes.
 * @param format - Writes a value with the stat's format.
 * @returns The text, a dash for no value, and the mapping that matched.
 */
function statText(view: StatViewSpec, queries: readonly QueryOutcome[], format: Format): StatText {
  const number = reduceResult(queries, view.ref, view.reduce, view.field);
  if (!view.mappings) return { text: format(number) || '–' };
  const value = mappedResult(queries, view.ref, view.reduce, view.field);
  const mapped = mapValue(view.mappings, value);
  return { text: mapped?.text ?? (format(number ?? value) || '–'), mapped };
}

/** The most characters of a stat that stay on one line; a longer text wraps at the size they fit. */
const lineLength = 24;

/**
 * The size of what a stat shows. A number or a short text stays on one line and shrinks to fit.
 * A text longer than a line, which only a mapping or a text column gives, wraps at the size a
 * full line fits, so a sentence stays readable.
 *
 * @param text - The text as shown.
 * @param tinted - Whether a tint surrounds it, whose padding counts as one character more.
 * @returns The style to set on the value.
 */
function fittedValue(text: string, tinted: boolean): CSSProperties {
  // A tint has a padding of about half a character on each side: the fit counts one more.
  const fitted = fittedNumber(tinted ? `${text} ` : text, 32);
  if (text.length <= lineLength) return fitted;
  const line = fittedNumber('0'.repeat(lineLength), 32);
  return { ...line, whiteSpace: 'normal', overflowWrap: 'anywhere' };
}

/**
 * A stat: one number or mapped text, in its tone when it has one, and a line under it. A stat
 * that links to a dashboard pinned now, or to an allowed host, opens it.
 *
 * @param props - The view, the outcomes, the time zone and the links.
 * @returns The stat.
 */
export function StatView({ view, queries, timeZone, links }: StatViewProps) {
  if (view.each !== undefined)
    return <StatTiles view={view} queries={queries} timeZone={timeZone} links={links} />;
  const href = hrefOf(view.link, links);
  const stat = <StatBody view={view} queries={queries} timeZone={timeZone} />;
  if (!href) return stat;
  return (
    <LinkTo to={href} className={styles.link}>
      {stat}
    </LinkTo>
  );
}

/**
 * A stat's number or mapped text and the line under it.
 *
 * @param props - The view, the outcomes and the time zone.
 * @returns The stat.
 */
function StatBody({ view, queries, timeZone }: Omit<StatViewProps, 'links'>) {
  const format = createFormatter(view.format, { timeZone });
  const { text, mapped } = statText(view, queries, format);
  const subtitle = statSubtitle(view, queries, format);
  const toneAs = mapped?.tone ? (view.toneAs ?? 'text') : undefined;
  const fitted = fittedValue(text, toneAs === 'background');
  return (
    <div className={styles.stat}>
      <span
        className={styles.statValue}
        data-tone-as={toneAs}
        style={{ ...fitted, ...toneStyle(mapped?.tone) }}
      >
        {text}
      </span>
      {subtitle !== '' && <span className={styles.statSubtitle}>{subtitle}</span>}
    </div>
  );
}

/**
 * A stat over a breakdown: a tile for each row of its result, at most {@link maxStatTiles}, each
 * with its label, its value or mapped text in its tone, and its link.
 *
 * @param props - The view, the outcomes, the time zone and the links.
 * @returns The tiles.
 */
function StatTiles({ view, queries, timeZone, links }: StatViewProps) {
  const format = createFormatter(view.format, { timeZone });
  const frames = queries.find((query) => query.refId === view.ref)?.frames ?? [];
  const tiles = statTiles(frames, view.each ?? '', view.field);
  return (
    <>
      <div className={styles.tiles}>
        {tiles.slice(0, maxStatTiles).map((tile) => (
          <TileLink key={tile.key} {...{ view, tile, format, links }} />
        ))}
      </div>
      {tiles.length > maxStatTiles && (
        <p className={styles.statSubtitle}>
          Showing the first {maxStatTiles} of {tiles.length}.
        </p>
      )}
    </>
  );
}

/** Props of one tile. */
interface TileProps {
  /** The stat view. */
  readonly view: StatViewSpec;
  /** The tile. */
  readonly tile: StatTile;
  /** Writes a value with the stat's format. */
  readonly format: Format;
  /** What the tile's link is built from. */
  readonly links: PanelLinks | undefined;
}

/**
 * One tile, opening the stat's link with the tile's row when it leads somewhere.
 *
 * @param props - The view, the tile, the format and the links.
 * @returns The tile.
 */
function TileLink(props: TileProps) {
  const { view, tile, links } = props;
  const href = hrefOf(view.link, links, { row: tile.row, column: view.each ?? '' });
  if (!href) return <Tile {...props} />;
  return (
    <LinkTo to={href} className={styles.link}>
      <Tile {...props} />
    </LinkTo>
  );
}

/**
 * One tile: its label, and its value or mapped text in its tone.
 *
 * @param props - The view, the tile and the format.
 * @returns The tile.
 */
function Tile({ view, tile, format }: TileProps) {
  const mapped = view.mappings ? mapValue(view.mappings, tile.value) : undefined;
  const text = mapped?.text ?? (format(tile.value) || '–');
  const toneAs = mapped?.tone ? (view.toneAs ?? 'text') : undefined;
  const fitted = fittedValue(text, toneAs === 'background');
  return (
    <div className={styles.stat}>
      <span className={styles.statSubtitle}>{tile.label}</span>
      <span
        className={styles.statValue}
        data-tone-as={toneAs}
        style={{ ...fitted, ...toneStyle(mapped?.tone) }}
      >
        {text}
      </span>
    </div>
  );
}
