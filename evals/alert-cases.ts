/**
 * The alert cases: alert conversations about the dev data's checkout incident, deploy #481 of
 * checkout-svc yesterday at 12:02 UTC, rolled back 36 minutes later. Each drives an alert thread
 * through the agent, then scores the alert version it saved and that version's replay over the
 * incident. Each says what a good alert holds.
 */
import type { AccessLevel } from '@quanthea/shared';
import { zurich } from './questions.ts';

/** What a good alert, and the conversation that wrote it, hold. */
export interface AlertExpectation {
  /** The connector the alert's query runs on. */
  readonly connector: string;
  /** The threshold it fires above, as a ratio: `0.02` for 2%. A query scaled to percent uses 2. */
  readonly threshold: number;
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
