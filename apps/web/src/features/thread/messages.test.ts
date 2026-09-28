import { describe, expect, test } from 'bun:test';
import { describeCall, readableText, shapeOf, type ToolPart } from './messages.ts';

/**
 * A finished tool part.
 *
 * @param name - The tool.
 * @param input - Its input.
 * @param output - Its output.
 * @returns The part.
 */
function done(name: string, input: unknown, output: unknown): ToolPart {
  return { type: `tool-${name}`, toolCallId: 'c', state: 'output-available', input, output };
}

describe('thread message helpers', () => {
  test('describe each explore call in a few words', () => {
    expect(
      describeCall(
        done(
          'describe',
          { connector: 'prom' },
          { ok: true, entities: [{ kind: 'metric' }, { kind: 'metric' }] },
        ),
      ),
    ).toEqual({
      call: 'describe(prom)',
      result: '2 metrics',
      failed: false,
    });
    expect(
      describeCall(
        done(
          'sample_values',
          { connector: 'prom', field: 'service' },
          { ok: true, values: ['a', 'b'] },
        ),
      ).result,
    ).toBe('4 values'.replace('4', '2'));
    expect(
      describeCall(
        done(
          'test_query',
          { connector: 'prom' },
          { ok: true, frames: [{ rowCount: 45 }, { rowCount: 45 }] },
        ),
      ).result,
    ).toBe('2 series · 90 points');
    expect(
      describeCall(
        done('test_query', { connector: 'pg' }, { ok: false, error: 'Unknown column.' }),
      ),
    ).toMatchObject({
      result: 'Unknown column.',
      failed: true,
    });
    expect(
      describeCall({
        type: 'tool-describe',
        toolCallId: 'c',
        state: 'input-available',
        input: { connector: 'pg' },
      }).result,
    ).toBe('…');
  });

  test('word result shapes', () => {
    expect(shapeOf([{ rowCount: 1 }])).toBe('1 row');
    expect(shapeOf([{ rowCount: 12 }])).toBe('12 rows');
    expect(shapeOf(undefined)).toBe('ok');
  });

  test('hide the reasoning some models write in thought tags', () => {
    expect(readableText('<thought>Let me check.</thought>Found checkout-svc.')).toBe(
      'Found checkout-svc.',
    );
    expect(readableText('Here is the plan. <thought>still thinking')).toBe('Here is the plan.');
    expect(readableText('<thought The services are known.\n\nI will check env.')).toBe(
      'I will check env.',
    );
  });
});
