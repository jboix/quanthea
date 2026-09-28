/**
 * The gate's promise at levels 1 and 2: nothing the model receives from a test query contains a
 * value from the source, whatever the values, labels, frame names or error texts hold.
 */
import { describe, expect, test } from 'bun:test';
import type { Frame } from '@querent/shared';
import { ConnectorError, type ConnectorInstance } from '../connectors/_shared/index.ts';
import { createQueryExecutor, type QuerySource } from '../query/executor.ts';
import { createResultCache } from '../query/result-cache.ts';
import type { GateSubject } from './subject.ts';
import { testQueryForModel } from './test-run.ts';

/**
 * A random marker that cannot appear in the gate's own output by chance.
 *
 * @param index - Makes each marker unique.
 * @returns A string marker.
 */
function marker(index: number): string {
  return `leak${index}x${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * A frame full of markers: in string values, unusual numbers, labels and the frame name.
 *
 * @param round - Which round, for unique markers.
 * @returns The frame and every marker it holds.
 */
function markedFrame(round: number): { frame: Frame; markers: string[] } {
  const strings = [marker(round * 10), marker(round * 10 + 1)];
  const numbers = [123_456.789_123 + round, 987_654.321_987 + round];
  const label = marker(round * 10 + 2);
  const name = marker(round * 10 + 3);
  const frame: Frame = {
    refId: 'A',
    name,
    fields: [
      { name: 'time', type: 'time' },
      { name: 'value', type: 'number', labels: { service: label } },
      { name: 'text', type: 'string' },
    ],
    values: [[1_790_000_000_000 + round, 1_790_000_060_000 + round], numbers, strings],
    meta: { rowCount: 2, truncated: false, durationMs: 1 },
  };
  return {
    frame,
    markers: [...strings, ...numbers.map(String), label, name, String(1_790_000_000_000 + round)],
  };
}

/**
 * A source whose connector returns the given frames, or throws the given error.
 *
 * @param outcome - The frames, or an error.
 * @returns The source.
 */
function sourceReturning(outcome: Frame[] | ConnectorError): QuerySource {
  const execute: ConnectorInstance['execute'] = () =>
    outcome instanceof ConnectorError ? Promise.reject(outcome) : Promise.resolve(outcome);
  const unused = () => Promise.reject(new Error('unused'));
  return {
    connectorId: 'c',
    version: 1,
    language: 'sql',
    instance: {
      test: unused,
      describe: unused,
      sampleValues: unused,
      execute,
      close: () => Promise.resolve(),
    },
    guardrails: { timeoutMs: 1000, maxRows: 100, maxRangeDays: 7 },
  };
}

const request = {
  refId: 'A',
  template: { language: 'sql' as const, sql: 'SELECT 1' },
  variables: {},
  timeRange: { from: new Date(0), to: new Date(60_000) },
};

describe.each([1, 2] as const)('level %i never leaks a value', (accessLevel) => {
  const subject: GateSubject = {
    name: 'db',
    kind: 'postgres',
    accessLevel,
    hiddenFields: [],
    descriptions: {},
  };

  test('from result rows, numbers, labels or frame names, over 50 random results', async () => {
    for (let round = 0; round < 50; round += 1) {
      const { frame, markers } = markedFrame(round);
      const executor = createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 }));
      const result = await testQueryForModel(subject, executor, sourceReturning([frame]), request);
      const text = JSON.stringify(result);
      expect(result.ok).toBe(true);
      markers.forEach((value) => {
        expect(text).not.toContain(value);
      });
    }
  });

  test('from the text of a failed query', async () => {
    const secret = marker(999);
    const executor = createQueryExecutor(createResultCache({ ttlMs: 1, maxEntries: 1 }));
    const failure = new ConnectorError(
      'syntax',
      'A value has the wrong type or format (SQLSTATE 22P02).',
      `bad value "${secret}"`,
    );
    const result = await testQueryForModel(subject, executor, sourceReturning(failure), request);
    expect(result).toEqual({
      ok: false,
      error: 'A value has the wrong type or format (SQLSTATE 22P02).',
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
