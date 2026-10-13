import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema } from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { eventsSpec } from './test/events-spec.ts';

/** The panel the tests explain. */
const panelId = 'errors-over-time';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let dashboardId: string;

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  ({ id: dashboardId } = services.dashboards.create(eventsSpec(), 'first', 'editor-1'));
  await services.dashboards.pin(dashboardId, 1, 'editor-1');
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/** A spec, as the tests change it. */
type Spec = ReturnType<typeof eventsSpec>;

/**
 * Adds a version and pins it.
 *
 * @param change - Changes the events spec.
 * @returns The new version's number.
 */
async function pinVersion(change: (spec: Spec) => Spec = (spec) => spec): Promise<number> {
  const version = services.dashboards.addVersion(dashboardId, change(eventsSpec()), 'next', 'e');
  await services.dashboards.pin(dashboardId, version, 'editor-1');
  return version;
}

/**
 * Stores an explanation of the panel for a version, as the answering service would.
 *
 * @param version - The version.
 * @param text - The explanation.
 * @param replaces - The explanation the person saw.
 * @returns The id it is stored with.
 */
function explain(version: number, text: string, replaces: string | null = null): string {
  const key = { dashboardId, version, panelId };
  const prepared = services.explanations.prepare(key, replaces, 'analyst-1');
  const answer = { mode: 'explain' as const, text, citations: [], evidence: [] };
  services.explanations.record(prepared, { ok: true, answer, usage: {} });
  return prepared.id;
}

/**
 * What the panel shows on a version, as a viewer reads it.
 *
 * @param version - The version.
 * @returns The explanation's text and version, and whether the panel changed since.
 */
function shown(version: number) {
  const key = { dashboardId, version, panelId };
  const { explanation, panelChanged } = services.explanations.latest(key, 'viewer');
  if (!explanation) return { text: null, panelChanged };
  return { text: explanation.text, version: explanation.version, panelChanged };
}

/**
 * The events spec with the panel's query changed.
 *
 * @param spec - The spec.
 * @returns The spec, its panel reading under another reference.
 */
function withOtherQuery(spec: Spec): Spec {
  const panels = spec.panels.map((panel) =>
    panel.id === panelId ? { ...panel, title: 'Errors', description: 'Per minute.' } : panel,
  );
  const [stat, chart] = panels;
  if (!stat || !chart || chart.view.kind !== 'chart') throw new Error('The events spec changed.');
  const queries = chart.queries.map((query) => ({ ...query, refId: 'B' }));
  const view = { ...chart.view, datasets: [{ ref: 'B' }] };
  return { ...spec, panels: [stat, { ...chart, queries, view }] } as Spec;
}

/**
 * The events spec without the panel.
 *
 * @param spec - The spec.
 * @returns The spec with its other panel only.
 */
function withoutPanel(spec: Spec): Spec {
  return { ...spec, panels: spec.panels.filter((panel) => panel.id !== panelId) };
}

/**
 * The events spec with the panel moved and renamed, its queries and view as they were.
 *
 * @param spec - The spec.
 * @returns The spec.
 */
function renamed(spec: Spec): Spec {
  const panels = spec.panels.map((panel) =>
    panel.id === panelId ? { ...panel, title: 'Errors, per minute', description: 'Moved.' } : panel,
  );
  return { ...spec, panels };
}

describe('the explanation a panel shows', () => {
  test('with none on any version up to the one shown, the panel has none', async () => {
    const second = await pinVersion();
    expect(shown(second)).toEqual({ text: null, panelChanged: false });
    explain(second, 'Written for the second.');
    expect(shown(1)).toEqual({ text: null, panelChanged: false });
  });

  test('a new version takes the one of the earlier version, unchanged', async () => {
    explain(1, 'It counts errors.');
    const second = await pinVersion(renamed);
    expect(shown(second)).toEqual({ text: 'It counts errors.', version: 1, panelChanged: false });
    expect(shown(1)).toEqual({ text: 'It counts errors.', version: 1, panelChanged: false });
  });

  test('with several earlier ones, it takes the latest of the nearest version', async () => {
    const first = explain(1, 'First.');
    const second = await pinVersion();
    const third = await pinVersion();
    explain(second, 'Second.', first);
    explain(1, 'First, again.', first);
    const fourth = await pinVersion();
    expect(shown(fourth)).toMatchObject({ text: 'Second.', version: second });
    expect(shown(third)).toMatchObject({ text: 'Second.', version: second });
    expect(shown(1)).toMatchObject({ text: 'First, again.', version: 1 });
  });

  test('it follows a changed panel, and says the panel changed since', async () => {
    explain(1, 'It counts errors.');
    const second = await pinVersion(withOtherQuery);
    expect(shown(second)).toEqual({ text: 'It counts errors.', version: 1, panelChanged: true });
    const third = await pinVersion();
    expect(shown(third)).toEqual({ text: 'It counts errors.', version: 1, panelChanged: false });
  });

  test('a removed panel shows none, and takes it back when added again by the same id', async () => {
    explain(1, 'It counts errors.');
    const second = await pinVersion(withoutPanel);
    expect(() => shown(second)).toThrow('No panel');
    const third = await pinVersion(withOtherQuery);
    expect(shown(third)).toEqual({ text: 'It counts errors.', version: 1, panelChanged: true });
  });

  test('explain again writes one for the version shown, and copies or rewrites none', async () => {
    const first = explain(1, 'It counts errors.');
    const second = await pinVersion(withOtherQuery);
    const key = { dashboardId, version: second, panelId };
    expect(() => services.explanations.prepare(key, null, 'analyst-1')).toThrow('meanwhile');
    explain(second, 'It counts errors under B.', first);
    expect(shown(second)).toEqual({
      text: 'It counts errors under B.',
      version: second,
      panelChanged: false,
    });
    expect(shown(1)).toMatchObject({ text: 'It counts errors.', version: 1 });
    const rows = services.database
      .query<{ version: number; text: string }, []>(
        'SELECT version, text FROM panel_explanations ORDER BY version',
      )
      .all();
    expect(rows).toEqual([
      { version: 1, text: 'It counts errors.' },
      { version: second, text: 'It counts errors under B.' },
    ]);
  });
});
