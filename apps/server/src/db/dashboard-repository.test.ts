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

  test('pins a version and records it on the dashboard', () => {
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
    expect(repository.pin('another', change)).toBe(false);
  });

  test('refuses to change any version, or its first pin time, whatever the code does', () => {
    const repository = createDashboardRepository(database);
    repository.create(dashboard, firstVersion);
    const attempts = [
      "UPDATE dashboard_versions SET spec = '{}'",
      'UPDATE dashboard_versions SET version = 9',
      "UPDATE dashboard_versions SET id = 'other'",
      "UPDATE dashboard_versions SET change_summary = 'noted'",
      "UPDATE dashboard_versions SET actor = 'someone'",
      'UPDATE dashboard_versions SET created_at = 1',
    ];
    for (const attempt of attempts) {
      expect(() => database.run(attempt)).toThrow('dashboard versions are immutable');
    }
    const change = {
      versionId: firstVersion.id,
      at: 2000,
      title: 't',
      description: null,
      tags: [],
    };
    repository.pin(dashboard.id, change);
    expect(() => database.run('UPDATE dashboard_versions SET pinned_at = NULL')).toThrow(
      'a version keeps the time it was first pinned',
    );
    expect(repository.getVersion(dashboard.id, 1)).toMatchObject({
      spec: firstVersion.spec,
      pinnedAt: 2000,
    });
  });

  test('pins a version again after unpinning, keeping its first pin time', () => {
    const repository = createDashboardRepository(database);
    repository.create(dashboard, firstVersion);
    const change = {
      versionId: firstVersion.id,
      at: 2000,
      title: 't',
      description: null,
      tags: [],
    };
    expect(repository.pin(dashboard.id, change)).toBe(true);
    expect(repository.unpin(dashboard.id, 3000)).toBe(true);
    expect(repository.unpin(dashboard.id, 3000)).toBe(false);
    expect(repository.get(dashboard.id)?.pinnedVersionId).toBeNull();
    expect(repository.pin(dashboard.id, { ...change, at: 4000 })).toBe(true);
    expect(repository.get(dashboard.id)?.pinnedVersionId).toBe(firstVersion.id);
    expect(repository.getVersion(dashboard.id, 1)?.pinnedAt).toBe(2000);
  });

  test('adds versions after the latest one and touches the dashboard', () => {
    const repository = createDashboardRepository(database);
    repository.create(dashboard, firstVersion);
    const { version: _version, ...next } = {
      ...firstVersion,
      id: '01K0000000000000000000000W',
      createdAt: 5000,
    };
    expect(repository.addVersion(next)).toBe(2);
    expect(repository.addVersion({ ...next, id: '01K0000000000000000000000X' })).toBe(3);
    expect(repository.listVersions(dashboard.id).map((version) => version.version)).toEqual([
      1, 2, 3,
    ]);
    expect(repository.get(dashboard.id)?.updatedAt).toBe(5000);
  });

  test('deletes the versions with their dashboard', () => {
    const repository = createDashboardRepository(database);
    repository.create(dashboard, firstVersion);
    database.run('DELETE FROM dashboards');
    expect(repository.listVersions(dashboard.id)).toEqual([]);
  });
});
