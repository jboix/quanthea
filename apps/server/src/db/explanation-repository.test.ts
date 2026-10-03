import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import { createDashboardRepository } from './dashboard-repository.ts';
import { openDatabase } from './database.ts';
import { createExplanationRepository, type ExplanationRow } from './explanation-repository.ts';
import { runMigrations } from './migrate.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

const dashboardId = '01K0000000000000000000000D';

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
  const dashboard = {
    id: dashboardId,
    title: 'Checkout incident',
    description: null,
    tags: [],
    parentDashboardId: null,
    parentVersion: null,
    pinnedVersionId: null,
    deletedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
  const version = {
    id: '01K0000000000000000000000V',
    dashboardId,
    version: 1,
    spec: { specVersion: 1, title: 'Checkout incident' },
    changeSummary: 'imported',
    pinnedAt: null,
    actor: 'admin-1',
    createdAt: 1000,
  };
  createDashboardRepository(database).create(dashboard, version);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

/**
 * An explanation of a panel of the dashboard.
 *
 * @param id - Its id.
 * @param panelId - The panel.
 * @param explainedAt - When it was written.
 * @param version - The version.
 * @returns The row.
 */
function explanationRow(
  id: string,
  panelId: string,
  explainedAt: number,
  version = 1,
): ExplanationRow {
  return {
    id,
    dashboardId,
    version,
    panelId,
    explainedBy: 'analyst-1',
    explainedAt,
    text: `Explanation ${id}.`,
    usage: { 'claude-sonnet-5': { input: 20, cachedInput: 0, cacheWrite: 0, output: 10 } },
    tokens: 30,
  };
}

/** The panel `errors` of version 1. */
const errorsPanel = { dashboardId, version: 1, panelId: 'errors' };

describe('explanation repository', () => {
  test('keeps one explanation per version and panel, the latest shown', () => {
    const repository = createExplanationRepository(database);
    expect(repository.latest(errorsPanel)).toBeUndefined();
    const first = explanationRow('e1', 'errors', 3000);
    repository.insert(first);
    expect(repository.latest(errorsPanel)).toEqual(first);
    repository.insert(explanationRow('e2', 'errors', 4000));
    repository.insert(explanationRow('e3', 'latency', 5000));
    repository.insert(explanationRow('e4', 'errors', 6000, 2));
    expect(repository.latest(errorsPanel)?.id).toBe('e2');
    expect(repository.latest({ ...errorsPanel, panelId: 'latency' })?.id).toBe('e3');
    expect(repository.latest({ ...errorsPanel, version: 2 })?.id).toBe('e4');
  });

  test('keeps the older ones and never rewrites one', () => {
    const repository = createExplanationRepository(database);
    repository.insert(explanationRow('e1', 'errors', 3000));
    repository.insert(explanationRow('e2', 'errors', 4000));
    const count = database.query<{ count: number }, []>(
      'SELECT count(*) AS count FROM panel_explanations',
    );
    expect(count.get()?.count).toBe(2);
    expect(() => database.run("UPDATE panel_explanations SET text = 'x' WHERE id = 'e1'")).toThrow(
      'never rewritten',
    );
  });

  test('goes with its dashboard', () => {
    const repository = createExplanationRepository(database);
    repository.insert(explanationRow('e1', 'errors', 3000));
    database.run('DELETE FROM dashboards');
    expect(repository.latest(errorsPanel)).toBeUndefined();
  });
});
