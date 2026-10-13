import { describe, expect, test } from 'bun:test';
import { queryBuilders } from '@quanthea/shared';
import { z } from 'zod';
import { editRequestSchemaFor } from '../dashboards/panels/index.ts';
import { providerSchema, trimmed } from './tool-schema.ts';

/**
 * The edit tool's schema as a provider receives it, in a run about some query languages.
 *
 * @param languages - The languages of the connectors in use.
 * @returns The schema as JSON text.
 */
async function sentFor(languages: readonly string[]): Promise<string> {
  const builtIn = queryBuilders
    .filter((builder) => languages.includes(builder.language))
    .map((builder) => builder.id);
  const schema = providerSchema(editRequestSchemaFor({ builtIn, saved: [] }), languages);
  return JSON.stringify(await schema.jsonSchema);
}

describe('the tool schema providers receive', () => {
  test('has no bounds, defaults or ban on unknown fields, and keeps properties named so', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        maxItems: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 9 } },
        default: { type: 'string', minLength: 1, default: 'a' },
        list: { anyOf: [{ type: 'array', minItems: 1, items: { type: 'number' } }] },
        open: { type: 'object', additionalProperties: { type: 'string' } },
      },
    };
    expect(trimmed(schema)).toEqual({
      type: 'object',
      properties: {
        maxItems: { type: 'array', items: { type: 'string' } },
        default: { type: 'string' },
        list: { anyOf: [{ type: 'array', items: { type: 'number' } }] },
        open: { type: 'object', additionalProperties: { type: 'string' } },
      },
    });
  });

  test('offers the forms of the languages in use, and every form when none is', () => {
    const form = (language: string) => ({ properties: { language: { const: language } } });
    const schema = { oneOf: [form('sql'), form('promql'), form('search')] };
    expect(trimmed(schema, new Set(['sql', 'search']))).toEqual({
      oneOf: [form('sql'), form('search')],
    });
    expect(trimmed(schema, new Set(['logql']))).toEqual(schema);
    const mixed = { anyOf: [form('sql'), { type: 'string' }] };
    expect(trimmed(mixed, new Set(['promql']))).toEqual(mixed);
  });

  test('still checks the input against the whole schema, and fills its defaults', async () => {
    const schema = providerSchema(
      z.strictObject({ tags: z.array(z.string()).max(2), mode: z.string().default('all') }),
    );
    const sent = JSON.stringify(await schema.jsonSchema);
    for (const word of ['maxItems', 'default', 'additionalProperties'])
      expect(sent).not.toContain(word);
    expect(await schema.validate?.({ tags: ['a'] })).toEqual({
      success: true,
      value: { tags: ['a'], mode: 'all' },
    });
    expect((await schema.validate?.({ tags: ['a', 'b', 'c'] }))?.success).toBe(false);
    expect((await schema.validate?.({ tags: [], other: 1 }))?.success).toBe(false);
  });

  test('sends a run on two sources what it sent before a third was connected', async () => {
    const two = await sentFor(['promql', 'sql']);
    expect(two).not.toContain('search-series');
    expect(two).not.toContain('"const":"logql"');
    // Gemini took a forced call with the tool at about 19,000 characters and refused it at 26,000.
    expect(two.length).toBeLessThan(16_000);
    expect((await sentFor(['promql', 'sql', 'search'])).length).toBeLessThan(21_000);
  });
});
