/**
 * What the player events of the dev OpenSearch hold, counted on the server directly: plain
 * requests, with no connector, no builder and no model in between. A result check compares what a
 * panel returned with these, so a fault in the product's own query path cannot hide on both sides.
 * Every truth is over the 24 hours that end at the run's clock, both ends kept.
 */
import { devOpensearch } from '@quanthea/server/src/connectors/_shared/test/dev-sources.ts';
import type { Truth } from '../core/case.ts';

/** The index of the player events. */
const index = 'core_events';

/** A day, in milliseconds. */
const dayMs = 86_400_000;

/** A filter of a search body. */
type Filter = Readonly<Record<string, unknown>>;

/** What the server answers, as far as the truths read it. */
interface Found {
  /** How many events passed the filters. */
  readonly hits: { readonly total: { readonly value: number } };
  /** The aggregations asked for, by name. */
  readonly aggregations?: Readonly<Record<string, unknown>>;
}

/** The events of one name. */
const named = (name: string): Filter => ({ term: { event_name: name } });

/**
 * Asks the dev OpenSearch for aggregations over the events of the last 24 hours that pass some
 * filters.
 *
 * @param now - The run's clock, in epoch milliseconds.
 * @param filters - The filters every event must pass.
 * @param aggs - The aggregations; none to count the events.
 * @returns The response.
 * @throws {Error} When the server does not answer.
 */
async function search(
  now: number,
  filters: readonly Filter[],
  aggs: Readonly<Record<string, unknown>> = {},
): Promise<Found> {
  const range = { range: { '@timestamp': { gte: now - dayMs, lte: now } } };
  const body = {
    size: 0,
    track_total_hits: true,
    query: { bool: { filter: [range, ...filters] } },
    aggs,
  };
  const response = await fetch(`${devOpensearch.config.url}/${index}/_search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`The dev OpenSearch answers ${response.status}.`);
  return (await response.json()) as Found;
}

/**
 * One aggregation of an answer.
 *
 * @param found - What the server answered.
 * @param name - The aggregation's name.
 * @returns The aggregation.
 * @throws {Error} When the answer holds no such aggregation.
 */
function aggregation<Shape>(found: Found, name: string): Shape {
  const held = found.aggregations?.[name];
  if (held === undefined) throw new Error(`The dev OpenSearch gave no aggregation ${name}.`);
  return held as Shape;
}

/**
 * A truth that counts the events passing some filters.
 *
 * @param key - Its name.
 * @param filters - The filters.
 * @returns The truth.
 */
function count(key: string, filters: readonly Filter[]): Truth<number> {
  return { key, compute: async (now) => (await search(now, filters)).hits.total.value };
}

/**
 * A truth that counts the events passing some filters per value of a field, the most frequent
 * values first.
 *
 * @param key - Its name.
 * @param filters - The filters.
 * @param field - The field.
 * @param size - How many values.
 * @returns The truth: the count of each value.
 */
function countBy(
  key: string,
  filters: readonly Filter[],
  field: string,
  size: number,
): Truth<Record<string, number>> {
  const compute = async (now: number) => {
    const found = await search(now, filters, { by: { terms: { field, size } } });
    const { buckets } = aggregation<{ buckets: { key: string; doc_count: number }[] }>(found, 'by');
    return Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket.doc_count]));
  };
  return { key, compute };
}

/** The events named ERROR. */
export const errorEvents = count('errorEvents', [named('ERROR')]);

/** The events named START. */
export const startEvents = count('startEvents', [named('START')]);

/** The START events on Web or Apple whose start took more than 3000 milliseconds in all. */
export const slowStartsOnWebOrApple = count('slowStartsOnWebOrApple', [
  named('START'),
  { terms: { 'session.player.platform': ['Web', 'Apple'] } },
  { range: { 'session.qoe_timings.total': { gt: 3000 } } },
]);

/** The events of each event name. */
export const eventsByName = countBy('eventsByName', [], 'event_name', 10);

/** The five most frequent error types among the ERROR events. */
export const topErrorTypes = countBy('topErrorTypes', [named('ERROR')], 'data.error_type', 5);

/** The START events of each player platform. */
export const startsByPlatform = countBy(
  'startsByPlatform',
  [named('START')],
  'session.player.platform',
  10,
);

/** The 90th percentile of the total start time over the START events, in milliseconds. */
export const startP90: Truth<number> = {
  key: 'startP90',
  compute: async (now) => {
    const aggs = { p: { percentiles: { field: 'session.qoe_timings.total', percents: [90] } } };
    const found = await search(now, [named('START')], aggs);
    return aggregation<{ values: Record<string, number> }>(found, 'p').values['90.0'] as number;
  },
};

/** The distinct sessions over every event, as the server's cardinality estimates it. */
export const distinctSessions: Truth<number> = {
  key: 'distinctSessions',
  compute: async (now) => {
    const found = await search(now, [], { n: { cardinality: { field: 'session_id' } } });
    return aggregation<{ value: number }>(found, 'n').value;
  },
};

/** Playback success: one minus the ERROR events over the START events, as a ratio. */
export const playbackSuccess: Truth<number> = {
  key: 'playbackSuccess',
  compute: async (now) => {
    const errors = await errorEvents.compute(now, undefined);
    const starts = await startEvents.compute(now, undefined);
    return 1 - errors / starts;
  },
};
