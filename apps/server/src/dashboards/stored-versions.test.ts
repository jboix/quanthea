import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, type DashboardSpec } from '@quanthea/shared';
import { createDashboardRepository } from '../db/dashboard-repository.ts';
import type { AppError } from '../lib/errors.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { newRows } from './rows.ts';
import { eventsSpec } from './test/events-spec.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: { rowCount: 5 }, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * The events spec with a variable whose source reads a variable declared after it, and a default,
 * so the dashboard draws without the source ever running.
 *
 * @returns The spec, as a dashboard saved it before the order of variables was checked.
 */
function outOfOrderSpec() {
  const spec = eventsSpec();
  const sql = 'SELECT * FROM events WHERE service = :order';
  const source = { connector: 'events', language: 'sql' as const, sql };
  spec.variables.unshift({ kind: 'query', name: 'pod', source, default: 'pod-1' } as never);
  return spec;
}

/**
 * Stores a spec as the first version of a new dashboard, as an earlier release wrote it: without
 * today's checks.
 *
 * @param spec - The spec.
 * @returns The dashboard id.
 */
function stored(spec: unknown): string {
  const { dashboard, version } = newRows(spec as DashboardSpec, 'imported', 'editor-1', 1);
  createDashboardRepository(services.database).create(dashboard, version);
  return dashboard.id;
}

/**
 * The AppError a call fails with.
 *
 * @param call - The call.
 * @returns The error.
 */
function failureOf(call: () => unknown): AppError {
  try {
    call();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('Expected the call to fail.');
}

describe('a stored version whose variable reads a later one', () => {
  test('still pins, restores and copies', async () => {
    const id = stored(outOfOrderSpec());
    expect((await services.dashboards.pin(id, 1, 'editor-1')).pinnedVersion).toBe(1);
    expect(services.dashboards.restore(id, 1, 'editor-1')).toBe(2);
    expect((await services.dashboards.pin(id, 2, 'editor-1')).pinnedVersion).toBe(2);
    const copy = services.dashboards.copyVersion(id, 1, 'editor-1');
    expect(services.dashboards.getVersion(copy.dashboardId, 1, 'editor').spec.variables).toEqual(
      services.dashboards.getVersion(id, 1, 'editor').spec.variables,
    );
  });

  test('is refused when it is written anew, by a person or by the agent', () => {
    const message =
      'The source of "pod" uses "order", which is declared after it. A source may use only the variables declared before it. Declare "order" before "pod".';
    const path = 'variables[0].source.sql';
    const details = [{ part: 'spec', path, message }];
    const created = failureOf(() => services.dashboards.create(outOfOrderSpec(), 'x', 'editor-1'));
    expect(created.details).toEqual(details);
    const id = stored(outOfOrderSpec());
    const added = failureOf(() =>
      services.dashboards.addVersion(id, outOfOrderSpec(), 'again', 'editor-1'),
    );
    expect(added.details).toEqual(details);
    const checked = services.dashboards.check(outOfOrderSpec());
    expect(checked.ok ? [] : checked.issues).toEqual([{ path, message }]);
  });
});
