/**
 * The checkout incident fixture against the dev sources, with no model configured anywhere: the
 * dashboard pins, and every panel runs from its saved spec alone.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { connectorInputSchema, type PanelRun, panelRunSchema } from '@querent/shared';
import { createApp } from '../app.ts';
import {
  devIncidentStart,
  devPostgres,
  devPrometheus,
  integrationEnabled,
} from '../connectors/_shared/test/dev-sources.ts';
import { connectorKinds } from '../connectors/registry.ts';
import { captureLogs, fixedAuthenticator, temporaryDir, testServices } from '../test/fixtures.ts';

/** The fixture the dev seed pins, read from the dev workspace. */
const fixturePath = new URL('../../../../dev/seed/checkout-incident.json', import.meta.url);

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let dashboardId = '';

/**
 * The fixture, with its time range around the incident.
 *
 * @returns The spec as JSON.
 */
function incidentSpec(): unknown {
  const start = devIncidentStart().getTime();
  const spec = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
  const time = {
    from: new Date(start - 30 * 60_000).toISOString(),
    to: new Date(start + 90 * 60_000).toISOString(),
  };
  return { ...spec, time };
}

/**
 * Runs one panel of the pinned fixture as a viewer.
 *
 * @param panelId - The panel.
 * @returns The run.
 */
function run(panelId: string): Promise<PanelRun> {
  return services.dashboards.runPanel(
    { dashboardId, version: 1, variables: {} },
    panelId,
    'viewer',
  );
}

describe.skipIf(!integrationEnabled)('the checkout incident fixture, with no model', () => {
  beforeAll(async () => {
    dataDir = temporaryDir();
    services = await testServices(dataDir.path, connectorKinds);
    const inputs = [
      { name: 'postgres-orders', kind: 'postgres', ...devPostgres },
      { name: 'prometheus-dev', kind: 'prometheus', ...devPrometheus },
    ];
    for (const input of inputs)
      await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
    ({ id: dashboardId } = services.dashboards.create(incidentSpec(), 'seeded', 'editor-1'));
    await services.dashboards.pin(dashboardId, 1, 'editor-1');
  });

  afterAll(async () => {
    await services.close();
    dataDir.remove();
  });

  test('pins: every panel passed its test run', () => {
    expect(services.dashboards.get(dashboardId, 'viewer').pinnedVersion).toBe(1);
  });

  test('every panel returns rows for a viewer', async () => {
    const spec = services.dashboards.getVersion(dashboardId, 1, 'viewer').spec;
    const runs = await Promise.all(spec.panels.map((panel) => run(panel.id)));
    for (const [index, panelRun] of runs.entries()) {
      const rows = panelRun.queries.flatMap((query) =>
        query.frames.map((frame) => frame.meta.rowCount),
      );
      expect({
        panel: spec.panels[index]?.id,
        errors: panelRun.queries.map((query) => query.error),
      }).toEqual({
        panel: spec.panels[index]?.id,
        errors: panelRun.queries.map(() => null),
      });
      expect(rows.some((count) => count > 0)).toBe(true);
    }
  });

  test('shows the incident: an 8.4% peak error rate, and deploy #481 marked on the chart', async () => {
    const peak = await run('error-rate-peak');
    const values = peak.queries[0]?.frames[0]?.values[1] as number[];
    expect(Math.max(...values)).toBeCloseTo(0.084, 2);
    const chart = await run('error-rate-by-service');
    expect(chart.queries[0]?.frames.length).toBe(2);
    expect(chart.markers[0]?.points.map((point) => point.text)).toContain('deploy #481');
  });

  test('runs through the real HTTP app for a viewer, the way the browser asks', async () => {
    const viewer = { id: 'viewer-1', name: 'Vera', role: 'viewer' as const };
    const app = createApp({
      version: 'test',
      authenticator: fixedAuthenticator(viewer),
      logger: captureLogs().logger,
      webDir: dataDir.path,
      connections: services.connections,
      dashboards: services.dashboards,
    });
    const response = await app.request('/api/panels/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'querent' },
      body: JSON.stringify({
        dashboardId,
        version: 1,
        panelId: 'slowest-endpoints',
        variables: { env: 'prod' },
      }),
    });
    expect(response.status).toBe(200);
    const run = panelRunSchema.parse(await response.json());
    expect(run.queries[0]?.frames[0]?.meta.rowCount).toBe(5);
  });
});
