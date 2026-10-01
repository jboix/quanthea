/**
 * Seeds a running quanthea with the dev connectors and the checkout incident dashboard, pinned.
 * Run `bun run env:up` and the server first. `QUANTHEA_URL` points at the server
 * (default `http://localhost:3000`). It signs in as an admin with `QUANTHEA_ADMIN_EMAIL` and
 * `QUANTHEA_ADMIN_PASSWORD`, whose account is set up.
 */

import { incidentStart } from '../metrics/incident.ts';
import fixture from './checkout-incident.json' with { type: 'json' };

/** The server. */
const baseUrl = process.env.QUANTHEA_URL ?? 'http://localhost:3000';

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

/** The session cookie the seed signs in with. */
let session = '';

/**
 * Signs in as the admin the environment names, keeping the session cookie.
 *
 * @returns When signed in.
 * @throws {Error} When the variables are missing or the sign-in is refused.
 */
async function signIn(): Promise<void> {
  const email = process.env.QUANTHEA_ADMIN_EMAIL;
  const password = process.env.QUANTHEA_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error(
      'Set QUANTHEA_ADMIN_EMAIL and QUANTHEA_ADMIN_PASSWORD to an admin that is set up.',
    );
  const response = await fetch(`${baseUrl}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'quanthea' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Sign-in refused: ${await response.text()}`);
  session =
    /__Host-quanthea_session=[^;]+/.exec(response.headers.get('set-cookie') ?? '')?.[0] ?? '';
}

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
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'quanthea',
      cookie: session,
    },
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

await signIn();
await ensureConnectors();
const created = (await api('POST', '/dashboards', {
  spec: incidentSpec(),
  changeSummary: 'seeded',
})) as {
  id: string;
};
await api('POST', `/dashboards/${created.id}/pin`, { version: 1 });
process.stdout.write(`pinned ${baseUrl}/d/${created.id}\n`);
