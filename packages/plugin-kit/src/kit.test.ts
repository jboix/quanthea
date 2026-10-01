import { expect, test } from 'bun:test';
import { kitVersion } from './kit.ts';

test('the major version is the kit version', async () => {
  const manifest = await Bun.file(new URL('../package.json', import.meta.url)).json();
  expect(Number(String(manifest.version).split('.')[0])).toBe(kitVersion);
});
