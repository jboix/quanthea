import { describe, expect, test } from 'bun:test';
import { testConnectorConformance } from '@querent/plugin-kit/testing';
import { answerError, redactLiterals } from './api.ts';
import { lokiConnector } from './loki-connector.ts';
import { streamsFrame } from './streams.ts';

testConnectorConformance(lokiConnector, {
  config: { url: 'http://loki:3100' },
  secret: {},
  query: { language: 'logql', expr: '{app="x"}', instant: false, stepSeconds: 60 },
  invalidQuery: { language: 'logql', expr: '{app="x"', instant: false, stepSeconds: 60 },
  sampleField: { entity: 'logs', field: 'app' },
  timeRange: { from: new Date(0), to: new Date(1000) },
  live: false,
});

const context = {
  refId: 'A',
  signal: AbortSignal.timeout(1000),
  timeoutMs: 1000,
  maxRows: 100,
  timeRange: { from: new Date(0), to: new Date(1000) },
};

describe('loki lines', () => {
  test('merge streams into one table, newest first, with a column per label', () => {
    const frame = streamsFrame(
      [
        { stream: { app: 'a', __stream_shard__: '1' }, values: [['1000000000', 'one']] },
        {
          stream: { app: 'b', level: 'error' },
          values: [
            ['3000000000', 'three'],
            ['2000000000', 'two'],
          ],
        },
      ],
      context,
      5,
      false,
    );
    expect(frame.fields.map((field) => field.name)).toEqual(['time', 'line', 'app', 'level']);
    expect(frame.values).toEqual([
      [3000, 2000, 1000],
      ['three', 'two', 'one'],
      ['b', 'b', 'a'],
      ['error', 'error', null],
    ]);
  });

  test('mark the table truncated when Loki returned all it was allowed to', () => {
    const frame = streamsFrame([{ stream: {}, values: [['1', 'x']] }], context, 5, true);
    expect(frame.meta.truncated).toBe(true);
  });
});

describe('loki errors', () => {
  test('keep the structure of a parse error and drop its literals', () => {
    const error = answerError(400, 'parse error at line 1, col 18: unexpected "secret"');
    expect(error).toMatchObject({ code: 'syntax' });
    expect(error.safeMessage).toBe('Loki: parse error at line 1, col 18: unexpected "…"');
    expect(error.message).toContain('secret');
    expect(redactLiterals("a 'b' `c`")).toBe('a "…" "…"');
  });

  test('tell limits, timeouts and refused credentials apart', () => {
    expect(answerError(400, 'max entries limit per query exceeded')).toMatchObject({
      code: 'rejected',
    });
    expect(answerError(504, 'context deadline exceeded')).toMatchObject({ code: 'timeout' });
    expect(answerError(401, 'no org id')).toMatchObject({ code: 'authentication' });
    expect(answerError(500, 'boom')).toMatchObject({ code: 'internal' });
  });
});
