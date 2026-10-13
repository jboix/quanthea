/**
 * The alert cases: alert conversations about the dev data. The first four are about the checkout
 * incident, deploy #481 of checkout-svc yesterday at 12:02 UTC, rolled back 36 minutes later: each
 * talks an alert thread through, and the version it saved is replayed over the incident. The
 * others ask for one kind of condition each, and are checked on the kind and the values of the
 * condition saved. Each asks exactly, so it has one right outcome.
 */
import {
  type AlertCheck,
  admitsNoReplay,
  conditionIs,
  dividesBy,
  firesAbove,
  firesOnceOnIncident,
  holdsFor,
  matchesPanel,
  noReplayTool,
  runsOn,
  savesNewVersion,
} from '../checks/alert.ts';
import type { CaseOn, Fixture, ThreadInput } from '../core/case.ts';
import { alertFromPanel, baseWorld, checkoutShareAlert } from '../fixtures/fixtures.ts';

const prometheus = 'prometheus-dev';
const postgres = 'postgres-orders';

/** Where the alerts of the cases notify, as the person says it. */
const channel = 'Notify the Evals test channel.';

/** The ask of al1 and al2. */
const checkoutShare = "Tell me when checkout's 5xx share stays above 2% for 5 minutes.";

/** How the person answers when the agent asks: the service, the source and the channel. */
const scripted = 'checkout-svc in prod, from prometheus-dev. Notify the Evals test channel.';

/** What an alert case names beside its id, its ask and its checks. */
interface More {
  /** How the person answers a question of the agent. */
  readonly reply: string;
  /** The access level; aggregates (3) when left out. */
  readonly accessLevel?: ThreadInput['accessLevel'];
  /** The world before the case; a world with nothing made yet when left out. */
  readonly given?: Fixture;
  /** The ids of the surface's own checks the case leaves out. */
  readonly without?: readonly string[];
  /** What the judge reads, one claim per sentence. */
  readonly rubric?: readonly string[];
}

/** An alert that watches one series need not tell services apart. */
const oneSeries = ['tells-services-apart'];

/**
 * An alert case: one exact ask in an alert thread.
 *
 * @param id - The case's id.
 * @param turn - What the person says.
 * @param checks - What code checks beside the surface's own checks.
 * @param more - The reply, the access level, the fixture and the rubric.
 * @returns The case.
 */
function alert(
  id: string,
  turn: string,
  checks: readonly AlertCheck[],
  more: More,
): CaseOn<'alert'> {
  const { reply, accessLevel = 3, given = baseWorld, without, rubric } = more;
  return {
    id,
    bucket: 'capability',
    given,
    input: { surface: 'alert', turns: [turn], reply, accessLevel },
    checks,
    ...(without ? { without } : {}),
    ...(rubric ? { rubric } : {}),
  };
}

/** The alert cases, in the order they run, after the answer cases. */
export const alertCases: readonly CaseOn<'alert'>[] = [
  alert(
    'al1',
    checkoutShare,
    [runsOn(prometheus), firesAbove(0.02), holdsFor('5m'), firesOnceOnIncident],
    { reply: scripted },
  ),
  alert(
    'al2',
    checkoutShare,
    [
      runsOn(prometheus),
      firesAbove(0.02),
      holdsFor('5m'),
      firesOnceOnIncident,
      // At schema and metadata only, the agent cannot replay: it must not try, and must say so.
      noReplayTool,
      admitsNoReplay,
    ],
    {
      reply: scripted,
      accessLevel: 2,
      rubric: ['The agent says it cannot replay or test the alert on real numbers.'],
    },
  ),
  alert(
    'al3',
    'Make it wait 10 minutes instead.',
    // Checkout stays above 2% for about 29 minutes, so a 10-minute wait still fires once.
    [runsOn(prometheus), firesAbove(0.02), holdsFor('10m'), firesOnceOnIncident, savesNewVersion],
    // The thread already wrote the alert of al1: this turn changes it.
    { reply: scripted, given: checkoutShareAlert },
  ),
  alert(
    'al4',
    'Alert me when this goes above 3%.',
    [runsOn(prometheus), firesAbove(0.03), matchesPanel],
    {
      // The ask names no duration, so the agent rightly asks for one.
      reply: `${scripted} Fire when it stays above for 5 minutes.`,
      given: alertFromPanel('error-rate-by-service'),
    },
  ),
  alert(
    'al5',
    "Tell me when a service's request rate drops by half within 10 minutes.",
    [
      runsOn(prometheus),
      conditionIs({
        kind: 'change',
        fields: { direction: 'down', amount: 50, unit: 'percent', within: '10m' },
      }),
    ],
    { reply: `Every service in prod, from prometheus-dev. ${channel} Fire at once.` },
  ),
  alert(
    'al6',
    'Tell me when the orders of the last hour are 30% or more below the same hour a week earlier.',
    [
      // The dev Prometheus holds less than two days, so only the orders reach a week back.
      runsOn(postgres),
      conditionIs({
        kind: 'past',
        fields: { direction: 'down', amount: 30, unit: 'percent', ago: '7d' },
      }),
    ],
    {
      reply: `Every order attempt together, from postgres-orders. ${channel} Fire at once.`,
      without: oneSeries,
    },
  ),
  alert(
    'al7',
    "Tell me when checkout's p95 latency is unusual: more than 3 deviations from its mean of the last 6 hours, either way.",
    [
      runsOn(prometheus),
      conditionIs({ kind: 'band', fields: { side: 'either', deviations: 3, baseline: '6h' } }),
    ],
    { reply: `checkout-svc in prod, from prometheus-dev. ${channel} It must hold for 5 minutes.` },
  ),
  alert(
    'al8',
    'Tell me when more than 20% of the order attempts of the last 10 minutes failed, but only with more than 30 attempts in those 10 minutes.',
    [
      // One query returns the share and the count: PromQL returns one number, so this is SQL.
      runsOn(postgres),
      conditionIs({
        kind: 'all',
        of: [
          { kind: 'threshold', op: 'above', value: [0.2, 20] },
          { kind: 'threshold', op: 'above', value: 30 },
        ],
      }),
    ],
    {
      reply: `Every order attempt together, from postgres-orders. ${channel} Fire at once.`,
      without: oneSeries,
    },
  ),
  alert(
    'al9',
    'Watch the failed orders of checkout-svc in postgres-orders as a share of the requests checkout-svc got in prometheus-dev, both summed over the last 5 minutes. Tell me when it goes above 0.1%.',
    [
      // No one query reads both sources, so the alert needs a second query.
      runsOn(postgres),
      conditionIs({ kind: 'threshold', fields: { op: 'above', value: [0.001, 0.1] } }),
      dividesBy(prometheus),
    ],
    {
      reply: `checkout-svc in prod: the failed orders from postgres-orders, divided by the requests from prometheus-dev. ${channel} Fire at once.`,
      without: oneSeries,
    },
  ),
];
