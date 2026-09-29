import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema } from '@querent/shared';
import type { AppError } from '../lib/errors.ts';
import { temporaryDir, testServices } from '../test/fixtures.ts';
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
 * Awaits a call and returns the AppError it failed with.
 *
 * @param call - The call.
 * @returns The error.
 */
async function failureOf(call: () => unknown): Promise<AppError> {
  try {
    await call();
  } catch (error) {
    return error as AppError;
  }
  throw new Error('Expected the call to fail.');
}

/**
 * Creates the events dashboard and pins its first version.
 *
 * @returns The dashboard id.
 */
async function pinnedEvents(): Promise<string> {
  const { id } = services.dashboards.create(eventsSpec(), 'imported', 'editor-1');
  await services.dashboards.pin(id, 1, 'editor-1');
  return id;
}

describe('dashboards', () => {
  test('creates a draft that editors see and viewers do not', async () => {
    const created = services.dashboards.create(eventsSpec(), 'imported', 'editor-1');
    expect(created).toMatchObject({
      title: 'Events',
      description: 'Errors by service.',
      pinnedVersion: null,
    });
    expect(created.versions).toMatchObject([
      { version: 1, changeSummary: 'imported', pinnedAt: null },
    ]);
    expect((await failureOf(() => services.dashboards.get(created.id, 'viewer'))).code).toBe(
      'not_found',
    );
    expect(services.dashboards.getVersion(created.id, 1, 'editor').spec.title).toBe('Events');
    expect(
      (await failureOf(() => services.dashboards.getVersion(created.id, 1, 'viewer'))).code,
    ).toBe('not_found');
  });

  test('refuses an invalid spec with its issues', async () => {
    const spec = eventsSpec();
    spec.panels[0]?.queries.splice(0, 1, {
      refId: 'A',
      connector: 'nowhere',
      language: 'sql',
      sql: 'SELECT 1',
    });
    const failure = await failureOf(() => services.dashboards.create(spec, undefined, 'editor-1'));
    expect(failure).toMatchObject({ code: 'bad_request', message: 'The spec is invalid.' });
    expect(failure.details).toEqual([
      {
        part: 'spec',
        path: 'panels[0].queries[0].connector',
        message: 'No connector is named "nowhere".',
      },
    ]);
  });

  test('pins a version once, after running every panel, and shows it to viewers', async () => {
    const id = await pinnedEvents();
    const detail = services.dashboards.get(id, 'viewer');
    expect(detail.pinnedVersion).toBe(1);
    expect(detail.versions).toHaveLength(1);
    expect(services.dashboards.getVersion(id, 1, 'viewer').pinnedAt).not.toBeNull();
    expect((await failureOf(() => services.dashboards.pin(id, 1, 'editor-1'))).message).toBe(
      'Version 1 is already the one shown.',
    );
  });

  test('pins a later version, then an earlier one again, to roll back', async () => {
    const id = await pinnedEvents();
    services.dashboards.addVersion(id, { ...eventsSpec(), title: 'Events v2' }, 'v2', 'editor-1');
    expect(services.dashboards.get(id, 'viewer').versions.map((each) => each.version)).toEqual([1]);
    await services.dashboards.pin(id, 2, 'editor-1');
    expect(services.dashboards.get(id, 'viewer')).toMatchObject({
      pinnedVersion: 2,
      title: 'Events v2',
    });
    await services.dashboards.pin(id, 1, 'editor-1');
    expect(services.dashboards.get(id, 'viewer')).toMatchObject({
      pinnedVersion: 1,
      title: 'Events',
    });
  });

  test('unpins: viewers can no longer open it, editors still can', async () => {
    const id = await pinnedEvents();
    expect(services.dashboards.unpin(id, 'editor-1').pinnedVersion).toBeNull();
    expect((await failureOf(() => services.dashboards.get(id, 'viewer'))).code).toBe('not_found');
    expect((await failureOf(() => services.dashboards.getVersion(id, 1, 'viewer'))).code).toBe(
      'not_found',
    );
    expect(services.dashboards.get(id, 'editor').versions).toHaveLength(1);
    expect((await failureOf(() => services.dashboards.unpin(id, 'editor-1'))).message).toBe(
      'The dashboard is not pinned.',
    );
  });

  test('refuses to pin a version whose panels fail', async () => {
    const spec = eventsSpec();
    Object.assign(spec.panels[1]?.queries[0] ?? {}, { sql: 'SELECT * FROM missing' });
    const { id } = services.dashboards.create(spec, undefined, 'editor-1');
    const failure = await failureOf(() => services.dashboards.pin(id, 1, 'editor-1'));
    expect(failure.message).toBe('Some panels fail. Fix them before pinning.');
    expect(failure.details).toEqual([
      { part: 'spec', path: 'panels[1].queries[0]', message: 'Unknown query.' },
    ]);
  });
});

describe('running panels', () => {
  test('returns the frames of each query and the markers of the chart', async () => {
    const id = await pinnedEvents();
    const run = await services.dashboards.runPanel(
      { dashboardId: id, version: 1, variables: {} },
      'errors-over-time',
      'viewer',
    );
    expect(run.queries).toMatchObject([{ refId: 'A', error: null }]);
    expect(run.queries[0]?.frames[0]?.meta.rowCount).toBe(5);
    expect(run.markers).toMatchObject([{ annotation: 'events', label: 'event', error: null }]);
    expect(run.markers[0]?.points.map((point) => point.text)).toEqual([
      'checkout-svc',
      'payments-svc',
      'cart-svc',
      'checkout-svc',
      'payments-svc',
    ]);
    expect(run.time.to - run.time.from).toBe(3_600_000);
  });

  test('checks the choices against the declarations', async () => {
    const id = await pinnedEvents();
    const target = (
      variables: Record<string, string | string[]>,
      time?: { from: string; to: string },
    ) =>
      services.dashboards.runPanel(
        { dashboardId: id, version: 1, variables, time },
        'errors-peak',
        'viewer',
      );
    expect((await failureOf(() => target({ env: 'dev' }))).message).toBe(
      '$env has no option "dev".',
    );
    expect((await failureOf(() => target({ env: ['prod', 'staging'] }))).message).toBe(
      '$env takes one value.',
    );
    expect((await failureOf(() => target({ order: 'x' }))).message).toBe(
      '$order does not match its pattern.',
    );
    expect((await failureOf(() => target({}, { from: 'now', to: 'now-1h' }))).message).toBe(
      'The time range ends before it starts.',
    );
    expect((await target({ service: ['cart-svc'], ignored: 'x' })).queries[0]?.error).toBeNull();
  });

  test('lists the options of a query-backed variable', async () => {
    const id = await pinnedEvents();
    const options = await services.dashboards.variableOptions(
      { dashboardId: id, version: 1, variables: {} },
      'service',
      'viewer',
    );
    expect(options).toEqual(['checkout-svc', 'payments-svc', 'cart-svc']);
    expect(
      (
        await failureOf(() =>
          services.dashboards.variableOptions(
            { dashboardId: id, version: 1, variables: {} },
            'env',
            'viewer',
          ),
        )
      ).code,
    ).toBe('not_found');
  });

  test('reports a failing query in its outcome without failing the panel', async () => {
    const spec = eventsSpec();
    spec.panels[0]?.queries.push({
      refId: 'B',
      connector: 'events',
      language: 'sql',
      sql: 'SELECT * FROM missing',
    });
    const { id } = services.dashboards.create(spec, undefined, 'editor-1');
    const run = await services.dashboards.runPanel(
      { dashboardId: id, version: 1, variables: {} },
      'errors-peak',
      'editor',
    );
    expect(run.queries.map((outcome) => [outcome.refId, outcome.error])).toEqual([
      ['A', null],
      ['B', { code: 'connector', message: 'Unknown query.' }],
    ]);
  });

  test('keeps drafts from viewers and unknown panels out', async () => {
    const { id } = services.dashboards.create(eventsSpec(), undefined, 'editor-1');
    const target = { dashboardId: id, version: 1, variables: {} };
    expect(
      (await failureOf(() => services.dashboards.runPanel(target, 'errors-peak', 'viewer'))).code,
    ).toBe('not_found');
    expect(
      (await failureOf(() => services.dashboards.runPanel(target, 'nope', 'editor'))).message,
    ).toBe('No panel "nope" in this version.');
  });
});

describe('versions', () => {
  test('adds versions and restores an older one as a new version', () => {
    const { id } = services.dashboards.create(eventsSpec(), 'v1', 'editor-1');
    const changed = { ...eventsSpec(), title: 'Events, renamed' };
    expect(services.dashboards.addVersion(id, changed, 'renamed', 'agent')).toBe(2);
    expect(services.dashboards.restore(id, 1, 'editor-1')).toBe(3);
    const versions = services.dashboards.get(id, 'editor').versions;
    expect(versions.map((version) => [version.version, version.changeSummary])).toEqual([
      [1, 'v1'],
      [2, 'renamed'],
      [3, 'restored v1'],
    ]);
    expect(services.dashboards.getVersion(id, 3, 'editor').spec.title).toBe('Events');
  });

  test('refuses an invalid version and an unknown dashboard', async () => {
    const { id } = services.dashboards.create(eventsSpec(), undefined, 'editor-1');
    expect(
      (await failureOf(() => services.dashboards.addVersion(id, { title: 'x' }, 'x', 'agent')))
        .code,
    ).toBe('bad_request');
    expect(
      (await failureOf(() => services.dashboards.addVersion('nope', eventsSpec(), 'x', 'agent')))
        .code,
    ).toBe('not_found');
  });

  test('checks and test-runs a spec without saving it', async () => {
    const checked = services.dashboards.check(eventsSpec());
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    const tests = await services.dashboards.testRun(checked.spec);
    expect(tests.map((each) => [each.panelId, each.run.queries[0]?.error])).toEqual([
      ['errors-peak', null],
      ['errors-over-time', null],
    ]);
  });
});
