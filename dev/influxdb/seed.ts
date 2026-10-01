/**
 * Writes the request metrics of the incident into InfluxDB 3, once per data volume: the table
 * `http_requests` with the tags `service` and `env` and the fields `requests`, `errors` and
 * `p95_ms`, every 30 seconds from eight hours before the incident until now. Usage:
 * `bun seed.ts <url> <token>`.
 */
import {
  errorRatio,
  incidentIntensity,
  incidentStart,
  p95Latency,
  requestRate,
  services,
} from '../metrics/incident.ts';

/** The database the dev connector reads. */
const database = 'telemetry';

/** Seconds between two points. */
const stepSeconds = 30;

/** Lines per write. */
const batchSize = 10_000;

const [base = 'http://127.0.0.1:8181', token = 'apiv3_quanthea-dev-token'] = process.argv.slice(2);
const headers = { Authorization: `Bearer ${token}` };

/**
 * Waits until InfluxDB answers.
 *
 * @returns Once it does.
 * @throws {Error} When it does not within a minute.
 */
async function ready(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/health`, { headers }).catch(() => undefined);
    if (response?.ok) return;
    await Bun.sleep(500);
  }
  throw new Error(`${base} does not answer.`);
}

/**
 * Whether the metrics are there already.
 *
 * @returns `true` when the table exists.
 */
async function seeded(): Promise<boolean> {
  const response = await fetch(`${base}/api/v3/query_sql`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ db: database, q: 'SHOW TABLES', format: 'json' }),
  });
  if (!response.ok) return false;
  const tables = (await response.json()) as { table_name?: string }[];
  return tables.some((table) => table.table_name === 'http_requests');
}

/**
 * The line protocol of every point.
 *
 * @returns The lines.
 */
function lines(): string[] {
  const now = Date.now();
  const start = incidentStart(new Date(now));
  const first = Math.floor((start.getTime() - 8 * 3_600_000) / 1000 / stepSeconds) * stepSeconds;
  const result: string[] = [];
  for (let seconds = first; seconds * 1000 <= now; seconds += stepSeconds) {
    const time = new Date(seconds * 1000);
    const intensity = incidentIntensity(time, start);
    for (const service of services) {
      const requests = Math.round(requestRate(service, 'prod', time) * stepSeconds);
      const errors = Math.round(requests * errorRatio(service, 'prod', intensity));
      const p95 = (p95Latency(service, intensity) * 1000).toFixed(1);
      result.push(
        `http_requests,service=${service.name},env=prod requests=${requests}i,errors=${errors}i,p95_ms=${p95} ${seconds}000000000`,
      );
    }
  }
  return result;
}

await ready();
if (!(await seeded())) {
  const all = lines();
  for (let start = 0; start < all.length; start += batchSize) {
    const response = await fetch(`${base}/api/v3/write_lp?db=${database}`, {
      method: 'POST',
      headers,
      body: all.slice(start, start + batchSize).join('\n'),
    });
    if (!response.ok) throw new Error(`write: ${response.status} ${await response.text()}`);
  }
  process.stdout.write(`${base}: ${all.length} points\n`);
}
