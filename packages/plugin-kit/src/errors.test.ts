import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectorError } from './errors.ts';

/** A folder for a second, bundled copy of the class, as a plugin would carry it. */
const folder = mkdtempSync(join(tmpdir(), 'querent-errors-'));

afterAll(() => rmSync(folder, { recursive: true, force: true }));

/**
 * Bundles the error module into a file of its own and imports it: another copy of the class.
 *
 * @returns The other class.
 */
async function secondCopy(): Promise<typeof ConnectorError> {
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, 'errors.ts')],
    outdir: folder,
    target: 'bun',
  });
  const [output] = built.outputs;
  if (!output) throw new Error('Nothing was bundled.');
  const module = (await import(output.path)) as { ConnectorError: typeof ConnectorError };
  return module.ConnectorError;
}

describe('ConnectorError', () => {
  test('recognises an error from another copy of the class, by its brand', async () => {
    const Copy = await secondCopy();
    expect(Copy).not.toBe(ConnectorError);
    const error = new Copy('timeout', 'The query ran too long.');
    expect(error).toBeInstanceOf(ConnectorError);
    expect(new ConnectorError('internal', 'x')).toBeInstanceOf(Copy);
  });

  test('refuses what only looks like one', () => {
    const brand = Symbol.for('quanthea.connector-error');
    expect(new Error('x') instanceof ConnectorError).toBe(false);
    expect({ code: 'timeout', safeMessage: 'x' } instanceof ConnectorError).toBe(false);
    expect({ [brand]: true, code: 'nope', safeMessage: 'x' } instanceof ConnectorError).toBe(false);
    expect({ [brand]: true, code: 'timeout' } instanceof ConnectorError).toBe(false);
    expect({ [brand]: true, code: 'timeout', safeMessage: 'x' } instanceof ConnectorError).toBe(
      true,
    );
  });
});
