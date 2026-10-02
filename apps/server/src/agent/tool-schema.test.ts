import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { providerSchema, withoutItemBounds } from './tool-schema.ts';

describe('the tool schema providers receive', () => {
  test('has no array bounds, and keeps properties named like them', () => {
    const schema = {
      type: 'object',
      properties: {
        maxItems: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 9 } },
        list: { anyOf: [{ type: 'array', minItems: 1, items: { type: 'number' } }] },
      },
    };
    expect(withoutItemBounds(schema)).toEqual({
      type: 'object',
      properties: {
        maxItems: { type: 'array', items: { type: 'string', maxLength: 9 } },
        list: { anyOf: [{ type: 'array', items: { type: 'number' } }] },
      },
    });
  });

  test('still checks the input against the whole schema', async () => {
    const schema = providerSchema(z.object({ tags: z.array(z.string()).max(2) }));
    expect(JSON.stringify(await schema.jsonSchema)).not.toContain('maxItems');
    expect((await schema.validate?.({ tags: ['a'] }))?.success).toBe(true);
    expect((await schema.validate?.({ tags: ['a', 'b', 'c'] }))?.success).toBe(false);
  });
});
