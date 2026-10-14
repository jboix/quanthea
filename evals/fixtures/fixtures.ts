/**
 * The fixtures: each is the state of the world before a case acts, built by the app's own
 * services with no model call. A case names one as its `given`, and gets it in a world no other
 * case has touched.
 */
import fixture from '@quanthea/dev/seed/checkout-incident.json' with { type: 'json' };
import type { TimeRangeExpression } from '@quanthea/shared';
import type { Fixture, Given, Need } from '../core/case.ts';
import { incidentHour, zurich } from '../world/incident.ts';
import { type EvalWorld, evalsActor } from '../world/setup.ts';
import { eventsDashboard } from './events-dashboard.ts';
import { alertThread, reportThread } from './saved-thread.ts';

/** Yesterday from 06:00 to 18:00 UTC, as seen from the evals' clock: the day of the incident. */
export const yesterdayDaytime: TimeRangeExpression = { from: 'now-28h', to: 'now-16h' };

/** The question the answered-incident fixture holds, at the incident's hour in Zurich. */
export const aroundTheIncident = `What happened around ${incidentHour(zurich)}?`;

/** The world as it opens: the dev Postgres and Prometheus as connectors, nothing made yet. */
export const baseWorld: Fixture = { id: 'world', prepare: async () => ({}) };

/**
 * The world as it opens, for a case that needs more than the two dev sources.
 *
 * @param needs - What the world must have, such as the search connector.
 * @returns The fixture.
 */
function worldWith(...needs: Need[]): Fixture {
  return { id: `world+${needs.join('+')}`, needs, prepare: async () => ({}) };
}

/** The world with the player events on the dev OpenSearch as a third connector. */
export const searchWorld: Fixture = worldWith('search');

/** The world with the player events and the media API as an HTTP connector. */
export const httpWorld: Fixture = worldWith('search', 'http');

/** The world with the player events and a pinned dashboard about one media to link to. */
export const pinnedTargetWorld: Fixture = worldWith('search', 'pinned-target');

/** The shop's own definitions: a checked failure rate, and big orders by their meaning only. */
const shopDefinitions = [
  {
    id: 'failure-rate',
    name: 'Failure rate',
    synonyms: ['failed share'],
    meaning:
      "Failed orders over all orders, leaving out the marketplace channel, whose failures are the marketplace's.",
    bodies: [
      {
        shape: 'ratio',
        request: {
          kind: 'sql-ratio',
          table: 'orders',
          time: 'created_at',
          match: [{ field: 'status', value: 'failed' }],
          filters: [{ field: 'channel', op: '!=', value: 'marketplace' }],
        },
      },
    ],
  },
  {
    id: 'big-orders',
    name: 'Big orders',
    meaning: 'Orders of 500 CHF or more: total_cents of at least 50000, whatever their status.',
  },
];

/** The world with the shop's definitions saved, as the configuration file would declare them. */
export const definitionsWorld: Fixture = {
  id: 'definitions:shop',
  prepare: async (world) => {
    for (const definition of shopDefinitions)
      await world.services.definitions.save(definition, null, evalsActor, 'file');
    return {};
  },
};

/**
 * Creates and pins the checkout incident dashboard of the dev seed.
 *
 * @param world - The world.
 * @returns The dashboard's id.
 */
async function pinIncident(world: EvalWorld): Promise<string> {
  const { dashboards } = world.services;
  const { id } = dashboards.create(fixture, 'the dev seed', evalsActor);
  world.aliases.set(id, 'evals-dashboard');
  await dashboards.pin(id, 1, evalsActor);
  return id;
}

/** The checkout incident dashboard of the dev seed, pinned. */
export const incidentDashboard: Fixture = {
  id: 'pinned:checkout-incident',
  prepare: async (world) => ({ dashboardId: await pinIncident(world) }),
};

/** The player events per hour on the dev OpenSearch, as a pinned dashboard. */
export const eventsDashboardPinned: Fixture = {
  id: 'pinned:player-events',
  needs: ['search'],
  prepare: async (world) => {
    const { dashboards } = world.services;
    const { id } = dashboards.create(eventsDashboard, 'the evals', evalsActor);
    world.aliases.set(id, 'evals-events-dashboard');
    await dashboards.pin(id, 1, evalsActor);
    return { dashboardId: id };
  },
};

/**
 * What a good answer to the incident question says, at the incident's hour on the person's clock:
 * deploy #481 of checkout-svc at two past the hour, rolled back 36 minutes later.
 *
 * @returns The text.
 */
function incidentAnswer(): string {
  const hour = incidentHour(zurich).slice(0, 2);
  return [
    `Deploy #481 of checkout-svc went out at ${hour}:02.`,
    `The 5xx share of checkout-svc rose from ${hour}:02, peaked at about 8% around ${hour}:14,`,
    `and was back to normal by ${hour}:38, when the deploy was rolled back.`,
    'The other services stayed flat.',
  ].join(' ');
}

/**
 * Stores the incident question with its answer on the pinned dashboard, as an answered question.
 *
 * @param world - The world.
 * @param dashboardId - The pinned dashboard.
 * @returns The stored question's id.
 */
function storeIncidentAnswer(world: EvalWorld, dashboardId: string): string {
  const { questions } = world.services;
  const asked = { dashboardId, version: 1, question: aroundTheIncident, time: yesterdayDaytime };
  const shown = { timeZone: zurich, variables: {}, hiddenMarkers: [], parentId: undefined };
  const prepared = questions.prepare({ ...asked, ...shown }, evalsActor);
  const answer = { mode: 'ask' as const, text: incidentAnswer(), citations: [], evidence: [] };
  questions.record(prepared, { ok: true, answer, usage: {} });
  return prepared.id;
}

/** The pinned incident dashboard with the incident question already asked and answered. */
export const incidentAnswered: Fixture = {
  id: 'answered:checkout-incident',
  prepare: async (world) => {
    const dashboardId = await pinIncident(world);
    return { dashboardId, parentQuestionId: storeIncidentAnswer(world, dashboardId) };
  },
};

/**
 * An alert thread started from a panel of the pinned incident dashboard, with nothing said yet.
 *
 * @param panelId - The panel.
 * @returns The fixture.
 */
export function alertFromPanel(panelId: string): Fixture {
  const prepare = async (world: EvalWorld): Promise<Given> => {
    const dashboardId = await pinIncident(world);
    const start = { kind: 'alert' as const, seed: { dashboardId, version: 1, panelId } };
    const { id } = world.services.threads.create(evalsActor, null, undefined, start);
    return { dashboardId, threadId: id };
  };
  return { id: `alert-from-panel:${panelId}`, prepare };
}

/** A thread that wrote an alert on checkout's 5xx share: above 2% for 5 minutes. */
export const checkoutShareAlert: Fixture = {
  id: 'alert-thread:checkout-share',
  prepare: async (world) => ({ threadId: alertThread(world, 'alert-checkout-share') }),
};

/** A thread that wrote a daily report of yesterday's orders, revenue and failed orders. */
export const dailyOrdersReport: Fixture = {
  id: 'report-thread:daily-orders',
  prepare: async (world) => ({ threadId: reportThread(world, 'report-daily-orders').threadId }),
};

/** The daily orders report, with one run of it made at the evals' clock. */
export const dailyOrdersRun: Fixture = {
  id: 'report-run:daily-orders',
  prepare: async (world) => {
    const { threadId, reportId } = reportThread(world, 'report-daily-orders');
    const run = await world.services.reports.runNow(reportId, false, evalsActor);
    return { threadId, run: { reportId, runId: run.id } };
  },
};
