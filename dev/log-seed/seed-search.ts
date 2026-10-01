/**
 * Seeds the request logs into Elasticsearch or OpenSearch, once per data volume: daily indices
 * `logs-YYYY.MM.DD` under one index template. Usage: `bun seed-search.ts <url>...`.
 */
import { type LogEvent, logEvents } from './events.ts';

/** Events per bulk request. */
const batchSize = 5000;

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
 * Sends a JSON request and fails on an error status.
 *
 * @param url - The URL.
 * @param method - The method.
 * @param body - The body: an object as JSON, a string as is.
 * @returns The parsed answer.
 */
async function call(url: string, method: string, body?: unknown): Promise<unknown> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const contentType = typeof body === 'string' ? 'application/x-ndjson' : 'application/json';
  const response = await fetch(url, {
    method,
    headers: { 'content-type': contentType },
    ...(body === undefined ? {} : { body: text }),
  });
  if (!response.ok)
    throw new Error(`${method} ${url}: ${response.status} ${await response.text()}`);
  return response.json();
}

/**
 * The NDJSON of one bulk request.
 *
 * @param events - The events.
 * @returns Action and document lines.
 */
function bulkBody(events: readonly LogEvent[]): string {
  return events
    .map((event) => {
      const index = `logs-${event['@timestamp'].slice(0, 10).replaceAll('-', '.')}`;
      return `${JSON.stringify({ index: { _index: index } })}\n${JSON.stringify(event)}\n`;
    })
    .join('');
}

/**
 * Seeds one server, unless it holds logs already.
 *
 * @param base - The server URL.
 * @returns Once the logs are searchable.
 */
async function seed(base: string): Promise<void> {
  const existing = (await call(`${base}/logs-*/_count`, 'GET')) as { count?: number };
  if ((existing.count ?? 0) > 0) return;
  await call(`${base}/_index_template/quanthea-dev-logs`, 'PUT', template);
  const events = logEvents();
  for (let start = 0; start < events.length; start += batchSize) {
    const result = (await call(
      `${base}/_bulk`,
      'POST',
      bulkBody(events.slice(start, start + batchSize)),
    )) as {
      errors?: boolean;
    };
    if (result.errors) throw new Error(`${base}: some logs were not indexed.`);
  }
  await call(`${base}/logs-*/_refresh`, 'POST');
  process.stdout.write(`${base}: ${events.length} logs\n`);
}

for (const base of process.argv.slice(2)) await seed(base);
