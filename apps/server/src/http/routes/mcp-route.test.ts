import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type AccessLevel, connectorInputSchema, type Role } from '@quanthea/shared';
import { createApp } from '../../app.ts';
import { createAuthenticator, sessionCookieName } from '../../auth/authenticator.ts';
import { eventsSpec } from '../../dashboards/test/events-spec.ts';
import { eventsReport } from '../../reports/test/events-report.ts';
import { captureLogs, temporaryDir, testServices } from '../../test/fixtures.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

/** The current revision of the protocol. */
const modern = '2026-07-28';

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/** An answer of the app: its status, its headers and its decoded body. */
interface Answer {
  /** The HTTP status. */
  readonly status: number;
  /** The headers. */
  readonly headers: Headers;
  /** The JSON body; `undefined` for an empty one. */
  readonly body: Record<string, unknown> | undefined;
}

/**
 * The real app, with sessions and API tokens.
 *
 * @returns A function that sends a request and gives its answer.
 */
function app() {
  const { sessions, users } = services;
  if (!sessions) throw new Error('The test services have no sessions.');
  const built = createApp({
    version: '1.2.3',
    authenticator: createAuthenticator({ sessions, users }),
    logger: captureLogs().logger,
    webDir: dataDir.path,
    publicUrl: 'https://quanthea.test',
    trustedProxyHops: 0,
    ...services,
  });
  return async (path: string, init: RequestInit): Promise<Answer> => {
    const response = await built.request(`https://quanthea.test/api${path}`, init);
    const text = await response.text();
    const body = text === '' ? undefined : (JSON.parse(text) as Record<string, unknown>);
    return { status: response.status, headers: response.headers, body };
  };
}

/**
 * Sends a request as quanthea's own pages do, with a session.
 *
 * @param cookie - The session.
 * @param method - The HTTP method.
 * @param path - The path under `/api`.
 * @param body - The JSON body.
 * @returns The answer.
 */
function asPage(cookie: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'quanthea',
    cookie: `${sessionCookieName}=${cookie}`,
  };
  return app()(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/**
 * A user with a session and an API token of their own role.
 *
 * @param role - Their role.
 * @returns The user's id, their session cookie and their token.
 */
async function member(role: Role) {
  const user = await services.users.create(
    { email: `${role}@example.com`, name: `The ${role}`, role },
    'x',
  );
  const cookie = (await services.sessions?.start(user.id))?.cookie ?? '';
  const made = await asPage(cookie, 'POST', '/tokens', { name: 'mcp', role, expiresInDays: 30 });
  return { id: user.id, cookie, token: String(made.body?.token) };
}

/**
 * Sends a message of the current revision to the MCP endpoint.
 *
 * @param token - The API token.
 * @param method - The JSON-RPC method.
 * @param params - Its parameters.
 * @param headers - Headers to replace or add.
 * @returns The answer.
 */
function rpc(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<Answer> {
  const meta = {
    'io.modelcontextprotocol/protocolVersion': modern,
    'io.modelcontextprotocol/clientCapabilities': {},
  };
  const name = typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {};
  const sent = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
    'MCP-Protocol-Version': modern,
    'Mcp-Method': method,
    ...name,
    ...headers,
  };
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method,
    params: { ...params, _meta: meta },
  });
  return app()('/mcp', { method: 'POST', headers: sent, body });
}

/** A tool's result, as far as the tests read it. */
interface ToolOutcome {
  /** Whether the tool refused. */
  readonly isError: boolean;
  /** The text of the result. */
  readonly text: string;
  /** The result, when the tool returned one. */
  readonly data: Record<string, unknown>;
}

/**
 * Calls a tool.
 *
 * @param token - The API token.
 * @param name - The tool.
 * @param input - Its arguments.
 * @returns The tool's result.
 */
async function call(token: string, name: string, input: Record<string, unknown> = {}) {
  const answer = await rpc(token, 'tools/call', { name, arguments: input });
  expect(answer.status).toBe(200);
  const result = answer.body?.result as {
    isError: boolean;
    content: { text: string }[];
    structuredContent?: Record<string, unknown>;
  };
  const outcome: ToolOutcome = {
    isError: result.isError,
    text: result.content[0]?.text ?? '',
    data: result.structuredContent ?? {},
  };
  return outcome;
}

/**
 * The names of the tools a token lists.
 *
 * @param token - The API token.
 * @returns The names, in the order listed.
 */
async function toolNames(token: string): Promise<string[]> {
  const listed = await rpc(token, 'tools/list');
  const { tools } = (listed.body?.result ?? {}) as { tools: { name: string }[] };
  return tools.map((tool) => tool.name);
}

/**
 * Adds the events connector at an access level.
 *
 * @param accessLevel - Its access level.
 */
async function addEvents(accessLevel: AccessLevel): Promise<void> {
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' }, accessLevel };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
}

/**
 * Creates the events dashboard, pinned or as a draft.
 *
 * @param cookie - An admin's session.
 * @param pinned - Whether to pin its first version.
 * @returns The dashboard id.
 */
async function eventsDashboard(cookie: string, pinned = true): Promise<string> {
  const created = await asPage(cookie, 'POST', '/dashboards', { spec: eventsSpec() });
  const id = String(created.body?.id);
  if (pinned) {
    const pin = await asPage(cookie, 'POST', `/dashboards/${id}/pin`, { version: 1 });
    expect(pin.status).toBe(200);
  }
  return id;
}

/** The read tools, in the order they are listed. */
const readTools = [
  'search_dashboards',
  'get_dashboard',
  'get_panel',
  'run_panel',
  'get_variable_options',
  'list_alerts',
  'get_alert',
  'list_reports',
  'get_report_run',
  'list_definitions',
];

/** The first frame of the first result of a `run_panel` call. */
function firstFrame(outcome: ToolOutcome) {
  const [first] = outcome.data.results as {
    accessLevel: number;
    result: { ok: boolean; frames?: Record<string, unknown>[] };
  }[];
  return {
    accessLevel: first?.accessLevel,
    ok: first?.result.ok,
    frame: first?.result.frames?.[0],
  };
}

describe('who reaches the MCP endpoint', () => {
  test('only an API token does: no cookie, no other site, and not while it is off', async () => {
    const admin = await member('admin');
    const send = (headers: Record<string, string>) =>
      app()('/mcp', { method: 'POST', headers, body: '{}' });
    expect((await send({})).status).toBe(401);
    expect((await send({ Authorization: 'Bearer qth_unknown' })).status).toBe(401);
    const cookie = `${sessionCookieName}=${admin.cookie}`;
    for (const headers of [{ cookie }, { cookie, 'X-Requested-With': 'quanthea' }]) {
      const page = await send(headers);
      expect(page.status).toBe(403);
      expect(page.body).toMatchObject({ error: { message: expect.stringContaining('MCP token') } });
    }
    const elsewhere = await rpc(admin.token, 'tools/list', {}, { Origin: 'https://evil.test' });
    expect(elsewhere.status).toBe(403);
    const own = await rpc(admin.token, 'tools/list', {}, { Origin: 'https://quanthea.test' });
    expect(own.status).toBe(200);
    const off = { mcp: false, maxLifetimeDays: 365, mcpQueryTools: false };
    expect((await asPage(admin.cookie, 'PUT', '/settings/api-access', off)).status).toBe(200);
    const refused = await rpc(admin.token, 'tools/list');
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: { message: 'The MCP server is turned off.' } });
  });

  test('it opens no stream: GET and DELETE answer 405', async () => {
    const { token } = await member('viewer');
    for (const method of ['GET', 'DELETE']) {
      const answer = await app()('/mcp', { method, headers: { Authorization: `Bearer ${token}` } });
      expect(answer.status).toBe(405);
      expect(answer.headers.get('allow')).toBe('POST');
    }
  });
});

describe('the MCP wire format', () => {
  test('server/discover names the revisions, the capabilities and the server', async () => {
    const { token } = await member('viewer');
    const answer = await rpc(token, 'server/discover');
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        resultType: 'complete',
        supportedVersions: [modern, '2025-11-25', '2025-06-18', '2025-03-26'],
        capabilities: { tools: {} },
        cacheScope: 'private',
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'quanthea', version: '1.2.3' } },
      },
    });
  });

  test('a request must repeat its revision, method and tool name in headers', async () => {
    const { token } = await member('viewer');
    const wrongMethod = await rpc(token, 'tools/list', {}, { 'Mcp-Method': 'tools/call' });
    expect(wrongMethod.status).toBe(400);
    expect(wrongMethod.body).toMatchObject({ id: 1, error: { code: -32020 } });
    const wrongName = await rpc(
      token,
      'tools/call',
      { name: 'get_panel', arguments: {} },
      { 'Mcp-Name': 'run_panel' },
    );
    expect(wrongName.body).toMatchObject({ error: { code: -32020 } });
    const wrongVersion = await rpc(
      token,
      'tools/list',
      {},
      { 'MCP-Protocol-Version': '2025-06-18' },
    );
    expect(wrongVersion.body).toMatchObject({ error: { code: -32020 } });
  });

  test('refuses what it cannot read, with the JSON-RPC code for each', async () => {
    const { token } = await member('viewer');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const post = (body: string, more: Record<string, string> = {}) =>
      app()('/mcp', { method: 'POST', headers: { ...headers, ...more }, body });
    expect((await post('{not json')).body).toMatchObject({ id: null, error: { code: -32700 } });
    expect((await post('[]')).body).toMatchObject({ error: { code: -32600 } });
    const bare = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    const noMeta = await post(bare, { 'MCP-Protocol-Version': modern, 'Mcp-Method': 'tools/list' });
    expect(noMeta.status).toBe(400);
    expect(noMeta.body).toMatchObject({ id: 7, error: { code: -32602 } });
    const future = await post(bare, { 'MCP-Protocol-Version': '2031-01-01' });
    expect(future.status).toBe(400);
    expect(future.body).toMatchObject({
      error: { code: -32022, data: { requested: '2031-01-01', supported: expect.any(Array) } },
    });
    const unknown = await rpc(token, 'resources/list');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: { code: -32601 } });
    const noTool = await rpc(token, 'tools/call', { name: 'drop_everything', arguments: {} });
    expect(noTool.body).toMatchObject({
      error: { code: -32602, message: 'Unknown tool: drop_everything' },
    });
  });

  test('a notification is accepted with no body', async () => {
    const { token } = await member('viewer');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const answer = await app()('/mcp', { method: 'POST', headers, body });
    expect(answer.status).toBe(202);
    expect(answer.body).toBeUndefined();
  });

  test('an earlier revision opens with initialize, and keeps no session', async () => {
    const { token } = await member('viewer');
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const post = (message: Record<string, unknown>, more: Record<string, string> = {}) =>
      app()('/mcp', {
        method: 'POST',
        headers: { ...headers, ...more },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, ...message }),
      });
    const params = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c' } };
    const opened = await post({ method: 'initialize', params });
    expect(opened.status).toBe(200);
    expect(opened.headers.get('mcp-session-id')).toBeNull();
    expect(opened.body).toMatchObject({
      id: 3,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'quanthea', version: '1.2.3' },
      },
    });
    const newest = await post({ method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    expect(newest.body).toMatchObject({ result: { protocolVersion: '2025-11-25' } });
    const version = { 'MCP-Protocol-Version': '2025-06-18' };
    const listed = await post({ method: 'tools/list' }, version);
    const result = listed.body?.result as Record<string, unknown>;
    expect(result.resultType).toBeUndefined();
    expect((result.tools as unknown[]).length).toBe(readTools.length);
    expect((await post({ method: 'ping' }, version)).body).toMatchObject({ result: {} });
    const unknown = await post({ method: 'resources/list' }, version);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toMatchObject({ error: { code: -32601 } });
  });
});

describe('the MCP tools', () => {
  test('every role lists the read tools; editors get the query tools once an admin allows them', async () => {
    const admin = await member('admin');
    const editor = await member('editor');
    const viewer = await member('viewer');
    expect(await toolNames(viewer.token)).toEqual(readTools);
    expect(await toolNames(editor.token)).toEqual(readTools);
    const refused = await rpc(editor.token, 'tools/call', { name: 'run_query', arguments: {} });
    expect(refused.body).toMatchObject({ error: { message: 'Unknown tool: run_query' } });
    const on = { mcp: true, maxLifetimeDays: 365, mcpQueryTools: true };
    await asPage(admin.cookie, 'PUT', '/settings/api-access', on);
    expect(await toolNames(viewer.token)).toEqual(readTools);
    expect(await toolNames(editor.token)).toEqual([
      ...readTools,
      'describe_connector',
      'run_query',
    ]);
  });

  test('each tool is listed with a schema of its arguments, and as read-only', async () => {
    const { token } = await member('viewer');
    const listed = await rpc(token, 'tools/list');
    const { tools } = (listed.body?.result ?? {}) as { tools: Record<string, unknown>[] };
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(tool.annotations).toEqual({ readOnlyHint: true });
    }
    const runPanel = tools.find((tool) => tool.name === 'run_panel');
    expect(runPanel?.inputSchema).toMatchObject({ required: ['dashboardId', 'panelId'] });
  });

  test('dashboards show once pinned, as written, with a link', async () => {
    await addEvents(4);
    const admin = await member('admin');
    const draft = await eventsDashboard(admin.cookie, false);
    const hidden = await call(admin.token, 'get_dashboard', { dashboardId: draft });
    expect(hidden.isError).toBe(true);
    expect(hidden.text).toContain('No dashboard');
    const id = await eventsDashboard(admin.cookie);
    const found = await call(admin.token, 'search_dashboards', { query: 'errors' });
    expect(found.data).toMatchObject({
      total: 1,
      dashboards: [{ id, title: 'Events', url: `https://quanthea.test/d/${id}` }],
    });
    const dashboard = await call(admin.token, 'get_dashboard', { dashboardId: id });
    expect(dashboard.data).toMatchObject({
      version: 1,
      time: { from: 'now-1h', to: 'now' },
      variables: [
        { name: 'env', kind: 'custom', default: 'prod' },
        { name: 'service' },
        { name: 'order' },
      ],
    });
    const panels = dashboard.data.panels as { id: string; connectors: string[] }[];
    expect(panels[0]).toMatchObject({ id: 'errors-peak', view: 'stat', connectors: ['events'] });
    const panel = await call(admin.token, 'get_panel', { dashboardId: id, panelId: 'errors-peak' });
    expect(panel.data.panel).toMatchObject({
      queries: [{ refId: 'A', sql: 'SELECT * FROM events' }],
    });
    const missing = await call(admin.token, 'get_panel', { dashboardId: id, panelId: 'nope' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('errors-peak');
  });

  test('a tool refuses arguments that do not match its schema, in words', async () => {
    const { token } = await member('viewer');
    const refused = await call(token, 'run_panel', { dashboardId: 'd', time: { from: 'soon' } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Invalid arguments for run_panel');
    expect(refused.text).toContain('panelId');
  });
});

describe('the gate on what MCP tools return', () => {
  const read = { panelId: 'errors-peak' };

  test('level 1 shows only that the query ran', async () => {
    await addEvents(1);
    const admin = await member('admin');
    const dashboardId = await eventsDashboard(admin.cookie);
    const outcome = await call(admin.token, 'run_panel', { dashboardId, ...read });
    const { accessLevel, ok, frame } = firstFrame(outcome);
    expect({ accessLevel, ok, frame }).toEqual({ accessLevel: 1, ok: true, frame: undefined });
    expect(outcome.text).not.toContain('cart');
  });

  test('level 2 shows the shape, never a summary or a row', async () => {
    await addEvents(2);
    const admin = await member('admin');
    const dashboardId = await eventsDashboard(admin.cookie);
    const { accessLevel, frame } = firstFrame(
      await call(admin.token, 'run_panel', { dashboardId, ...read }),
    );
    expect(accessLevel).toBe(2);
    expect(frame?.rowCount).toBeGreaterThan(0);
    expect(frame?.summaries).toBeUndefined();
    expect(frame?.rows).toBeUndefined();
  });

  test('level 3 adds summaries, and level 4 the rows, with how the read was made', async () => {
    await addEvents(3);
    const admin = await member('admin');
    const dashboardId = await eventsDashboard(admin.cookie);
    const summarised = firstFrame(await call(admin.token, 'run_panel', { dashboardId, ...read }));
    expect(summarised.frame?.summaries).toBeDefined();
    expect(summarised.frame?.rows).toBeUndefined();
    const id = services.connections.list()[0]?.id ?? '';
    await services.connections.update(id, { accessLevel: 4 }, 'admin-1');
    const time = { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' };
    const outcome = await call(admin.token, 'run_panel', { dashboardId, ...read, time });
    expect(firstFrame(outcome).frame?.rows).toBeDefined();
    expect(outcome.data).toMatchObject({
      dashboardId,
      version: 1,
      panel: { id: 'errors-peak' },
      time: { from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' },
      variables: { env: 'prod', service: '$__all', order: 'A-1' },
      results: [{ refId: 'A', connector: 'events', query: { sql: 'SELECT * FROM events' } }],
    });
  });

  test('a variable’s values from a query pass the gate; a written list is returned as written', async () => {
    await addEvents(2);
    const admin = await member('admin');
    const dashboardId = await eventsDashboard(admin.cookie);
    const written = await call(admin.token, 'get_variable_options', { dashboardId, name: 'env' });
    expect(written.data).toMatchObject({ kind: 'custom', options: ['prod', 'staging'] });
    const queried = await call(admin.token, 'get_variable_options', {
      dashboardId,
      name: 'service',
    });
    expect(queried.data).toMatchObject({ kind: 'query', connector: 'events', accessLevel: 2 });
    const result = queried.data.result as { frames: Record<string, unknown>[] };
    expect(result.frames[0]?.rows).toBeUndefined();
    const text = await call(admin.token, 'get_variable_options', { dashboardId, name: 'order' });
    expect(text.data).toMatchObject({ kind: 'text', default: 'A-1' });
  });

  test('a written query runs for editors once allowed, at the connector’s level', async () => {
    await addEvents(2);
    const admin = await member('admin');
    const on = { mcp: true, maxLifetimeDays: 365, mcpQueryTools: true };
    await asPage(admin.cookie, 'PUT', '/settings/api-access', on);
    const listed = await call(admin.token, 'describe_connector');
    expect(listed.data.connectors).toMatchObject([{ name: 'events', accessLevel: 2 }]);
    const described = await call(admin.token, 'describe_connector', { connector: 'events' });
    expect(described.data).toMatchObject({ connector: 'events', accessLevel: 2 });
    const query = { connector: 'events', language: 'sql', sql: 'SELECT * FROM events' };
    const ran = await call(admin.token, 'run_query', { query });
    expect(ran.data).toMatchObject({ connector: 'events', accessLevel: 2, result: { ok: true } });
    const result = ran.data.result as { frames: Record<string, unknown>[] };
    expect(result.frames[0]?.rows).toBeUndefined();
    const unknown = await call(admin.token, 'describe_connector', { connector: 'nope' });
    expect(unknown.isError).toBe(true);
  });
});

/**
 * A series as an evaluation leaves it.
 *
 * @param service - Its label.
 * @param state - Its state.
 * @param value - Its value.
 * @returns The series row.
 */
function seriesRow(service: string, state: 'ok' | 'firing', value: number) {
  return {
    key: `{service="${service}"}`,
    labels: { service },
    ...{ state, since: 5, value, lastSeenAt: 9, evaluatedAt: 9, notifiedAt: null },
    announced: false,
  };
}

/**
 * An active alert on the events connector, with two series evaluated.
 *
 * @param cookie - An admin's session.
 * @returns The alert id.
 */
async function firingAlert(cookie: string): Promise<string> {
  const spec = {
    specVersion: 1,
    title: 'Errors by service',
    query: { refId: 'A', connector: 'events', language: 'sql', sql: 'SELECT * FROM events' },
    value: { field: 'errors', by: ['service'], reduce: 'max' },
    condition: { kind: 'threshold', op: 'above', value: 4, for: '5m' },
    every: '1m',
    lookback: '10m',
    severity: 'warning',
    message: { title: '{alert}', body: '{series} at {value}.' },
  };
  const { alertId } = services.alerts.saveVersion({ spec }, 'admin-1');
  const active = await asPage(cookie, 'POST', `/alerts/${alertId}/activate`, { version: 1 });
  expect(active.status).toBe(200);
  services.alertEvaluation.states.saveEvaluation(alertId, {
    evaluatedAt: 9,
    series: [seriesRow('cart', 'ok', 2), seriesRow('pay', 'firing', 6)],
    removed: [],
    events: [],
  });
  return alertId;
}

describe('alerts and reports over MCP', () => {
  test('an alert lists as written; its state shows as its connector’s level allows', async () => {
    await addEvents(2);
    const admin = await member('admin');
    const alertId = await firingAlert(admin.cookie);
    const listed = await call(admin.token, 'list_alerts');
    expect(listed.data.alerts).toMatchObject([
      { id: alertId, title: 'Errors by service', severity: 'warning', deactivated: false },
    ]);
    expect(listed.text).not.toContain('pay');
    const shaped = await call(admin.token, 'get_alert', { alertId });
    expect(shaped.data).toMatchObject({
      connectors: ['events'],
      spec: { query: { sql: 'SELECT * FROM events' } },
      state: { level: 2, seriesCount: 2, labelNames: ['service'] },
    });
    expect(shaped.text).not.toContain('pay');
    expect((shaped.data.spec as Record<string, unknown>).notify).toBeUndefined();
    const id = services.connections.list()[0]?.id ?? '';
    await services.connections.update(id, { accessLevel: 3 }, 'admin-1');
    const open = await call(admin.token, 'get_alert', { alertId });
    expect(open.data.state).toMatchObject({
      level: 3,
      holdingNow: 1,
      states: { ok: 1, firing: 1 },
      series: [
        { value: 2, holds: false },
        { value: 6, holds: true },
      ],
    });
  });

  test('a report’s run reads frozen, through the gate, with no headline numbers', async () => {
    await addEvents(2);
    const admin = await member('admin');
    const { reportId } = services.reports.saveVersion({ spec: eventsReport() }, 'admin-1');
    await asPage(admin.cookie, 'POST', `/reports/${reportId}/activate`, { version: 1 });
    const ran = await asPage(admin.cookie, 'POST', `/reports/${reportId}/run`, { send: false });
    expect(ran.status).toBe(200);
    const listed = await call(admin.token, 'list_reports');
    expect(listed.data.reports).toMatchObject([
      { id: reportId, title: 'Weekly errors', lastRun: { status: 'ok' } },
    ]);
    expect(listed.text).not.toContain('headlines');
    const run = await call(admin.token, 'get_report_run', { reportId });
    expect(run.data).toMatchObject({ status: 'ok', summaryPanels: ['errors-peak'] });
    expect(run.text).not.toContain('headlines');
    const panel = await call(admin.token, 'get_report_run', { reportId, panelId: 'errors-peak' });
    expect(panel.data).toMatchObject({ frozen: true, read: 'run', panel: { id: 'errors-peak' } });
    const [first] = panel.data.results as {
      accessLevel: number;
      result: { frames: Record<string, unknown>[] };
    }[];
    expect(first?.accessLevel).toBe(2);
    expect(first?.result.frames[0]?.rowCount).toBeGreaterThan(0);
    expect(first?.result.frames[0]?.rows).toBeUndefined();
  });

  test('definitions list as the model may read them', async () => {
    const { token } = await member('viewer');
    expect((await call(token, 'list_definitions')).data).toMatchObject({ definitions: [] });
  });
});

describe('the record of what tokens did', () => {
  /**
   * The calls an admin reads.
   *
   * @param cookie - The admin's session.
   * @returns The calls, the newest first.
   */
  async function activity(cookie: string) {
    const listed = await asPage(cookie, 'GET', '/settings/api-access/activity');
    expect(listed.status).toBe(200);
    return (listed.body?.calls ?? []) as Record<string, unknown>[];
  }

  test('every tool call is written down: who, which token, the tool, its arguments, the outcome', async () => {
    await addEvents(4);
    const admin = await member('admin');
    const viewer = await member('viewer');
    const dashboardId = await eventsDashboard(admin.cookie);
    await call(viewer.token, 'run_panel', { dashboardId, panelId: 'errors-peak' });
    await call(viewer.token, 'get_dashboard', { dashboardId: 'no-such-dashboard' });
    await rpc(viewer.token, 'tools/call', { name: 'drop_everything', arguments: { all: true } });
    await rpc(viewer.token, 'tools/list');
    const calls = await activity(admin.cookie);
    expect(calls.map(({ tool, outcome }) => [tool, outcome])).toEqual([
      ['drop_everything', 'refused'],
      ['get_dashboard', 'refused'],
      ['run_panel', 'ok'],
    ]);
    expect(calls[2]).toMatchObject({
      tokenName: 'mcp',
      userId: viewer.id,
      userName: 'The viewer',
      role: 'viewer',
      arguments: JSON.stringify({ dashboardId, panelId: 'errors-peak' }),
      address: 'unknown',
    });
    expect(JSON.stringify(calls)).not.toContain('cart');
    expect(JSON.stringify(calls)).not.toContain(viewer.token);
  });

  test('only an admin reads it, and long arguments are cut', async () => {
    const admin = await member('admin');
    const viewer = await member('viewer');
    await call(viewer.token, 'search_dashboards', { query: 'x'.repeat(5000) });
    const refused = await asPage(viewer.cookie, 'GET', '/settings/api-access/activity');
    expect(refused.status).toBe(403);
    const [long] = await activity(admin.cookie);
    expect(String(long?.arguments).length).toBe(2001);
  });

  test('an address that keeps sending wrong tokens waits, and so does a right token from it', async () => {
    const { token } = await member('viewer');
    const send = app();
    const headers = (sent: string) => ({
      Authorization: `Bearer ${sent}`,
      'Content-Type': 'application/json',
    });
    const post = (sent: string) =>
      send('/mcp', { method: 'POST', headers: headers(sent), body: '{}' });
    for (let attempt = 0; attempt <= 20; attempt += 1)
      expect((await post(`qth_wrong${attempt}`)).status).toBe(401);
    const waiting = await post('qth_wrong');
    expect(waiting.status).toBe(429);
    expect(waiting.body).toMatchObject({ error: { code: 'rate_limited' } });
    expect((await post(token)).status).toBe(429);
  });

  test('right tokens never count against an address', async () => {
    const { token } = await member('viewer');
    const send = app();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const answer = await send('/mcp', { method: 'POST', headers, body: '{}' });
      expect(answer.status).toBe(400);
    }
  });
});
