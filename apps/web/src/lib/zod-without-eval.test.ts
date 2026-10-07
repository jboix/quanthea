import { describe, expect, test } from 'bun:test';

describe('zod-without-eval', () => {
  test('is the first module main.tsx imports, so no schema is built before the flag', async () => {
    // dependency-cruiser cannot check import order, so this test holds the rule.
    const main = await Bun.file(new URL('../main.tsx', import.meta.url)).text();
    const firstImport = main.match(/^import\s+[^;]*?['"]([^'"]+)['"];/m);
    expect(firstImport?.[1]).toBe('./lib/zod-without-eval.ts');
  });
});
