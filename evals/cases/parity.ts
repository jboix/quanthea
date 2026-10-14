/**
 * The parity cases: one per family of panels, asked about the player events of the dev search
 * server (the index `core_events`). Each asks for one panel exactly, so it has one right outcome:
 * most fail until the builder, the operation or the view they name exists. A change that adds one
 * names the families it should turn green, and edits a case here only to correct what it checks.
 */
import {
  type DashboardCheck,
  dashboardHas,
  maxRepairs,
  panelCount,
  queries,
  shapeData,
  shapeView,
  topic,
} from '../checks/dashboard.ts';
import { showsNumber, totalsMatch } from '../checks/result.ts';
import { expectsData, type ShapeExpectation } from '../checks/shape.ts';
import type { CaseOn, Fixture } from '../core/case.ts';
import { httpWorld, pinnedTargetWorld, searchWorld } from '../fixtures/fixtures.ts';
import {
  distinctSessions,
  errorEvents,
  eventsByName,
  playbackSuccess,
  slowStartsOnWebOrApple,
  startEvents,
  startP90,
  startsByPlatform,
  topErrorTypes,
} from '../truth/events.ts';

/** The word that names every parity case in `--only`. */
export const parityWord = 'parity';

/** The connector on the dev OpenSearch, as the world names it. */
export const eventsConnector = 'opensearch-events';

const startTime = 'session.qoe_timings.total';
const platform = 'session.player.platform';
const byPlatform = `terms:${platform}`;
const errorTypes = 'terms:data.error_type';
const line = { kind: 'chart', recipe: 'trend.line' } as const;
const table = { kind: 'table' } as const;

/** A count is the truth to within half a percent: the two ends of the range may be kept or not. */
const counted = { relative: 0.005 } as const;

/** An estimate of the server, a percentile or a distinct count, is the truth to within 2%. */
const estimated = { relative: 0.02 } as const;

/** What a parity case checks unless it says otherwise. */
interface Usual {
  /** The fewest and the most panels; one to four when left out. */
  readonly panels?: readonly [number, number];
  /** The most failed writes; one when left out. */
  readonly repairs?: number;
  /** Whether the events connector need not be queried. */
  readonly anyConnector?: boolean;
  /** What else code checks. */
  readonly more?: readonly DashboardCheck[];
  /** The world the case needs when the player events are not enough. */
  readonly given?: Fixture;
}

/**
 * A parity case: one exact ask in a new thread, checked for the events connector, one to four
 * panels, one failed write at most, and the shape of the panel a right answer has.
 *
 * @param family - The family's id, which is the case's id too.
 * @param turn - What the person asks.
 * @param shape - The shape of the panel a right answer has.
 * @param usual - What the case checks otherwise than the others.
 * @returns The case.
 */
function ask(
  family: string,
  turn: string,
  shape: ShapeExpectation,
  usual: Usual = {},
): CaseOn<'dashboard'> {
  const [least, most] = usual.panels ?? [1, 4];
  const checks = [
    panelCount(least, most),
    maxRepairs(usual.repairs ?? 1),
    ...(usual.anyConnector ? [] : [queries(eventsConnector)]),
    ...(expectsData(shape) ? [shapeData(shape)] : []),
    ...(shape.view ? [shapeView(shape)] : []),
    ...(usual.more ?? []),
  ];
  return {
    id: family,
    family,
    bucket: 'capability',
    given: usual.given ?? searchWorld,
    input: { surface: 'dashboard', turns: [turn] },
    checks,
  };
}

/** The cases about series, shares and single numbers. */
const measures: readonly CaseOn<'dashboard'>[] = [
  ask(
    'f01',
    'Player events over the last 24 hours: a count over time, one line per value of event_name.',
    { builder: 'search-series', aggregations: ['date_histogram', 'terms:event_name'], view: line },
    { more: [totalsMatch(eventsByName, counted)] },
  ),
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
  ask(
    'f04',
    'The five most common values of data.error_type among the events with event_name ERROR, over the last 24 hours, as a donut.',
    {
      builder: 'search-breakdown',
      aggregations: [errorTypes],
      view: { kind: 'chart', recipe: 'composition.pie' },
    },
    { more: [totalsMatch(topErrorTypes, counted)] },
  ),
  ask(
    'f05',
    'Player versions of the sessions started in the last 24 hours, as a donut: the three most used, and one slice for all the others together.',
    {
      builder: 'search-breakdown',
      aggregations: ['terms:session.player.version'],
      view: { kind: 'chart', recipe: 'composition.pie' },
    },
    // The slice for the rest is asked through the aggregation's meta.
    { more: [topic(/"meta":.*other/i, 'result')] },
  ),
  ask(
    'f06',
    'How many events with event_name ERROR were there in the last 24 hours? One number, as a stat.',
    { builder: 'search-stat', aggregations: ['value_count'], view: { kind: 'stat' } },
    { more: [showsNumber(errorEvents, counted)] },
  ),
  ask(
    'f07',
    'The 90th percentile of session.qoe_timings.total, which is in milliseconds, over the events with event_name START of the last 24 hours, as a stat: green under 2 seconds, amber from 2 to 4, red above.',
    {
      builder: 'search-stat',
      aggregations: [`percentiles:${startTime}`],
      view: { kind: 'stat', has: ['mappings.tone'] },
    },
    // The stat may show milliseconds or seconds.
    { more: [showsNumber(startP90, { ...estimated, scales: [1, 0.001] })] },
  ),
  ask(
    'f08',
    'Playback success over the last 24 hours as a gauge: one minus the events with event_name ERROR over the events with event_name START. Red under 90%, amber up to 97%, green above.',
    {
      builder: 'search-ratio',
      aggregations: ['filter', 'bucket_script'],
      // The steps as quanthea's mappings, or as the dial's own ECharts colour stops.
      view: {
        kind: 'chart',
        recipe: 'kpi.gauge',
        has: ['mappings.tone|option.series.axisLine.lineStyle.color=@tone.bad'],
      },
    },
    // The gauge may read a ratio or a percentage.
    { more: [showsNumber(playbackSuccess, { absolute: 0.002, scales: [1, 100] })] },
  ),
  ask(
    'f09',
    'Two stats for the last 24 hours: how many events have event_name START, and how many distinct session_id there are over all the events.',
    {
      builder: 'search-stat',
      aggregations: ['cardinality:session_id'],
      view: { kind: 'stat' },
    },
    {
      panels: [2, 4],
      more: [
        topic(/START/, 'result'),
        showsNumber(startEvents, counted),
        showsNumber(distinctSessions, estimated),
      ],
    },
  ),
  ask(
    'f15',
    'How many events with event_name START, with session.player.platform Web or Apple, and with session.qoe_timings.total above 3000 milliseconds were there in the last 24 hours? One number.',
    { builder: 'search-stat', view: { kind: 'stat' } },
    {
      more: [
        topic(/"range":\{"session\.qoe_timings\.total"/, 'result'),
        topic(/"terms":\{"session\.player\.platform"/, 'result'),
        showsNumber(slowStartsOnWebOrApple, counted),
      ],
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
    { repairs: 0 },
  ),
];

/** The cases about tables, groups and operations on tables. */
const tables: readonly CaseOn<'dashboard'>[] = [
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
    { more: [topic(/Coast/, 'result'), topic(/Inland/, 'result')] },
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
    { more: [topic(/"size":200/, 'result'), topic(/"asc"/, 'result')] },
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
    { more: [dashboardHas('variables.kind=computed')] },
  ),
  ask(
    'f22',
    'Sessions started over time in the last 24 hours, only for the media that had a blocked session in the same range. Work that list of media out from the events: it is not for a viewer to pick.',
    { builder: 'search-series', aggregations: ['date_histogram'], view: line },
    { more: [dashboardHas('variables.kind=computed'), dashboardHas('variables.as=list')] },
  ),
  ask(
    'f23',
    'Per media, over the last 24 hours: its title from the media API beside its sessions started and its ERROR events, as one table.',
    { operations: ['join'], view: table },
    { given: httpWorld },
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

/** The cases about links, images, records, logs, sections and colours. */
const views: readonly CaseOn<'dashboard'>[] = [
  ask(
    'f24',
    'A table of the media with the most ERROR events in the last 24 hours. Each media id links to the pinned dashboard about one media, with that media chosen and the time range kept.',
    { view: { ...table, has: ['columns.link.to=dashboard'] } },
    { given: pinnedTargetWorld },
  ),
  ask(
    'f25',
    'A table of the media from the media API: the title, the business unit and the thumbnail, drawn as a small image.',
    { view: { ...table, has: ['columns.display=image'] } },
    { given: httpWorld, anyConnector: true },
  ),
  ask(
    'f26',
    'The latest session started, as a record of labelled values: the session id, the player platform and version, the device model, the operating system and the media id.',
    { builder: 'search-rows', view: { ...table, has: ['layout=record'] } },
  ),
  ask(
    'f27',
    'The events with event_name START of the last 24 hours as a row of stats: one tile per value of session.player.platform.',
    {
      builder: 'search-breakdown',
      aggregations: [byPlatform],
      view: { kind: 'stat', has: ['by'] },
    },
    { more: [totalsMatch(startsByPlatform, counted)] },
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
    { panels: [2, 6], more: [dashboardHas('sections.repeat')] },
  ),
  ask(
    'f31',
    'Two panels for the last 24 hours, each with one line per player platform: the sessions started over time, and the ERROR events over time. Web, Apple and Android keep the same colour on both.',
    { builder: 'search-series', aggregations: ['date_histogram', byPlatform], view: line },
    { panels: [2, 4], more: [dashboardHas('colors.tone')] },
  ),
];

/** The parity cases, in the order of their families. */
export const parityCases: readonly CaseOn<'dashboard'>[] = [...measures, ...tables, ...views].sort(
  (one, other) => one.id.localeCompare(other.id),
);
