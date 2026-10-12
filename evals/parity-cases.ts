/**
 * The parity questions: one per family of panels, asked about the player events of the dev search
 * server (the index `core_events`). Each says what the panel of the finished work holds, so most
 * fail until the builder, the operation or the view they name exists. A change that adds one names
 * the families it should turn green, and edits a question here only to correct its expectation.
 */
import { type Expectation, type Question, type ShapeExpectation, zurich } from './questions.ts';

/** Something the world must have before a question can be answered. */
export type Need = NonNullable<ShapeExpectation['needs']>[number];

/** What a good answer to a parity question holds. */
export interface ParityExpectation extends Expectation {
  /**
   * Fields the dashboard must hold around its panels, as the paths of a view's fields are
   * written: `variables.kind=computed`, `sections.repeat`.
   */
  readonly dashboard?: readonly string[];
}

/** One parity question. */
export interface ParityCase extends Question {
  /** The family of panels it asks for, one of the parity families. */
  readonly family: string;
  /** What a good answer holds. */
  readonly expect: ParityExpectation;
}

/** The word that names every parity question in `--only`. */
export const parityWord = 'parity';

/** The connector on the dev OpenSearch, as the world names it. */
export const eventsConnector = 'opensearch-events';

const startTime = 'session.qoe_timings.total';
const platform = 'session.player.platform';
const byPlatform = `terms:${platform}`;
const errorTypes = 'terms:data.error_type';
const line = { kind: 'chart', recipe: 'trend.line' } as const;
const table = { kind: 'table' } as const;

/**
 * A parity question, with what every one of them expects unless it says otherwise: the events
 * connector queried, one to four panels, and one failed write at most.
 *
 * @param family - The family's id, which is the question's id too.
 * @param question - What the person asks.
 * @param shape - The shape of the panel a good answer has.
 * @param more - What else a good answer holds, or holds instead.
 * @returns The question.
 */
function ask(
  family: string,
  question: string,
  shape: ShapeExpectation,
  more: Partial<ParityExpectation> = {},
): ParityCase {
  const usual = { connectors: [eventsConnector], topics: [], maxRepairs: 1 };
  const expect: ParityExpectation = { ...usual, panels: [1, 4], shape, ...more };
  return { id: family, family, question, timeZone: zurich, expect };
}

/** The questions about series, shares and single numbers. */
const measures: readonly ParityCase[] = [
  ask('f01', 'Player events over the last 24 hours: a count over time, one line per event name.', {
    builder: 'search-series',
    aggregations: ['date_histogram', 'terms:event_name'],
    view: line,
  }),
  ask(
    'f02',
    'The median and the 95th percentile of the total start time of playback, over time, over the last 24 hours.',
    {
      builder: 'search-series',
      aggregations: ['date_histogram', `percentiles:${startTime}`],
      view: line,
    },
  ),
  ask(
    'f03',
    'Over the last 24 hours, over time: the share of the ERROR events that are business errors.',
    {
      builder: 'search-ratio',
      aggregations: ['date_histogram', 'filter', 'bucket_script'],
      view: line,
    },
  ),
  ask('f04', 'The five most common error types of the last 24 hours, as a donut.', {
    builder: 'search-breakdown',
    aggregations: [errorTypes],
    view: { kind: 'chart', recipe: 'composition.pie' },
  }),
  ask(
    'f05',
    'Player versions of the sessions started in the last 24 hours, as a donut: the three most used, and one slice for all the others together.',
    {
      builder: 'search-breakdown',
      aggregations: ['terms:session.player.version'],
      view: { kind: 'chart', recipe: 'composition.pie' },
    },
    // The slice for the rest is asked through the aggregation's meta.
    { topics: [/"meta":.*other/i] },
  ),
  ask('f06', 'How many ERROR events were there in the last 24 hours? One number, as a stat.', {
    builder: 'search-stat',
    aggregations: ['value_count'],
    view: { kind: 'stat' },
  }),
  ask(
    'f07',
    'The 90th percentile of the total start time over the last 24 hours as a stat: green under 2 seconds, amber from 2 to 4, red above.',
    {
      builder: 'search-stat',
      aggregations: [`percentiles:${startTime}`],
      view: { kind: 'stat', has: ['mappings.tone'] },
    },
  ),
  ask(
    'f08',
    'Playback success over the last 24 hours as a gauge: one minus the ERROR events over the START events. Red under 90%, amber up to 97%, green above.',
    {
      builder: 'search-ratio',
      aggregations: ['filter', 'bucket_script'],
      view: { kind: 'chart', recipe: 'kpi.gauge', has: ['mappings.tone'] },
    },
  ),
  ask(
    'f09',
    'Two stats for the last 24 hours: how many sessions started, and how many distinct sessions sent any event.',
    {
      builder: 'search-stat',
      aggregations: ['cardinality:session_id'],
      view: { kind: 'stat' },
    },
    { panels: [2, 4], topics: [/START/] },
  ),
  ask(
    'f15',
    'How many START events on Web or Apple had a total start time above 3 seconds in the last 24 hours? One number.',
    { builder: 'search-stat', view: { kind: 'stat' } },
    {
      topics: [/"range":\{"session\.qoe_timings\.total"/, /"terms":\{"session\.player\.platform"/],
    },
  ),
  ask(
    'f16',
    'Over the last 24 hours, over time: the ERROR events of each error type as a share of all the sessions started in the same interval. One line per error type.',
    { aggregations: ['date_histogram', errorTypes], operations: ['calculate'], view: line },
  ),
  ask(
    'f30',
    'ERROR events over the last 24 hours, over time, one line per error type, with the total of each line in the legend.',
    {
      builder: 'search-series',
      aggregations: ['date_histogram', errorTypes],
      view: { ...line, has: ['legendValues=total'] },
    },
  ),
  ask(
    'f32',
    'Player events per player platform over the last 90 days, over time, in as fine a detail as the chart can take.',
    { builder: 'search-series', aggregations: ['date_histogram', byPlatform], view: line },
    // The interval fits the range at the first write: no write is refused for its buckets.
    { maxRepairs: 0 },
  ),
];

/** The questions about tables, groups and operations on tables. */
const tables: readonly ParityCase[] = [
  ask(
    'f10',
    'Per browser, over the last 24 hours: the median total start time and the sessions started, as a table. Colour the median by steps: green under 2 seconds, amber from 2 to 4, red above.',
    {
      builder: 'search-table',
      aggregations: ['terms:session.browser.name', `percentiles:${startTime}`],
      view: { ...table, has: ['columns.mappings.tone'] },
    },
  ),
  ask(
    'f11',
    'Which player versions give the most trouble? A table per player platform and player version with the ERROR events, the distinct sessions and the errors per session, the highest ratio first.',
    {
      builder: 'search-table',
      aggregations: ['multi_terms', 'cardinality:session_id', 'bucket_script', 'bucket_sort'],
      view: table,
    },
  ),
  ask(
    'f12',
    'Sessions started in the last 24 hours in two regions, as a bar each: "Coast" is the business units north and west, "Inland" is south and east.',
    {
      builder: 'search-breakdown',
      aggregations: ['filters'],
      view: { kind: 'chart', recipe: 'comparison.bar' },
    },
    { topics: [/Coast/, /Inland/] },
  ),
  ask(
    'f13',
    'Over the last 24 hours, over time, as stacked bars with four series: sessions started, technical errors, sessions blocked as GEOBLOCK, and sessions blocked as LEGAL.',
    {
      builder: 'search-series',
      aggregations: ['date_histogram', 'filters'],
      view: { kind: 'chart', recipe: 'comparison.bar', has: ['recipe.variants=stacked'] },
    },
  ),
  ask(
    'f14',
    'The 200 latest ERROR events as a table, the oldest of them first: the time, the player platform, the error type and the message.',
    { builder: 'search-rows', view: table },
    { topics: [/"size":200/, /"asc"/] },
  ),
  ask(
    'f17',
    'One table of the applications with the most ERROR events in the last 24 hours. Web applications are named by the short origin of the page, mobile ones by their application id, all in the same list.',
    {
      aggregations: ['terms:session.media.short_origin', 'terms:session.application.id'],
      operations: ['append'],
      view: table,
    },
  ),
  ask(
    'f18',
    'A matrix for the last 24 hours: error types as rows, player versions as columns in version order, the ERROR events per session started in each cell. Colour the cells by steps: green under 2%, amber up to 5%, red above.',
    { operations: ['pivot'], view: { ...table, has: ['rest.mappings.tone'] } },
  ),
  ask(
    'f19',
    'The 50 latest sessions started, as a table with the time, the device model and one column that reads like "iOS 18.5": the name and the version of the operating system together.',
    { operations: ['concat'], view: table },
  ),
  ask(
    'f20',
    'How current are the player versions? For each player platform, the share of the sessions started on each major version, as bars, the majors in version order.',
    {
      operations: ['part', 'regroup', 'share', 'sort'],
      view: { kind: 'chart', recipe: 'comparison.bar' },
    },
  ),
  ask(
    'f21',
    'A histogram of the total start time over the last 24 hours, in bins of 250 milliseconds, that stops at the 95th percentile so the tail does not flatten it.',
    {
      builder: 'search-histogram',
      aggregations: [`histogram:${startTime}`],
      view: { kind: 'chart', recipe: 'distribution.histogram' },
    },
    { dashboard: ['variables.kind=computed'] },
  ),
  ask(
    'f22',
    'Sessions started over time in the last 24 hours, only for the media that had a blocked session in the same range. Work that list of media out from the events: it is not for a viewer to pick.',
    { builder: 'search-series', aggregations: ['date_histogram'], view: line },
    { dashboard: ['variables.kind=computed', 'variables.as=list'] },
  ),
  ask(
    'f23',
    'Per media, over the last 24 hours: its title from the media API beside its sessions started and its ERROR events, as one table.',
    { operations: ['join'], view: table, needs: ['http'] },
  ),
  ask(
    'f33',
    'Per device type, over the last 24 hours: the distinct devices and the average bitrate, in one table. Write the aggregation by hand if that is quicker.',
    {
      builder: 'search-table',
      aggregations: [
        'terms:session.device.type',
        'cardinality:session.device.id',
        'avg:data.bitrate',
      ],
      view: table,
    },
  ),
];

/** The questions about links, images, records, logs, sections and colours. */
const views: readonly ParityCase[] = [
  ask(
    'f24',
    'A table of the media with the most ERROR events in the last 24 hours. Each media id links to the pinned dashboard about one media, with that media chosen and the time range kept.',
    { view: { ...table, has: ['columns.link.to=dashboard'] }, needs: ['pinned-target'] },
  ),
  ask(
    'f25',
    'A table of the media from the media API: the title, the business unit and the thumbnail, drawn as a small image.',
    { view: { ...table, has: ['columns.display=image'] }, needs: ['http'] },
    { connectors: [] },
  ),
  ask(
    'f26',
    'The latest session started, as a record of labelled values: the session id, the player platform and version, the device model, the operating system and the media id.',
    { builder: 'search-rows', view: { ...table, has: ['layout=record'] } },
  ),
  ask(
    'f27',
    'Sessions started in the last 24 hours as a row of stats: one tile per player platform.',
    {
      builder: 'search-breakdown',
      aggregations: [byPlatform],
      view: { kind: 'stat', has: ['by'] },
    },
  ),
  ask(
    'f28',
    'The latest ERROR events as a log: the time, the message, and a tone that tells a business error from a technical one.',
    { builder: 'search-rows', view: { kind: 'logs', has: ['message', 'level.mappings'] } },
  ),
  ask(
    'f29',
    'A dashboard with a player platform variable and one section repeated for each platform. In each section: the sessions started over time, and the error types as a donut.',
    { aggregations: ['date_histogram'], view: line },
    { panels: [2, 6], dashboard: ['sections.repeat'] },
  ),
  ask(
    'f31',
    'Two panels for the last 24 hours, each with one line per player platform: the sessions started over time, and the ERROR events over time. Web, Apple and Android keep the same colour on both.',
    { builder: 'search-series', aggregations: ['date_histogram', byPlatform], view: line },
    { panels: [2, 4], dashboard: ['colors.tone'] },
  ),
];

/** The parity questions, in the order of their families. */
export const parityCases: readonly ParityCase[] = [...measures, ...tables, ...views].sort(
  (one, other) => one.family.localeCompare(other.family),
);

/**
 * The parity questions `--only` keeps, in their order. They cost more than the other questions
 * and need the search connector, so a run with no `--only` asks none.
 *
 * @param only - The ids to keep, or the word that names them all.
 * @returns The questions; none when `--only` names none.
 */
export function selectParityCases(only: readonly string[]): readonly ParityCase[] {
  if (only.includes(parityWord)) return parityCases;
  return parityCases.filter((each) => only.includes(each.id));
}
