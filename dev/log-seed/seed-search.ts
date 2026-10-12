/**
 * Seeds Elasticsearch or OpenSearch, once per data volume: the request logs in daily indices
 * `logs-YYYY.MM.DD` under one index template, then the player events in `core_events`. Each has
 * its own check, so a server that holds the logs still gets the events.
 * Usage: `bun seed-search.ts <url>...`.
 */
import { type LogEvent, logEvents } from './events.ts';
import { bulkIndex, call } from './search-api.ts';
import { seedCoreEvents } from './seed-core-events.ts';

/**
 * The mapping of the log indices. Its own name and a priority above Elasticsearch's managed `logs`
 * template, which would replace a template named `logs`.
 */
const template = {
  index_patterns: ['logs-*'],
  priority: 200,
  template: {
    settings: { number_of_shards: 1, number_of_replicas: 0 },
    mappings: {
      properties: {
        '@timestamp': { type: 'date' },
        service: { type: 'keyword' },
        env: { type: 'keyword' },
        level: { type: 'keyword' },
        route: { type: 'keyword' },
        status: { type: 'integer' },
        duration_ms: { type: 'integer' },
        message: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
        trace_id: { type: 'keyword' },
      },
    },
  },
};

/**
 * The daily index of a log.
 *
 * @param event - The log.
 * @returns `logs-YYYY.MM.DD`.
 */
function dailyIndex(event: LogEvent): string {
  return `logs-${event['@timestamp'].slice(0, 10).replaceAll('-', '.')}`;
}

/**
 * Seeds the logs on one server, unless it holds logs already.
 *
 * @param base - The server URL.
 * @returns Once the logs are searchable.
 */
async function seedLogs(base: string): Promise<void> {
  const existing = (await call(`${base}/logs-*/_count`, 'GET')) as { count?: number };
  if ((existing.count ?? 0) > 0) return;
  await call(`${base}/_index_template/quanthea-dev-logs`, 'PUT', template);
  const events = logEvents();
  await bulkIndex(base, events, dailyIndex);
  await call(`${base}/logs-*/_refresh`, 'POST');
  process.stdout.write(`${base}: ${events.length} logs\n`);
}

for (const base of process.argv.slice(2)) {
  await seedLogs(base);
  await seedCoreEvents(base);
}
