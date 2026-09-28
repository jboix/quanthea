/**
 * Seeds a running querent with the dev connectors and the checkout incident dashboard, pinned.
 * Run `bun run env:up` and the server first. `QUERENT_URL` points at the server
 * (default `http://localhost:3000`); it must run in the open access mode.
 */

import { incidentStart } from '../metrics/incident.ts';
import fixture from './checkout-incident.json' with { type: 'json' };

/** The server. */
const baseUrl = process.env.QUERENT_URL ?? 'http://localhost:3000';

/** The dev connectors the fixture queries, as the add form would create them. */
const connectors = [
  {
    name: 'postgres-orders',
    kind: 'postgres',
    config: {
      host: 'localhost',
      port: 5433,
      database: 'orders',
      username: 'dash_ro',
      tls: 'disable',
    },
    secret: { password: 'dash-ro-dev' },
    hiddenFields: ['customers.email', 'customers.phone'],
  },
  {
    name: 'prometheus-dev',
    kind: 'prometheus',
    config: { url: 'http://localhost:9091' },
    secret: {},
  },
];

/**
 * Calls the API and fails loudly on an error answer.
 *
 * @param method - The HTTP method.
 * @param path - The path under `/api`.
 * @param body - The JSON body, if any.
 * @returns The JSON answer.
 */
async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'querent' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const answer = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(answer)}`);
  return answer;
}

/**
 * Creates the dev connectors that do not exist yet.
 *
 * @returns When they exist.
 */
async function ensureConnectors(): Promise<void> {
  const existing = (await api('GET', '/connectors')) as { name: string }[];
  const names = new Set(existing.map((connector) => connector.name));
  for (const connector of connectors.filter((each) => !names.has(each.name))) {
    await api('POST', '/connectors', connector);
    process.stdout.write(`created connector ${connector.name}\n`);
  }
}

/**
 * The fixture with its time range around the incident: 30 minutes before, 90 after.
 *
 * @returns The spec.
 */
function incidentSpec() {
  const start = incidentStart(new Date()).getTime();
  const time = {
    from: new Date(start - 30 * 60_000).toISOString(),
    to: new Date(start + 90 * 60_000).toISOString(),
  };
  return { ...fixture, time };
}

await ensureConnectors();
const created = (await api('POST', '/dashboards', {
  spec: incidentSpec(),
  changeSummary: 'seeded',
})) as {
  id: string;
};
await api('POST', `/dashboards/${created.id}/pin`, { version: 1 });
process.stdout.write(`pinned ${baseUrl}/d/${created.id}\n`);
