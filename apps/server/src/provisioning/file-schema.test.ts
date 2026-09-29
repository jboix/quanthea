import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { configJsonSchema } from './file-schema.ts';

describe('the configuration file schema', () => {
  test('is published up to date in docs/configuration.schema.json (bun run config:schema)', () => {
    const path = resolve(import.meta.dir, '../../../../docs/configuration.schema.json');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(configJsonSchema());
  });

  test('asks for references, never secrets', () => {
    const text = JSON.stringify(configJsonSchema());
    expect(text).toContain('file:');
    const connectors = configJsonSchema().properties as Record<
      string,
      { additionalProperties: unknown }
    >;
    expect(JSON.stringify(connectors.connectors?.additionalProperties)).toContain('"pattern"');
  });
});
