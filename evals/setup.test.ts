import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type EvalWorld,
  openWorld,
  searchConnector,
  type WorldOptions,
  waitForEvents,
  worldConnectors,
} from './setup.ts';

/** The world and the cache directory a test opened, closed after it. */
const opened: { world?: EvalWorld; dir?: string } = {};

afterEach(async () => {
  await opened.world?.close();
  if (opened.dir) rmSync(opened.dir, { recursive: true, force: true });
  delete opened.world;
  delete opened.dir;
});

/**
 * Opens a world without a key, on a cache of its own, and lists its connectors.
 *
 * @param options - What the run adds, if anything.
 * @returns The connectors' names and kinds.
 */
async function connectorsOf(options?: WorldOptions): Promise<string[]> {
  opened.dir = mkdtempSync(join(tmpdir(), 'quanthea-evals-cache-'));
  const cache = { dir: opened.dir, read: true, minIntervalMs: 0 };
  opened.world = await openWorld({ model: 'gemini-3.5-flash-lite' }, undefined, cache, options);
  return opened.world.services.connections
    .list()
    .map((connector) => `${connector.name} (${connector.kind})`)
    .sort();
}

describe('the connectors of the eval world', () => {
  test('are the dev Postgres and Prometheus when nothing is asked', async () => {
    const expected = ['postgres-orders (postgres)', 'prometheus-dev (prometheus)'];
    expect(await connectorsOf()).toEqual(expected);
    expect(worldConnectors().map((connector) => connector.name)).not.toContain(searchConnector);
  });

  test('stay the same when the search connector is declined', async () => {
    expect(worldConnectors({ search: false })).toEqual(worldConnectors());
    expect(await connectorsOf({ search: false })).toHaveLength(2);
  });

  test('gain the dev OpenSearch, last, when asked', async () => {
    expect(await connectorsOf({ search: true })).toEqual([
      `${searchConnector} (opensearch)`,
      'postgres-orders (postgres)',
      'prometheus-dev (prometheus)',
    ]);
    const [postgres, prometheus, search] = worldConnectors({ search: true });
    expect([postgres, prometheus]).toEqual(worldConnectors());
    expect(search).toMatchObject({ kind: 'opensearch', config: { auth: 'none' } });
  });
});

describe('waiting for the player events', () => {
  test('ends once the index holds an event of today', async () => {
    const counts = [0, 0, 3];
    await waitForEvents(async () => counts.shift() ?? 3, 5000);
    expect(counts).toEqual([]);
  });

  test('keeps waiting while the server does not answer', async () => {
    let calls = 0;
    const count = async () => {
      calls += 1;
      if (calls === 1) throw new Error('connection refused');
      return 1;
    };
    await waitForEvents(count, 5000);
    expect(calls).toBe(2);
  });

  test('fails with what to run when no event shows in time', async () => {
    const waiting = waitForEvents(async () => 0, 20);
    await expect(waiting).rejects.toThrow('Run bun run env:up:search.');
  });
});
