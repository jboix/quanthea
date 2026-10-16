import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDatabase } from '../db/database.ts';
import { createDefinitionRepository } from '../db/definition-repository.ts';
import { runMigrations } from '../db/migrate.ts';
import { temporaryDir } from '../test/fixtures.ts';
import { type DefinitionConnector, fieldNamesOf } from './definition-hidden.ts';
import { createDefinitions, type RunData } from './definitions.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;
const audited: unknown[] = [];

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  audited.length = 0;
  alsoHidden.clear();
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/** Names hidden beyond `email`, which a test may add after a save. */
const alsoHidden = new Set<string>();

/** A search connector that hides `session.email`, and whatever `alsoHidden` holds. */
const events: DefinitionConnector = {
  name: 'events',
  language: 'search',
  isHidden: (name) => name.toLowerCase().endsWith('email') || alsoHidden.has(name),
};

/**
 * The service over a fresh database, with a stand-in for the test run.
 *
 * @param runData - What a test run of a body gives.
 * @returns The service.
 */
function service(runData: RunData = async () => ({ ok: true, rows: 12 })) {
  return createDefinitions({
    repository: createDefinitionRepository(database),
    audit: { append: (entry) => audited.push(entry) },
    dashboards: { check: () => ({ ok: true }) as never, testRun: async () => [] },
    connectors: () => [events],
    runData,
    now: () => 1000,
  });
}

const meaning = 'ERROR events, excluding business errors and blocked media, over START events.';
const ratio = {
  shape: 'ratio',
  request: {
    kind: 'search-ratio',
    index: 'core_events',
    match: [{ field: 'event_name', value: 'ERROR' }],
    of: [{ field: 'event_name', value: 'START' }],
  },
};
const errorRate = { id: 'error-rate', name: 'Error rate', meaning, bodies: [ratio] };

describe('definitions', () => {
  test('save versions after the latest, audited, and refuse a change based on an older one', async () => {
    const definitions = service();
    const first = await definitions.save(errorRate, null, 'editor-1');
    expect(first.version.version).toBe(1);
    expect(first.tests).toEqual([{ language: 'search', connector: 'events', rows: 12 }]);
    expect((await definitions.save(errorRate, 1, 'editor-1')).version.version).toBe(2);
    await expect(definitions.save(errorRate, 1, 'editor-2')).rejects.toThrow('changed since');
    expect(audited).toHaveLength(2);
    expect(definitions.history('error-rate').map((each) => each.version)).toEqual([2, 1]);
  });

  test('refuse a meaning or a body that names a hidden field', async () => {
    const definitions = service();
    const leaking = { ...errorRate, meaning: 'Errors by session.email over starts.' };
    await expect(definitions.save(leaking, null, 'editor-1')).rejects.toThrow(
      'The meaning names a field hidden on events.',
    );
    const by = { ...ratio, request: { ...ratio.request, by: 'session.email' } };
    await expect(
      definitions.save({ ...errorRate, bodies: [by] }, null, 'editor-1'),
    ).rejects.toThrow('A search body uses a field hidden on events.');
  });

  test('refuse a body its builder refuses, whatever its origin', async () => {
    const wrong = { ...ratio, request: { ...ratio.request, over: 'week' } };
    const definition = { ...errorRate, bodies: [wrong] };
    await expect(service().save(definition, null, 'provisioning', 'file')).rejects.toThrow(
      'The search body is not a valid search-ratio request',
    );
  });

  test('refuse a body that does not run, and say how many rows one found', async () => {
    const failing = service(async () => ({ ok: false, message: 'no such index' }));
    await expect(failing.save(errorRate, null, 'editor-1')).rejects.toThrow(
      'The search body does not run: no such index',
    );
    const empty = await service(async () => ({ ok: true, rows: 0 })).save(errorRate, null, 'e');
    expect(empty.tests[0]?.rows).toBe(0);
  });

  test('check a definition as a save does, saving nothing, and name its latest version', async () => {
    const definitions = service();
    const checked = await definitions.check(errorRate);
    expect(checked.latest).toBeNull();
    expect(checked.tests).toEqual([{ language: 'search', connector: 'events', rows: 12 }]);
    expect(definitions.list()).toEqual([]);
    await definitions.save(errorRate, null, 'editor-1');
    expect((await definitions.check(errorRate)).latest).toBe(1);
    const leaking = { ...errorRate, meaning: 'Errors by session.email over starts.' };
    await expect(definitions.check(leaking)).rejects.toThrow('hidden on events');
  });

  test('test-run a ratio as one share over the range, since a body holds no time column', async () => {
    const asked: Record<string, unknown>[] = [];
    await service(async (data) => {
      asked.push({ ...data });
      return { ok: true, rows: 1 };
    }).save(errorRate, null, 'editor-1');
    expect(asked[0]).toMatchObject({ kind: 'search-ratio', over: 'range', connector: 'events' });
  });

  test('delete a definition as a version, and list only the ones left', async () => {
    const definitions = service();
    await definitions.save(errorRate, null, 'editor-1');
    await definitions.save(
      { ...errorRate, id: 'sessions', name: 'Sessions', bodies: [] },
      null,
      'e',
    );
    definitions.remove('error-rate', 1, 'editor-1');
    expect(definitions.list().map((each) => each.definition.id)).toEqual(['sessions']);
    expect(() => definitions.remove('error-rate', 2, 'editor-1')).toThrow('No definition');
  });
});

test('the model reads no meaning, and no body, that names a field hidden since the save', async () => {
  const definitions = service();
  await definitions.save(errorRate, null, 'editor-1');
  await definitions.save(
    { ...errorRate, id: 'starts', name: 'Starts', meaning: 'Playbacks that began.' },
    null,
    'e',
  );
  alsoHidden.add('event_name');
  expect(
    definitions.forModel().map((each) => [each.definition.id, each.definition.bodies.length]),
  ).toEqual([
    ['error-rate', 0],
    ['starts', 0],
  ]);
  alsoHidden.add('began');
  expect(definitions.forModel().map((each) => each.definition.id)).toEqual(['error-rate']);
});

test('the field names of a body are read at any depth', () => {
  expect(fieldNamesOf(ratio.request)).toEqual(['event_name', 'event_name']);
  expect(fieldNamesOf({ measure: { fn: 'sum', column: 'amount' }, by: 'country' })).toEqual([
    'amount',
    'country',
  ]);
});
