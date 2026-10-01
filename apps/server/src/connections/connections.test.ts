import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema } from '@querent/shared';
import { ConnectorError, defineConnector } from '../connectors/_shared/index.ts';
import { memoryConnector } from '../connectors/_shared/test/memory-connector.ts';
import { createAuditRepository } from '../db/audit-repository.ts';
import { createConnectorRepository } from '../db/connector-repository.ts';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { auditActions, storedSecrets } from '../db/test/inspect.ts';
import type { AppError } from '../lib/errors.ts';
import { maskSecret } from '../secrets/mask.ts';
import { temporaryDir, testSecretBox } from '../test/fixtures.ts';
import { type Connections, createConnections } from './connections.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;
let connections: Connections;
let secretBox: Awaited<ReturnType<typeof testSecretBox>>;
let clock = 1000;

beforeEach(async () => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  secretBox = await testSecretBox();
  connections = createConnections({
    kinds: [memoryConnector],
    repository: createConnectorRepository(database),
    audit: createAuditRepository(database),
    secretBox,
    now: () => clock,
  });
});

afterEach(async () => {
  await connections.closeAll();
  database.close();
  dataDir.remove();
});

const secretToken = 'a-long-token-that-must-never-leak-9f2a';

/**
 * Creates the memory connector `events`.
 *
 * @param overrides - Input fields to replace.
 * @returns The created connector.
 */
function createEvents(overrides: Record<string, unknown> = {}) {
  const input = connectorInputSchema.parse({
    name: 'events',
    kind: 'memory',
    config: { rowCount: 5 },
    secret: { token: secretToken },
    hiddenFields: ['events.errors'],
    ...overrides,
  });
  return connections.create(input, 'admin-1');
}

/**
 * Awaits a call and returns the AppError it rejected with.
 *
 * @param call - The pending call.
 * @returns The error.
 */
function failureOf(call: Promise<unknown>): Promise<AppError> {
  return call.then(
    (): AppError => {
      throw new Error('Expected the call to fail.');
    },
    (error: unknown) => error as AppError,
  );
}

describe('connections', () => {
  test('lists the kinds with the JSON Schemas of their forms', () => {
    const [kind] = connections.kinds();
    expect(kind).toMatchObject({ kind: 'memory', displayName: 'Memory', language: 'sql' });
    expect(kind?.configSchema).toMatchObject({
      properties: { rowCount: { title: 'Rows', default: 5 } },
    });
    expect(kind?.secretSchema).toMatchObject({ required: ['token'] });
  });

  test('creates a connector, seals its secret and returns it masked', async () => {
    const created = await createEvents();
    expect(created).toMatchObject({
      name: 'events',
      kind: 'memory',
      accessLevel: 2,
      config: { rowCount: 5 },
      target: null,
    });
    expect(created.secret).toEqual({ token: '••••••••9f2a' });
    const [stored] = storedSecrets(database);
    expect(Buffer.from(stored ?? []).includes(secretToken)).toBe(false);
    expect(connections.list().map((connector) => connector.name)).toEqual(['events']);
    expect(auditActions(database)).toEqual(['connector.create']);
  });

  test('refuses invalid settings without echoing them, and a taken name', async () => {
    const invalid = await failureOf(
      createEvents({ config: { rowCount: -1 }, secret: { token: '' } }),
    );
    expect(invalid.code).toBe('bad_request');
    expect(invalid.details).toMatchObject([
      { part: 'config', path: 'rowCount' },
      { part: 'secret', path: 'token' },
    ]);
    await createEvents();
    const taken = await failureOf(createEvents());
    expect(taken.message).toBe('A connector named "events" already exists.');
    expect(JSON.stringify([invalid, taken])).not.toContain(secretToken);
  });

  test('says a missing setting is required', async () => {
    const missing = await failureOf(createEvents({ secret: {} }));
    expect(missing.details).toEqual([{ part: 'secret', path: 'token', message: 'Required.' }]);
  });

  test('refuses an unknown kind', async () => {
    expect((await failureOf(createEvents({ kind: 'oracle' }))).message).toBe(
      'Unknown connector kind "oracle".',
    );
  });

  test('keeps stored secret fields a change leaves out, and reopens the connection', async () => {
    const created = await createEvents();
    const before = await connections.open('events');
    clock += 1;
    const updated = await connections.update(
      created.id,
      { config: { rowCount: 7 }, accessLevel: 3 },
      'admin-2',
    );
    expect(updated.secret).toEqual({ token: '••••••••9f2a' });
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    const after = await connections.open('events');
    expect(after.source.instance).not.toBe(before.source.instance);
    expect(after.subject.accessLevel).toBe(3);
    expect(auditActions(database)).toEqual(['connector.create', 'connector.update']);
  });

  test('replaces a secret field a change gives', async () => {
    const created = await createEvents();
    const updated = await connections.update(created.id, { secret: { token: 'short' } }, 'admin-1');
    expect(updated.secret).toEqual({ token: '••••••••' });
  });

  test('tests the connection, and reads, marks and caches the schema', async () => {
    const created = await createEvents();
    expect(await connections.test(created.id, AbortSignal.timeout(1000))).toMatchObject({
      ok: true,
    });
    expect(connections.schema(created.id)).toEqual({ readAt: null, entities: [] });
    const view = await connections.refreshSchema(created.id, AbortSignal.timeout(1000));
    expect(view.readAt).toBe(clock);
    expect(view.entities[0]?.fields).toEqual([
      { name: 'time', type: 'timestamp', hidden: false, modelSees: 'name' },
      { name: 'service', type: 'text', hidden: false, distinctValues: 3, modelSees: 'values' },
      { name: 'errors', type: 'integer', hidden: true, modelSees: 'nothing' },
    ]);
    expect(connections.schema(created.id)).toEqual(view);
  });

  test('reports a source that fails to describe itself with its safe message only', async () => {
    const brokenConnector = defineConnector({
      ...memoryConnector,
      kind: 'broken',
      open: (options) => ({
        ...memoryConnector.open(options),
        describe: () =>
          Promise.reject(
            new ConnectorError(
              'unreachable',
              'The source did not answer.',
              'db-7.internal refused',
            ),
          ),
      }),
    });
    const broken = createConnections({
      kinds: [brokenConnector],
      repository: createConnectorRepository(database),
      audit: createAuditRepository(database),
      secretBox: await testSecretBox(),
    });
    const created = await broken.create(
      connectorInputSchema.parse({
        name: 'broken',
        kind: 'broken',
        config: {},
        secret: { token: 't' },
      }),
      'admin-1',
    );
    const failure = await failureOf(broken.refreshSchema(created.id, AbortSignal.timeout(1000)));
    expect(failure).toMatchObject({
      code: 'source_failed',
      message: 'The source did not answer.',
      details: { code: 'unreachable' },
    });
    await broken.closeAll();
  });

  test('deletes a connector with its schema, and then knows nothing of it', async () => {
    const created = await createEvents();
    await connections.refreshSchema(created.id, AbortSignal.timeout(1000));
    await connections.remove(created.id, 'admin-1');
    expect((await failureOf(connections.get(created.id))).code).toBe('not_found');
    expect((await failureOf(connections.open('events'))).code).toBe('not_found');
    expect(auditActions(database)).toEqual(['connector.create', 'connector.delete']);
  });

  test('opens a connector by name for the query engine and the gate', async () => {
    await createEvents();
    const { source, subject } = await connections.open('events');
    expect(source).toMatchObject({
      language: 'sql',
      guardrails: { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 },
    });
    expect(subject).toEqual({
      name: 'events',
      kind: 'memory',
      accessLevel: 2,
      hiddenFields: ['events.errors'],
      descriptions: {},
    });
  });
});

describe('maskSecret', () => {
  test('keeps the last four characters of long values only', () => {
    expect(maskSecret('sk-0123456789abcdef9f2a')).toBe('••••••••9f2a');
    expect(maskSecret('hunter2')).toBe('••••••••');
  });
});

describe('a connector whose kind is gone', () => {
  /**
   * The service over the same database, offering no kind: the plugin that added `memory` is gone.
   *
   * @returns The service.
   */
  function withoutTheKind(): Connections {
    return createConnections({
      kinds: [],
      repository: createConnectorRepository(database),
      audit: createAuditRepository(database),
      secretBox,
      now: () => clock,
    });
  }

  test('is listed and shown as not installed, and can be deleted', async () => {
    const created = await createEvents();
    const gone = withoutTheKind();
    expect(gone.list()).toMatchObject([{ name: 'events', installed: false }]);
    expect(await gone.get(created.id)).toMatchObject({ installed: false, target: null });
    expect(connections.list()).toMatchObject([{ installed: true }]);
    await gone.remove(created.id, 'admin-1');
    expect(gone.list()).toEqual([]);
  });

  test('fails its test, its queries, its checks and its edits with the same reason', async () => {
    const created = await createEvents();
    const gone = withoutTheKind();
    const reason =
      'The plugin that adds the kind "memory" is not installed. Install it, or delete this connector.';
    expect(await gone.test(created.id, AbortSignal.timeout(1000))).toEqual({
      ok: false,
      latencyMs: 0,
      message: reason,
      readOnly: null,
    });
    expect((await failureOf(gone.open('events'))).message).toBe(reason);
    expect(gone.lookup('events')).toEqual({ notInstalled: reason });
    expect(gone.lookup('nope')).toBeUndefined();
    expect((await failureOf(gone.update(created.id, { accessLevel: 1 }, 'admin-1'))).message).toBe(
      reason,
    );
  });
});
