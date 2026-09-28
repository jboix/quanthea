import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { temporaryDir } from '../test/fixtures.ts';
import {
  createDashboardRepository,
  type DashboardRow,
  type VersionRow,
} from './dashboard-repository.ts';
import { openDatabase } from './database.ts';
import { runMigrations } from './migrate.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let database: Database;

beforeEach(() => {
  dataDir = temporaryDir();
  database = openDatabase(dataDir.path);
  runMigrations(database);
});

afterEach(() => {
  database.close();
  dataDir.remove();
});

const dashboard: DashboardRow = {
  id: '01K0000000000000000000000D',
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

const firstVersion: VersionRow = {
  id: '01K0000000000000000000000V',
  dashboardId: dashboard.id,
  version: 1,
  spec: { specVersion: 1, title: 'Checkout incident' },
  changeSummary: 'imported',
  pinnedAt: null,
  actor: 'admin-1',
  createdAt: 1000,
};

describe('dashboard repository', () => {
  test('creates a dashboard with its first version and reads them back', () => {
    const repository = createDashboardRepository(database);
    repository.create(dashboard, firstVersion);
    expect(repository.get(dashboard.id)).toEqual(dashboard);
    expect(repository.getVersion(dashboard.id, 1)).toEqual(firstVersion);
    const { spec: _spec, ...summary } = firstVersion;
    expect(repository.listVersions(dashboard.id)).toEqual([summary]);
    expect(repository.getVersion(dashboard.id, 2)).toBeUndefined();
  });

  test('pins a version once and records it on the dashboard', () => {
    const repository = createDashboardRepository(database);
    repository.create(dashboard, firstVersion);
    const change = {
      versionId: firstVersion.id,
      at: 2000,
      title: 'Pinned',
      description: 'd',
      tags: ['checkout'],
    };
    expect(repository.pin(dashboard.id, change)).toBe(true);
    expect(repository.get(dashboard.id)).toMatchObject({
      pinnedVersionId: firstVersion.id,
      title: 'Pinned',
      tags: ['checkout'],
      updatedAt: 2000,
    });
    expect(repository.getVersion(dashboard.id, 1)?.pinnedAt).toBe(2000);
    expect(repository.pin(dashboard.id, { ...change, at: 3000 })).toBe(false);
    expect(repository.pin('another', change)).toBe(false);
  });

  test('refuses to change or unpin a pinned version, whatever the code does', () => {
    const repository = createDashboardRepository(database);
    repository.create(dashboard, firstVersion);
    repository.pin(dashboard.id, {
      versionId: firstVersion.id,
      at: 2000,
      title: 't',
      description: null,
      tags: [],
    });
    const attempts = [
      "UPDATE dashboard_versions SET spec = '{}'",
      'UPDATE dashboard_versions SET version = 9',
      'UPDATE dashboard_versions SET pinned_at = NULL',
    ];
    for (const attempt of attempts) {
      expect(() => database.run(attempt)).toThrow('pinned dashboard versions are immutable');
    }
    database.run("UPDATE dashboard_versions SET change_summary = 'noted'");
    expect(repository.getVersion(dashboard.id, 1)?.spec).toEqual(firstVersion.spec);
  });

  test('deletes the versions with their dashboard', () => {
    const repository = createDashboardRepository(database);
    repository.create(dashboard, firstVersion);
    database.run('DELETE FROM dashboards');
    expect(repository.listVersions(dashboard.id)).toEqual([]);
  });
});
