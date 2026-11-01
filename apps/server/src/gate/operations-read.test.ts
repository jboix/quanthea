import { describe, expect, test } from 'bun:test';
import type { AccessLevel, Frame } from '@quanthea/shared';
import type { QueryExecutor, QueryRequest, QuerySource } from '../query/executor.ts';
import { everythingShown } from '../query/scope/object-scope.ts';
import { readOperationsForModel } from './operations-read.ts';
import type { GateSubject } from './subject.ts';

/**
 * A connector at a level.
 *
 * @param name - Its name.
 * @param accessLevel - Its level.
 * @returns The connector.
 */
function subject(name: string, accessLevel: AccessLevel): GateSubject {
  return {
    id: name,
    name,
    kind: 'postgres',
    accessLevel,
    hiddenFields: [],
    scope: everythingShown,
    descriptions: {},
  };
}

/**
 * A frame of one row.
 *
 * @param refId - Its query.
 * @param columns - Each column's name and value.
 * @returns The frame.
 */
function rowOf(refId: string, columns: Record<string, string | number>): Frame {
  return {
    refId,
    fields: Object.entries(columns).map(([name, value]) => ({
      name,
      type: typeof value === 'number' ? 'number' : 'string',
    })),
    values: Object.values(columns).map((value) => [value]),
    meta: { rowCount: 1, truncated: false, durationMs: 1 },
  };
}

const subjects = new Map([
  ['events', subject('events', 4)],
  ['titles', subject('titles', 2)],
]);

/**
 * Opens a connector of {@link subjects}.
 *
 * @param name - Its name.
 * @returns Its views.
 */
async function open(name: string) {
  const found = subjects.get(name);
  if (!found) throw new Error('unknown');
  return { source: { connectorId: name } as unknown as QuerySource, subject: found };
}

const frames: Record<string, Frame> = {
  A: rowOf('A', { show: 's1', plays: 10 }),
  B: rowOf('B', { show: 's1', title: 'Morning' }),
};

const executor: QueryExecutor = {
  run: async (_source, request) => {
    const frame = frames[request.refId];
    if (!frame) throw new Error('secret table missing');
    return { frames: [frame], bound: {} as never, cached: false };
  },
};

/**
 * The read of one query.
 *
 * @param connector - Its connector.
 * @param refId - Its refId.
 * @returns The read.
 */
function read(connector: string, refId: string) {
  const request = { refId, template: {}, variables: {}, timeRange: {} } as unknown as QueryRequest;
  return { connector, request };
}

describe('a read of a panel with operations', () => {
  const join = { op: 'join', with: 'B', on: ['show'], how: 'outer' } as const;

  test('gives the joined table, a key of both connectors at the stricter level', async () => {
    const result = await readOperationsForModel(
      open,
      executor,
      [read('events', 'A'), read('titles', 'B')],
      [{ ...join, on: [...join.on] }],
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.parts?.map((part) => part.connector)).toEqual(['titles', 'events']);
    expect(JSON.stringify(result)).not.toContain('Morning');
    expect(JSON.stringify(result)).not.toContain('s1');
    expect(JSON.stringify(result.parts?.[1])).toContain('"rows":[[10]]');
  });

  test('gives a failing query as the connector shows it, and an unknown connector', async () => {
    const failed = await readOperationsForModel(
      open,
      executor,
      [read('events', 'A'), read('titles', 'C')],
      [{ ...join, with: 'C', on: ['show'] }],
    );
    expect(failed).toEqual({ ok: false, error: 'The query failed.' });
    const unknown = await readOperationsForModel(open, executor, [read('nope', 'A')], []);
    expect(unknown.ok).toBe(false);
  });

  test('gives a step that cannot run as its message', async () => {
    const result = await readOperationsForModel(
      open,
      executor,
      [read('events', 'A')],
      [{ op: 'sort', by: 'plays_total', descending: false }],
    );
    expect(result).toEqual({
      ok: false,
      error: 'operations[0] (sort): no column "plays_total" (columns: show, plays).',
    });
  });
});
