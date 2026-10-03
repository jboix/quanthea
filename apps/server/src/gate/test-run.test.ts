import { describe, expect, test } from 'bun:test';
import type { AccessLevel, Frame } from '@quanthea/shared';
import { ConnectorError } from '../connectors/_shared/index.ts';
import { QueryError } from '../query/query-error.ts';
import type { GateSubject } from './subject.ts';
import { modelPanelResult, modelRowLimit, modelTestError, modelTestResult } from './test-run.ts';

const frame: Frame = {
  refId: 'A',
  name: 'errors{service="checkout-svc", tenant="acme"}',
  fields: [
    { name: 'time', type: 'time' },
    { name: 'Value', type: 'number', labels: { service: 'checkout-svc', tenant: 'acme' } },
    { name: 'email', type: 'string' },
  ],
  values: [
    [0, 60_000],
    [0.5, 8.4],
    ['a@example.com', 'b@example.com'],
  ],
  meta: { rowCount: 2, truncated: false, durationMs: 3 },
};

/**
 * A subject at a level that hides the email column and the tenant label.
 *
 * @param accessLevel - The access level.
 * @returns The subject.
 */
function subjectAt(accessLevel: AccessLevel): GateSubject {
  return {
    name: 'db',
    kind: 'postgres',
    accessLevel,
    hiddenFields: ['customers.email', 'tenant'],
    descriptions: {},
  };
}

describe('modelTestResult', () => {
  test('level 1: whether it worked, nothing else', () => {
    expect(modelTestResult(subjectAt(1), [frame])).toEqual({ ok: true });
  });

  test('level 2: the shape, label names only, no hidden fields', () => {
    expect(modelTestResult(subjectAt(2), [frame])).toEqual({
      ok: true,
      frames: [
        {
          fields: [
            { name: 'time', type: 'time' },
            { name: 'Value', type: 'number', labels: ['service'] },
          ],
          rowCount: 2,
          truncated: false,
        },
      ],
    });
  });

  test('level 3: also labels with values and summaries, still no hidden fields', () => {
    const result = modelTestResult(subjectAt(3), [frame]);
    const [modelFrame] = result.ok ? (result.frames ?? []) : [];
    expect(modelFrame?.fields[1]).toEqual({
      name: 'Value',
      type: 'number',
      labels: { service: 'checkout-svc' },
    });
    expect(modelFrame?.summaries?.map((summary) => summary.field)).toEqual(['time', 'Value']);
    // When, not rows: the times of the extremes and of the spikes.
    expect(modelFrame?.summaries?.[1]).toMatchObject({
      minAt: '1970-01-01T00:00:00.000Z',
      maxAt: '1970-01-01T00:01:00.000Z',
      spikeWindows: [],
    });
    expect(modelFrame?.rows).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('example.com');
    expect(JSON.stringify(result)).not.toContain('acme');
  });

  test('level 4: also the rows, capped for the model', () => {
    const many: Frame = {
      refId: 'A',
      fields: [{ name: 'n', type: 'number' }],
      values: [Array.from({ length: modelRowLimit + 10 }, (_unused, index) => index)],
      meta: { rowCount: modelRowLimit + 10, truncated: false, durationMs: 1 },
    };
    const result = modelTestResult(subjectAt(4), [many]);
    const [modelFrame] = result.ok ? (result.frames ?? []) : [];
    expect(modelFrame?.rows).toHaveLength(modelRowLimit);
    expect(modelFrame?.rows?.[1]).toEqual([1]);
    expect(modelFrame?.truncated).toBe(true);
  });
});

describe('modelTestError', () => {
  const failure = new QueryError(
    'connector',
    'A value has the wrong type or format (SQLSTATE 22P02).',
    new ConnectorError(
      'syntax',
      'A value has the wrong type or format (SQLSTATE 22P02).',
      'invalid input syntax: "jane@example.com"',
    ),
  );

  test('gives only the safe message below level 4', () => {
    expect(modelTestError(subjectAt(3), failure)).toEqual({
      ok: false,
      error: 'A value has the wrong type or format (SQLSTATE 22P02).',
    });
  });

  test("gives the source's message at level 4", () => {
    expect(modelTestError(subjectAt(4), failure)).toEqual({
      ok: false,
      error: 'invalid input syntax: "jane@example.com"',
    });
  });

  test('says nothing about an unexpected error', () => {
    expect(modelTestError(subjectAt(4), new Error('stack details'))).toEqual({
      ok: false,
      error: 'The query failed.',
    });
  });
});

describe('modelPanelResult', () => {
  test('names the columns a chart draws from, without the hidden ones', () => {
    const result = modelPanelResult(subjectAt(2), [frame]);
    expect(result.ok && result.columns).toEqual([
      'time: time',
      'service: string',
      'series: string',
      'value: number',
    ]);
  });

  test('names no columns at level 1, or for an empty result', () => {
    expect(modelPanelResult(subjectAt(1), [frame])).toEqual({ ok: true });
    expect(modelPanelResult(subjectAt(2), [])).toEqual({ ok: true, frames: [] });
  });
});
