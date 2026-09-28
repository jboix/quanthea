/** Serves the synthetic metrics live on :9464/metrics, continuing the traffic model from startup. */
import { incidentStart } from './incident.ts';
import { advance, createSeries } from './series.ts';

/** The HTTP port Prometheus scrapes. */
const port = 9464;

const groups = createSeries();
let lastScrape = Date.now();

/**
 * Advances the model to now and renders every series in the Prometheus text format.
 *
 * @returns The exposition text.
 */
function scrape(): string {
  const now = new Date();
  advance(groups, now, (now.getTime() - lastScrape) / 1000, incidentStart(now));
  lastScrape = now.getTime();
  const series = groups.flatMap((group) => [...group.requests, ...group.latency]);
  const lines = [
    '# TYPE http_requests_total counter',
    '# TYPE http_request_duration_seconds histogram',
    ...series.map((entry) => `${entry.name}${entry.labels} ${entry.value}`),
  ];
  return `${lines.join('\n')}\n`;
}

Bun.serve({
  port,
  fetch: (request) =>
    new URL(request.url).pathname === '/metrics'
      ? new Response(scrape(), { headers: { 'Content-Type': 'text/plain; version=0.0.4' } })
      : new Response('Not found', { status: 404 }),
});
process.stdout.write(`Serving synthetic metrics on :${port}/metrics\n`);
