/**
 * Seeds the player events into Elasticsearch or OpenSearch, once per data volume: the one index
 * `core_events`, under its own index template.
 */
import { coreEvents } from './core-events.ts';
import { bulkIndex, call } from './search-api.ts';

/** The index of the player events. */
const index = 'core_events';

/** A keyword field. */
const keyword = { type: 'keyword' } as const;

/** An integer field. */
const integer = { type: 'integer' } as const;

/** A whole number too large for an integer, such as bits per second. */
const long = { type: 'long' } as const;

/** A float field. */
const float = { type: 'float' } as const;

/**
 * The mapping of an object of keyword fields.
 *
 * @param names - The fields.
 * @returns The object's mapping.
 */
function keywords(...names: string[]) {
  return { properties: Object.fromEntries(names.map((name) => [name, keyword])) };
}

/** The mapping of `session`. */
const session = {
  properties: {
    player: keywords('platform', 'name', 'version'),
    browser: keywords('name', 'version'),
    os: keywords('name', 'version'),
    device: keywords('id', 'model', 'type'),
    application: keywords('id', 'version'),
    media: {
      properties: {
        ...keywords('id', 'bu', 'type', 'origin', 'short_origin').properties,
        swisstxt: { type: 'boolean' },
      },
    },
    qoe_timings: { properties: { total: float, metadata: float, asset: float } },
    screen: { properties: { width: integer, height: integer } },
  },
};

/** The mapping of `data`. */
const data = {
  properties: {
    business_error: { type: 'boolean' },
    error_type: keyword,
    log: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
    block_reason: keyword,
    playback_duration: integer,
    bitrate: long,
    bandwidth: long,
    stall: { properties: { count: integer, duration: integer } },
  },
};

/** The index template. The time field takes epoch milliseconds only. */
const template = {
  index_patterns: [index],
  priority: 200,
  template: {
    settings: { number_of_shards: 1, number_of_replicas: 0 },
    mappings: {
      properties: {
        '@timestamp': { type: 'date', format: 'epoch_millis' },
        event_name: keyword,
        session_id: keyword,
        user_ip: { type: 'ip' },
        session,
        data,
      },
    },
  },
};

/**
 * Seeds the player events on one server, unless it holds them already.
 *
 * @param base - The server URL.
 * @returns Once the events are searchable.
 */
export async function seedCoreEvents(base: string): Promise<void> {
  const counted = await call(`${base}/${index}/_count?ignore_unavailable=true`, 'GET');
  if (((counted as { count?: number }).count ?? 0) > 0) return;
  await call(`${base}/_index_template/quanthea-dev-core-events`, 'PUT', template);
  const events = coreEvents();
  await bulkIndex(base, events, () => index);
  await call(`${base}/${index}/_refresh`, 'POST');
  process.stdout.write(`${base}: ${events.length} player events\n`);
}
