/**
 * The alert cases: alert conversations about the dev data. The first four are about the checkout
 * incident, deploy #481 of checkout-svc yesterday at 12:02 UTC, rolled back 36 minutes later: each
 * drives an alert thread through the agent, then scores the alert version it saved and that
 * version's replay over the incident. The others ask for one kind of condition each, and are scored
 * on the kind and the values of the condition saved. Each says what a good alert holds.
 */
import type { AccessLevel } from '@quanthea/shared';
import { zurich } from './questions.ts';

/**
 * What a field of a test must be: a number, within 1%, a duration, by its length, or a word. A
 * list holds every value that is right, such as `[0.2, 20]` for 20% as a ratio or in percent.
 */
export type FieldExpectation = string | number | readonly (string | number)[];

/** The fields a test of a condition must have, such as `{ kind: 'change', within: '10m' }`. */
export type TestExpectation = Readonly<Record<string, FieldExpectation>>;

/** The condition a good alert holds, for a case that asks for a kind other than a threshold. */
export interface ConditionExpectation {
  /** Its kind. */
  readonly kind: 'threshold' | 'change' | 'past' | 'band' | 'all' | 'any';
  /** The fields of a single test. */
  readonly fields?: TestExpectation;
  /** The tests of a joined condition, in any order: each must match a test of its own. */
  readonly of?: readonly TestExpectation[];
}

/** What a good alert, and the conversation that wrote it, hold. */
export interface AlertExpectation {
  /** The connector the alert's query runs on. */
  readonly connector: string;
  /**
   * The threshold it fires above, as a ratio: `0.02` for 2%. A query scaled to percent uses 2.
   * Left out by a case that names its `condition`.
   */
  readonly threshold?: number;
  /** The kind and the values of the condition, for a case that asks for another kind. */
  readonly condition?: ConditionExpectation;
  /** The connector of the second query, for a case that asks for a ratio of two queries. */
  readonly dividedBy?: string;
  /** Whether the alert may watch one series: it need not tell services apart. */
  readonly oneSeries?: boolean;
  /** How long the condition must hold before it fires, such as `5m`; any when left out. */
  readonly for?: string;
  /** Whether replaying the saved version over yesterday must show checkout firing exactly once. */
  readonly checkoutFiresOnce?: boolean;
  /** Whether the agent must not call `replay_alert`. */
  readonly noReplayTool?: boolean;
  /** Whether the agent must say it cannot replay the numbers. */
  readonly admitsNoReplay?: boolean;
  /** Whether the case must save a new version of an alert that has one already. */
  readonly newVersion?: boolean;
  /** Whether the alert's query must match its panel's, with a link from the panel. */
  readonly matchesPanel?: boolean;
}

/** One alert case. */
export interface AlertCase {
  /** Its id, for `--only`. */
  readonly id: string;
  /** What the person says first. */
  readonly question: string;
  /** The person's time zone. */
  readonly timeZone: string;
  /** How the person answers the agent's question; its first option when not given. */
  readonly answer?: string;
  /** The access level both dev connectors have while the case runs. */
  readonly accessLevel: AccessLevel;
  /** The case whose thread this one continues, if any. */
  readonly follows?: string;
  /** The panel of the pinned checkout incident dashboard the thread starts from, if any. */
  readonly panelId?: string;
  /** What a good alert holds. */
  readonly expect: AlertExpectation;
}

const prometheus = 'prometheus-dev';
const postgres = 'postgres-orders';

/** Where the alerts of the cases notify, as the person says it. */
const channel = 'Notify the Evals test channel.';

/** The ask of al1 and al2. */
const checkoutShare = "Tell me when checkout's 5xx share stays above 2% for 5 minutes.";

/** How the person answers when the agent asks: the service, the source and the channel. */
const scripted = 'checkout-svc in prod, from prometheus-dev. Notify the Evals test channel.';

/** The alert cases, in the order they run, after the answer cases. */
export const alertCases: readonly AlertCase[] = [
  {
    id: 'al1',
    question: checkoutShare,
    timeZone: zurich,
    answer: scripted,
    accessLevel: 3,
    expect: { connector: prometheus, threshold: 0.02, for: '5m', checkoutFiresOnce: true },
  },
  {
    id: 'al2',
    question: checkoutShare,
    timeZone: zurich,
    answer: scripted,
    accessLevel: 2,
    expect: {
      connector: prometheus,
      threshold: 0.02,
      for: '5m',
      checkoutFiresOnce: true,
      noReplayTool: true,
      admitsNoReplay: true,
    },
  },
  {
    id: 'al3',
    question: 'Make it wait 10 minutes instead.',
    timeZone: zurich,
    answer: scripted,
    accessLevel: 3,
    follows: 'al1',
    // Checkout stays above 2% for about 29 minutes, so a 10-minute wait still fires once.
    expect: {
      connector: prometheus,
      threshold: 0.02,
      for: '10m',
      checkoutFiresOnce: true,
      newVersion: true,
    },
  },
  {
    id: 'al4',
    question: 'Alert me when this goes above 3%.',
    timeZone: zurich,
    // The question names no duration, so the agent rightly asks for one.
    answer: `${scripted} Fire when it stays above for 5 minutes.`,
    accessLevel: 3,
    panelId: 'error-rate-by-service',
    expect: { connector: prometheus, threshold: 0.03, matchesPanel: true },
  },
  {
    id: 'al5',
    question: "Tell me when a service's request rate drops by half within 10 minutes.",
    timeZone: zurich,
    answer: `Every service in prod, from prometheus-dev. ${channel} Fire at once.`,
    accessLevel: 3,
    expect: {
      connector: prometheus,
      condition: {
        kind: 'change',
        fields: { direction: 'down', amount: 50, unit: 'percent', within: '10m' },
      },
    },
  },
  {
    id: 'al6',
    question:
      'Tell me when the orders of the last hour are 30% or more below the same hour a week earlier.',
    timeZone: zurich,
    answer: `Every order attempt together, from postgres-orders. ${channel} Fire at once.`,
    accessLevel: 3,
    // The dev Prometheus holds less than two days, so only the orders reach a week back.
    expect: {
      connector: postgres,
      oneSeries: true,
      condition: {
        kind: 'past',
        fields: { direction: 'down', amount: 30, unit: 'percent', ago: '7d' },
      },
    },
  },
  {
    id: 'al7',
    question:
      "Tell me when checkout's p95 latency is unusual: more than 3 deviations from its mean of the last 6 hours, either way.",
    timeZone: zurich,
    answer: `checkout-svc in prod, from prometheus-dev. ${channel} It must hold for 5 minutes.`,
    accessLevel: 3,
    expect: {
      connector: prometheus,
      condition: { kind: 'band', fields: { side: 'either', deviations: 3, baseline: '6h' } },
    },
  },
  {
    id: 'al8',
    question:
      'Tell me when more than 20% of the order attempts of the last 10 minutes failed, but only with more than 30 attempts in those 10 minutes.',
    timeZone: zurich,
    answer: `Every order attempt together, from postgres-orders. ${channel} Fire at once.`,
    accessLevel: 3,
    // One query returns the share and the count: PromQL returns one number, so this is SQL.
    expect: {
      connector: postgres,
      oneSeries: true,
      condition: {
        kind: 'all',
        of: [
          { kind: 'threshold', op: 'above', value: [0.2, 20] },
          { kind: 'threshold', op: 'above', value: 30 },
        ],
      },
    },
  },
  {
    id: 'al9',
    question:
      'Watch the failed orders of checkout-svc in postgres-orders as a share of the requests checkout-svc got in prometheus-dev, both summed over the last 5 minutes. Tell me when it goes above 0.1%.',
    timeZone: zurich,
    answer: `checkout-svc in prod: the failed orders from postgres-orders, divided by the requests from prometheus-dev. ${channel} Fire at once.`,
    accessLevel: 3,
    // No one query reads both sources, so the alert needs a second query.
    expect: {
      connector: postgres,
      dividedBy: prometheus,
      oneSeries: true,
      condition: { kind: 'threshold', fields: { op: 'above', value: [0.001, 0.1] } },
    },
  },
];

/**
 * The alert cases `--only` keeps, in their order. A follow-up runs the case it follows first
 * when that case is not kept.
 *
 * @param only - The ids to keep, or none for every case.
 * @returns The cases.
 */
export function selectAlertCases(only: readonly string[]): readonly AlertCase[] {
  if (only.length === 0) return alertCases;
  return alertCases.filter((each) => only.includes(each.id));
}

/**
 * The text a case asks, for the report: its first message, and the panel it starts from.
 *
 * @param alertCase - The case.
 * @returns The text.
 */
export function alertCaseText(alertCase: AlertCase): string {
  if (alertCase.panelId === undefined) return alertCase.question;
  return `${alertCase.question} (from the panel ${alertCase.panelId})`;
}
