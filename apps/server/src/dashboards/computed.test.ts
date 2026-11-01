import { describe, expect, test } from 'bun:test';
import { dashboardSpecSchema, type Frame } from '@quanthea/shared';
import type { BoundQuery } from '../connectors/_shared/index.ts';
import type { AppError } from '../lib/errors.ts';
import { bindTemplate } from '../query/bind.ts';
import type { QueryExecutor, QuerySource } from '../query/executor.ts';
import { type ComputedVariable, computedValues } from './computed.ts';
import { type RunnerDependencies, runPanel } from './run-panel.ts';

const guardrails = { timeoutMs: 10_000, maxRows: 50_000, maxRangeDays: 90 };

/**
 * A frame of the given columns.
 *
 * @param columns - Each column's name and values.
 * @returns The frame.
 */
function frameOf(columns: Record<string, unknown[]>): Frame {
  const names = Object.keys(columns);
  const values = Object.values(columns);
  return {
    refId: 'options',
    fields: names.map((name, index) => ({
      name,
      type: typeof values[index]?.[0] === 'number' ? 'number' : 'string',
    })),
    values,
    meta: { rowCount: values[0]?.length ?? 0, truncated: false, durationMs: 1 },
  };
}

/**
 * A computed variable.
 *
 * @param fields - Fields to set, such as `multi` or `field`.
 * @returns The variable.
 */
function computed(fields: Partial<ComputedVariable> = {}): ComputedVariable {
  const source = { connector: 'live', language: 'sql', sql: 'SELECT id, plays FROM live' } as const;
  return { kind: 'computed', name: 'live', source, ...fields };
}

/**
 * The message a computation fails with.
 *
 * @param run - The computation.
 * @returns The message.
 */
function failure(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as AppError).message;
  }
  return 'no failure';
}

describe('the values of a computed variable', () => {
  const frame = frameOf({ id: ['m1', 'm2', 'm1', null], plays: [9, 7, 5, 3] });

  test('one value: the first row of the first column, or of the named one, as text', () => {
    expect(computedValues(computed(), [frame])).toEqual(['m1']);
    expect(computedValues(computed({ field: 'plays' }), [frame])).toEqual(['9']);
  });

  test('several: every distinct value, missing ones left out, cut at 1,000', () => {
    expect(computedValues(computed({ multi: true }), [frame])).toEqual(['m1', 'm2']);
    const many = frameOf({ id: Array.from({ length: 1200 }, (_, index) => `m${index}`) });
    expect(computedValues(computed({ multi: true }), [many])).toHaveLength(1000);
    expect(computedValues(computed({ multi: true }), [frameOf({ id: [] })])).toEqual([]);
  });

  test('fail with a plain message for no row, a long value or an unknown column', () => {
    expect(failure(() => computedValues(computed(), [frameOf({ id: [] })]))).toBe(
      '$live has no value: its query found no row.',
    );
    const long = frameOf({ id: ['x'.repeat(201)] });
    expect(failure(() => computedValues(computed(), [long]))).toBe(
      '$live has a value over 200 characters.',
    );
    expect(failure(() => computedValues(computed({ field: 'nope' }), [frame]))).toBe(
      '$live reads "nope", which its query does not return.',
    );
  });
});

/** Two panels of plays, filtered by the media a computed variable lists. */
const spec = dashboardSpecSchema.parse({
  specVersion: 1,
  title: 'Plays',
  time: { from: 'now-1h', to: 'now' },
  variables: [computed({ multi: true })],
  panels: ['a', 'b'].map((id, index) => ({
    id,
    title: id,
    grid: { x: index * 6, y: 0, w: 6, h: 4 },
    queries: [
      { refId: 'A', connector: 'shop', language: 'sql', sql: 'SELECT 1 WHERE m IN (:live)' },
    ],
    view: { kind: 'table', ref: 'A', columns: [{ field: 'x' }] },
  })),
});

describe('a computed variable in a run', () => {
  test('binds what its source returns, whatever was picked, and loads once for parallel panels', async () => {
    let loads = 0;
    const bound: BoundQuery[] = [];
    const executor: QueryExecutor = {
      run: async (_source, request) => {
        const query = bindTemplate(request.template, request.variables, request.timeRange);
        if (request.refId !== 'options') bound.push(query);
        else loads += 1;
        await Bun.sleep(5);
        const frames = request.refId === 'options' ? [frameOf({ id: ['m1', 'm2'] })] : [];
        return { frames, bound: query, cached: false };
      },
    };
    const dependencies: RunnerDependencies = {
      openSource: async (name) => ({ connectorId: name, guardrails }) as unknown as QuerySource,
      executor,
      now: () => Date.parse('2026-10-01T12:00:00Z'),
    };
    const choices = { variables: { live: 'picked' } };
    await Promise.all(['a', 'b'].map((id) => runPanel(dependencies, spec, id, choices)));
    expect(loads).toBe(1);
    const parameters = bound.map((query) => (query.language === 'sql' ? query.parameters : []));
    expect(parameters).toEqual([
      ['m1', 'm2'],
      ['m1', 'm2'],
    ]);
  });
});
