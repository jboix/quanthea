import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { connectorInputSchema, defaultModelGateway, type Plan } from '@quanthea/shared';
import { temporaryDir, testServices } from '../test/fixtures.ts';
import { createAgent } from './run.ts';
import { type ScriptedStep, scriptedStreamModel } from './test/mock-model.ts';

let dataDir: ReturnType<typeof temporaryDir>;
let services: Awaited<ReturnType<typeof testServices>>;
let threadId = '';

const plan: Plan = {
  title: 'Events',
  variables: ['time = last hour'],
  panels: [
    { kind: 'stat', title: 'Errors · peak', language: 'sql', connector: 'events' },
    { kind: 'line', title: 'Errors over time', language: 'sql', connector: 'events' },
  ],
};

beforeEach(async () => {
  dataDir = temporaryDir();
  services = await testServices(dataDir.path);
  const input = { name: 'events', kind: 'memory', config: {}, secret: { token: 't' } };
  await services.connections.create(connectorInputSchema.parse(input), 'admin-1');
  await services.modelSettings.save(defaultModelGateway, { anthropic: 'sk-test' }, 'admin-1');
  ({ id: threadId } = services.threads.create('editor-1'));
  services.threads.proposePlan(threadId, plan, true);
});

afterEach(async () => {
  await services.close();
  dataDir.remove();
});

/**
 * A panel over the in-memory events.
 *
 * @param title - Its title.
 * @param show - A stat or a line chart.
 * @returns The panel request.
 */
function eventsPanel(title: string, show: 'stat' | 'line') {
  return {
    title,
    data: { kind: 'raw', connector: 'events', language: 'sql', query: 'SELECT * FROM events' },
    chart: { recipe: show === 'stat' ? 'kpi.stat' : 'trend.line' },
  };
}

/** The edit that builds the plan, with nothing arranged. */
const buildEdit = {
  title: 'Events',
  panels: [eventsPanel('Errors · peak', 'stat'), eventsPanel('Errors over time', 'line')],
  summary: 'built from plan',
};

/** The rows that arrange the two panels of the plan. */
const rows = [
  ['stats', 'Errors · peak'],
  ['full', 'Errors over time'],
];

/** What an edit tells the model about the layout. */
interface EditOutput {
  /** Whether a version was saved. */
  readonly ok: boolean;
  /** The version saved. */
  readonly version?: number;
  /** Why none was. */
  readonly error?: string;
  /** The layout of the saved version. */
  readonly layout?: { readonly rows: string[]; readonly advice?: string[] };
}

/**
 * Runs one turn with a scripted model.
 *
 * @param text - What the person says.
 * @param steps - The model's answers, one per step.
 * @returns The model, for the prompts it received.
 */
async function turn(text: string, ...steps: ScriptedStep[]) {
  const model = scriptedStreamModel(...steps);
  const agent = createAgent({ ...services, buildModel: () => model });
  const message = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] };
  const signal = AbortSignal.timeout(5000);
  await (await agent.chat({ threadId, message, actor: 'editor-1', signal })).text();
  return model;
}

/**
 * What each `edit_dashboard` call of the thread returned.
 *
 * @returns The outputs, oldest first.
 */
function editOutputs(): EditOutput[] {
  const messages = services.threads.get(threadId).messages as {
    parts: { type: string; output?: EditOutput }[];
  }[];
  return messages
    .flatMap((message) => message.parts)
    .flatMap((part) => (part.type === 'tool-edit_dashboard' && part.output ? [part.output] : []));
}

/**
 * The grid of each panel of a stored version.
 *
 * @param version - The version.
 * @returns The grids, by panel id.
 */
function gridsOf(version: number) {
  const id = services.threads.get(threadId).dashboardId ?? '';
  const { spec } = services.dashboards.getVersion(id, version, 'editor');
  return Object.fromEntries(spec.panels.map((panel) => [panel.id, panel.grid]));
}

describe('the layout the agent reads and asks for', () => {
  test('a build that arranges its panels stores grid numbers and reads the map back', async () => {
    const edit = { tool: 'edit_dashboard', input: { ...buildEdit, arrange: rows } };
    await turn('Events?', edit, { text: 'Built.' });
    expect(editOutputs()).toMatchObject([{ ok: true, version: 1 }]);
    expect(editOutputs()[0]?.layout).toEqual({
      rows: ['y0 h3: errors-peak stat 1-12', 'y3 h8: errors-over-time time 1-12'],
    });
    expect(gridsOf(1)).toEqual({
      'errors-peak': { x: 0, y: 0, w: 12, h: 3 },
      'errors-over-time': { x: 0, y: 3, w: 12, h: 8 },
    });
  });

  test('advice comes with the saved version, and an edit that only arranges repairs it', async () => {
    const repair = {
      arrange: [['two', 'errors-peak', 'errors-over-time']],
      summary: 'side by side',
    };
    await turn(
      'Events?',
      { tool: 'edit_dashboard', input: buildEdit },
      { tool: 'edit_dashboard', input: repair },
      { text: 'Built.' },
    );
    const [first, second] = editOutputs();
    expect(first).toMatchObject({ ok: true, version: 1 });
    expect(first?.layout).toEqual({
      rows: ['y0 h3: errors-peak stat 1-3 | gap 4-12', 'y3 h8: errors-over-time time 1-12'],
      advice: ['Row y0 leaves columns 4-12 empty: arrange its panels to fill the row.'],
    });
    expect(second).toMatchObject({ ok: true, version: 2 });
    expect(second?.layout).toEqual({
      rows: ['y0 h8: errors-peak stat 1-6 | errors-over-time time 7-12'],
    });
    // The version the advice came with is stored as it was written.
    expect(gridsOf(1)['errors-peak']).toEqual({ x: 0, y: 0, w: 3, h: 3 });
  });

  test('a row that cannot be placed is refused with the repair, then placed', async () => {
    const wrong = { ...buildEdit, arrange: [['row-of-stats', 'Errors · peak']] };
    await turn(
      'Events?',
      { tool: 'edit_dashboard', input: wrong },
      { tool: 'edit_dashboard', input: { ...buildEdit, arrange: rows } },
      { text: 'Built.' },
    );
    const [refused, saved] = editOutputs();
    expect(refused).toEqual({
      ok: false,
      error:
        'No arrangement "row-of-stats". A row of "arrange" starts with one of: stats, chart-table, full, two, three.',
    });
    expect(saved).toMatchObject({ ok: true, version: 1 });
  });

  test('the next turn reads the draft’s layout as a map', async () => {
    await turn('Events?', { tool: 'edit_dashboard', input: buildEdit }, { text: 'Built.' });
    const model = await turn('Make the chart smaller', { text: 'How small?' });
    const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
    expect(prompt).toContain('Its layout on the 12-column grid, a line per row');
    expect(prompt).toContain('y0 h3: errors-peak stat 1-3 | gap 4-12\\ny3 h8: errors-over-time');
    expect(prompt).toContain('\\"arrange\\" places panels by name');
  });

  test('an arrangement made by hand gets the map and no advice', async () => {
    await turn('Events?', { tool: 'edit_dashboard', input: buildEdit }, { text: 'Built.' });
    const id = services.threads.get(threadId).dashboardId ?? '';
    await services.dashboards.pin(id, 1, 'editor-1');
    const layout = {
      panels: [
        { id: 'errors-peak', grid: { x: 0, y: 0, w: 4, h: 3 }, hidden: false },
        { id: 'errors-over-time', grid: { x: 0, y: 3, w: 12, h: 8 }, hidden: false },
      ],
    };
    services.layouts.save({ subjectId: id, version: 1 }, layout, null, 'editor-1');
    const again = {
      panels: [{ ...eventsPanel('Errors · peak', 'stat'), replaces: 'errors-peak' }],
    };
    const edit = { tool: 'edit_dashboard', input: { ...again, summary: 'rebuilt' } };
    await turn('Rebuild the peak', edit, { text: 'Done.' });
    expect(editOutputs().at(-1)?.layout).toEqual({
      rows: ['y0 h3: errors-peak stat 1-4 | gap 5-12', 'y3 h8: errors-over-time time 1-12'],
    });
  });
});
