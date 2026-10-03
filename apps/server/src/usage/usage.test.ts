import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openDatabase } from '../db/database.ts';
import { runMigrations } from '../db/migrate.ts';
import { createUsageRepository } from '../db/usage-repository.ts';
import { temporaryDir } from '../test/fixtures.ts';
import { createUsage } from './usage.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: ReturnType<typeof openDatabase>;
let now = Date.parse('2026-09-29T10:15:00Z');

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * The usage service over the test database, on a clock the test moves.
 *
 * @returns The service.
 */
function usage() {
  return createUsage({ repository: createUsageRepository(database), now: () => now });
}

const tokens = { input: 1_000_000, cachedInput: 0, cacheWrite: 0, output: 100_000 };

describe('the usage ledger', () => {
  test('adds steps up by hour and model, priced when they happened', () => {
    const ledger = usage();
    ledger.recordStep({
      threadId: 't1',
      provider: 'mistral',
      model: 'mistral-large-latest',
      job: 'build',
      tokens,
    });
    now += 60_000;
    ledger.recordStep({
      threadId: 't1',
      provider: 'mistral',
      model: 'mistral-large-latest',
      job: 'build',
      tokens,
    });
    ledger.recordStep({
      threadId: 't2',
      provider: 'openai-compatible',
      model: 'gemma-4',
      job: 'plan',
      tokens,
    });
    const report = ledger.report(1);
    expect(report.buckets).toEqual([
      expect.objectContaining({
        hour: Date.parse('2026-09-29T10:00:00Z'),
        model: 'mistral-large-latest',
        input: 2_000_000,
        output: 200_000,
        events: 2,
        dollars: 1.3,
        unpriced: 0,
      }),
      expect.objectContaining({ model: 'gemma-4', events: 1, dollars: 0, unpriced: 1 }),
    ]);
  });

  test('counts pinned views, which spend nothing, and sums the month', () => {
    const ledger = usage();
    ledger.recordPinnedView('d1');
    ledger.recordPinnedView('d1');
    ledger.recordStep({
      threadId: 't1',
      provider: 'mistral',
      model: 'mistral-small-latest',
      job: 'plan',
      tokens,
    });
    expect(ledger.month()).toEqual({
      tokens: 1_100_000,
      threads: 1,
      pinnedViews: 2,
      dollars: 0.21,
    });
  });

  test('counts snapshot views apart from pinned views, with no tokens', () => {
    const ledger = usage();
    ledger.recordSnapshotView('d1');
    ledger.recordPinnedView('d1');
    const kinds = ledger
      .report(1)
      .buckets.map((bucket) => [bucket.kind, bucket.events, bucket.input]);
    expect(kinds).toEqual([
      ['pinned_view', 1, 0],
      ['snapshot_view', 1, 0],
    ]);
    expect(ledger.month().pinnedViews).toBe(1);
  });

  test('keeps only the days asked for', () => {
    const ledger = usage();
    ledger.recordPinnedView('old');
    now += 3 * 86_400_000;
    expect(ledger.report(2).buckets).toEqual([]);
    expect(ledger.report(4).buckets).toHaveLength(1);
  });

  test('names the owner of the thread each step ran in, and keeps it after the thread goes', () => {
    database.run(
      "INSERT INTO threads (id, created_by, created_at, updated_at) VALUES ('t9', 'ada', 1, 1)",
    );
    const ledger = usage();
    const step = { provider: 'mistral', model: 'mistral-large-latest', job: 'build', tokens };
    ledger.recordStep({ ...step, threadId: 't9' });
    ledger.recordStep({ ...step, threadId: null });
    database.run("DELETE FROM threads WHERE id = 't9'");
    const users = ledger
      .report(1)
      .buckets.map((bucket) => bucket.userId)
      .sort();
    expect(users).toEqual(['', 'ada']);
  });

  test('names who a step outside a thread ran for, and the dashboard it was about', () => {
    const ledger = usage();
    const step = { provider: 'mistral', model: 'mistral-large-latest', job: 'answer', tokens };
    ledger.recordStep({ ...step, threadId: null, userId: 'grace', dashboardId: 'd1' });
    expect(ledger.report(1).buckets.map((bucket) => bucket.userId)).toEqual(['grace']);
    const row = database
      .query<{ job: string; dashboard_id: string }, []>(
        'SELECT job, dashboard_id FROM usage_events',
      )
      .get();
    expect(row).toEqual({ job: 'answer', dashboard_id: 'd1' });
  });
});
