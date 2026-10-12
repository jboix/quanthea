import { describe, expect, test } from 'bun:test';
import type { ObjectVisibility } from '@quanthea/shared';
import type { ConnectorFacts } from './check-queries.ts';
import { countObjectUsage } from './object-usage.ts';

const guardrails = { timeoutMs: 10_000, maxRows: 1000, maxRangeDays: 90 };

/**
 * A search connector's facts with a visibility.
 *
 * @param visibility - What it shows.
 * @returns The facts.
 */
function facts(visibility: Partial<ObjectVisibility>): ConnectorFacts {
  const full = { showSystem: false, mode: 'except' as const, names: [], ...visibility };
  return { language: 'search', guardrails, scope: { visibility: full, family: 'search' } };
}

/**
 * A spec with one stat over an index expression of the `logs` connector.
 *
 * @param index - The index expression.
 * @returns The spec, as stored.
 */
function specOn(index: string) {
  const query = { refId: 'A', connector: 'logs', language: 'search', index, body: { size: 0 } };
  const view = {
    kind: 'stat',
    ref: 'A',
    field: 'count',
    reduce: 'max',
    format: { $fmt: 'number' },
  };
  const grid = { x: 0, y: 0, w: 4, h: 3 };
  const panel = { id: 'count', title: 'Count', grid, queries: [query], view };
  return { specVersion: 1, title: 'Logs', time: { from: 'now-1h', to: 'now' }, panels: [panel] };
}

/**
 * Counts the usage of a change over one thread per index expression, and the first one pinned.
 *
 * @param names - The names the change hides.
 * @param hides - The catalogue objects it hides.
 * @param indices - The index expression of each thread's draft.
 * @returns The counts.
 */
function usage(names: string[], hides: string[], indices: string[]) {
  const specs = indices.map((index) => ({ spec: specOn(index) }));
  return countObjectUsage(
    { connector: 'logs', proposed: facts({ names }), hides },
    {
      lookup: (name) => (name === 'logs' ? facts({}) : undefined),
      threadSpecs: () => specs,
      pinnedSpecs: () => specs.slice(0, 1),
      now: Date.UTC(2026, 0, 1),
    },
  );
}

describe('the dashboards that read an object a connector stops showing', () => {
  test('name it in full', () => {
    expect(usage(['logs-app'], ['logs-app'], ['logs-app', 'metrics'])).toEqual({
      threads: 1,
      pinned: 1,
    });
  });

  test('or reach it with a pattern', () => {
    expect(usage(['logs-app'], ['logs-app'], ['metrics', 'logs-*', 'm*,-logs-*'])).toEqual({
      threads: 1,
      pinned: 0,
    });
  });

  test('and are not the ones a query already failed in', () => {
    expect(usage(['logs-app'], ['logs-app'], ['.kibana', 'not json {{'])).toEqual({
      threads: 0,
      pinned: 0,
    });
  });

  test('nor the ones of another connector, or a spec that no longer parses', () => {
    const change = { connector: 'other', proposed: facts({ names: ['logs-app'] }), hides: [] };
    const sources = {
      lookup: () => facts({}),
      threadSpecs: () => [{ spec: specOn('logs-app') }, { spec: { title: 'Broken' } }],
      pinnedSpecs: () => [],
      now: 0,
    };
    expect(countObjectUsage(change, sources)).toEqual({ threads: 0, pinned: 0 });
  });
});
